import { Store } from "./store";
import {
  type Doc,
  requireThat as check,
  revision,
  id,
  now,
  hash,
  length,
  cut,
} from "./shared";
import { validate } from "./validation";
import { generate } from "./ai";
import { chapterPath, episodeNumber } from "./series";
import { validateLaunchPlan, applyLaunch } from "./launch";
import { storyContext } from "./story-ledger";
import { extract, filename } from "./parsers";

export const turnId = (seq: number) => `turn-${String(seq).padStart(8, "0")}`;
export const canonContext = (p: Doc) =>
  (p.conversationCanon ?? [])
    .filter((c: Doc) => !c.archived)
    .map(({ id, kind, title, content }: Doc) => ({ id, kind, title, content }));
export async function chatHistory(
  s: Store,
  p: Doc,
  before?: number,
  pageSize = 20,
) {
  const end = before === undefined ? (p.chatSequence ?? 0) : before - 1;
  check(
    Number.isSafeInteger(end) && end >= 0 && end <= (p.chatSequence ?? 0),
    "대화 페이지를 확인해주세요.",
    422,
  );
  const start = Math.max(1, end - pageSize + 1);
  const turns = await Promise.all(
    Array.from({ length: Math.max(0, end - start + 1) }, (_, i) =>
      s.find(`projects/${p.id}/chat_turns/${turnId(start + i)}`),
    ),
  );
  return {
    turns: turns.filter((t): t is Doc => t !== null),
    nextBefore: start > 1 ? start : null,
  };
}
export function mergeCanon(
  p: Doc,
  changes: Doc[],
  message: string,
  source: string,
) {
  check(
    new Set(changes.map((c) => c.id)).size === changes.length,
    "저장할 설정 ID가 중복됐습니다.",
    422,
  );
  const result: Doc[] = structuredClone(p.conversationCanon ?? []);
  for (const change of changes) {
    check(
      message.includes(change.evidence) && change.evidence.trim(),
      "설정 저장 근거가 현재 대화에 없습니다. 대화를 다시 확인해주세요.",
      422,
    );
    const index = result.findIndex((c) => c.id === change.id);
    const next = {
      ...change,
      sourceTurn: source,
      archived: false,
      updatedAt: now(),
    };
    if (index < 0) result.push(next);
    else result[index] = next;
  }
  check(
    result.length <= 150,
    "설정집 항목이 많습니다. 비슷한 설정을 기존 항목으로 합쳐주세요.",
    413,
  );
  return result;
}
// Exact, unique anchors and non-overlapping spans prevent editing the wrong passage.
export function applyChatEdits(content: string, edits: Doc[]) {
  const spans = edits
    .map((e) => {
      const index = content.indexOf(e.original);
      check(
        index >= 0 && content.indexOf(e.original, index + 1) < 0,
        "수정할 원문을 하나로 특정할 수 없습니다. 더 긴 원문으로 다시 요청해주세요.",
        422,
      );
      const start = length(content.slice(0, index));
      return {
        start,
        end: start + length(e.original),
        replacement: e.replacement,
      };
    })
    .sort((a, b) => a.start - b.start);
  check(
    spans.every((span, i) => !i || spans[i - 1].end <= span.start),
    "수정 구간이 겹칩니다. 나누어 요청해주세요.",
    422,
  );
  for (const span of spans.reverse())
    content =
      cut(content, 0, span.start) + span.replacement + cut(content, span.end);
  check(length(content) <= 100000, "수정 후 원고가 너무 깁니다.", 413);
  return content;
}
export async function startChat(s: Store, body: Doc) {
  validate("ChatStart", body);
  check(body.idea.trim(), "쓰고 싶은 이야기나 장르를 한 줄 알려주세요.", 422);
  const pid = id();
  return s.create(`projects/${pid}`, {
    id: pid,
    title: body.title,
    genre: body.genre,
    status: "IDEA",
    canonVersion: 0,
    brief: {
      text: body.idea,
      textHash: await hash(body.idea),
      encoding: "utf-8",
    },
    requirements: [],
    answers: {},
    bible: {},
    plot: null,
    styleBinding: null,
    deletedAt: null,
    planningMode: "chat",
    chatSequence: 0,
    conversationCanon: [],
    chatSeed: body.idea,
  });
}
export async function attachChatFile(s: Store, p: Doc, form: FormData) {
  revision(p, Number(form.get("revision")));
  const file = form.get("file"),
    kind = form.get("kind");
  check(
    file instanceof File && /\.(txt|md|docx|pdf)$/i.test(file.name),
    "TXT·MD·DOCX·PDF 파일을 첨부해주세요.",
    415,
  );
  check(kind === "idea" || kind === "style", "자료 종류를 선택해주세요.", 422);
  check(
    (p.assistantAttachments ?? []).length < 10,
    "작품당 첨부 파일은 10개까지입니다.",
    413,
  );
  const raw = new Uint8Array(await file.arrayBuffer()),
    result = await extract(file.name, raw);
  check(
    length(result.text) <= 40000,
    "추출한 본문은 4만 자 이하여야 합니다.",
    413,
  );
  const key = id(),
    fileInfo = await s.put(
      `users/${s.uid}/projects/${p.id}/chat-files/${key}/${filename(file.name)}`,
      raw,
    );
  const attachment = {
    id: key,
    name: file.name,
    kind,
    textHash: await hash(result.text),
    createdAt: now(),
  };
  const next = s.prepare(
    `projects/${p.id}`,
    {
      ...p,
      assistantAttachments: [...(p.assistantAttachments ?? []), attachment],
    },
    p.revision,
  );
  await s.commit([
    next,
    s.prepare(`projects/${p.id}/chat_files/${key}`, {
      ...attachment,
      text: result.text,
      encoding: result.encoding,
      file: fileInfo,
    }),
  ]);
  return next.data;
}
export async function messageChat(s: Store, p: Doc, body: Doc) {
  validate("ChatRequest", body);
  revision(p, body.revision);
  check(body.message.trim(), "메시지를 입력해주세요.", 422);
  check(
    body.storyRevision === (p.storyRevision ?? 0) &&
      body.episode === episodeNumber(p),
    "연재 버전 또는 회차가 바뀌었습니다. 대화를 새로 불러와주세요.",
    409,
  );
  const writing = body.mode === "writing";
  const rawChapter = writing ? await s.find(chapterPath(p)) : null;
  const ch = rawChapter ? await s.hydrate(rawChapter) : null;
  if (ch) revision(ch, body.chapterRevision);
  else
    check(
      body.chapterRevision == null,
      "원고 상태가 바뀌었습니다. 새로 불러와주세요.",
      409,
    );
  const seq = (p.chatSequence ?? 0) + 1;
  check(seq < 100000000, "대화 보관 한도에 도달했습니다.", 413);
  const key = turnId(seq),
    previous = await chatHistory(s, p, undefined, 12);
  const refs = await Promise.all(
    (p.assistantAttachments ?? [])
      .slice(-3)
      .map((a: Doc) => s.get(`projects/${p.id}/chat_files/${a.id}`)),
  );
  const { result, run } = await generate(
    s,
    writing ? "chat_write" : "chat_plan",
    {
      current_user_message: body.message,
      mode: body.mode,
      conversation: previous.turns.slice(-12).map((t: Doc) => ({
        user: t.message,
        assistant: t.reply,
        questions: t.questions,
        mode: t.mode,
        episode: t.episode,
      })),
      previous_summary: p.chatSummary ?? "",
      conversation_canon: canonContext(p),
      current_plan: p.chatPlan ?? p.launchPlan ?? null,
      initial_idea: p.brief?.text ?? "",
      requested_genre: p.genre,
      project_title: p.title,
      reference_files: refs.map((r: Doc) => ({
        name: r.name,
        kind: r.kind,
        text: cut(r.text, 0, 12000),
        truncated: length(r.text) > 12000,
      })),
      story: storyContext(p),
      episode_synopsis: p.episodeSynopsis ?? null,
      chapter: ch
        ? {
            id: ch.id,
            title: ch.title,
            content: ch.content,
            locked: ["APPROVED", "LOCKED"].includes(ch.status),
          }
        : null,
      available_actions: {
        editManuscript: !!ch && !["APPROVED", "LOCKED"].includes(ch.status),
        plan: !writing,
      },
    },
    body,
    { projectId: p.id, mode: body.mode },
  );
  if (result.plan) {
    check(!writing, "집필 대화에서는 기획안을 새로 시작하지 않습니다.", 422);
    validateLaunchPlan(result.plan);
  }
  check(
    !result.edits.length ||
      (writing && ch && !["APPROVED", "LOCKED"].includes(ch.status)),
    "원고 수정은 집필실의 편집 가능한 초안에서 요청해주세요.",
    422,
  );
  if (result.edits.length) applyChatEdits(ch!.content, result.edits);
  const canon = mergeCanon(p, result.canonChanges, body.message, key);
  const next: Doc = {
    ...p,
    chatSequence: seq,
    chatSummary: result.summary,
    conversationCanon: canon,
  };
  if (result.plan) {
    next.chatPlan = result.plan;
    next.chatPlanTurn = key;
  }
  // Settings remain visible while manuscripts keep their original text. New generation sees latest canon.
  if (result.canonChanges.length)
    next.conversationVersion = (p.conversationVersion ?? 0) + 1;
  const turn = s.prepare(`projects/${p.id}/chat_turns/${key}`, {
    id: key,
    sequence: seq,
    message: body.message,
    reply: result.reply,
    questions: result.questions,
    savedCanon: result.canonChanges,
    hasPlan: !!result.plan,
    mode: body.mode,
    episode: episodeNumber(p),
    storyRevision: p.storyRevision ?? 0,
    createdAt: now(),
    run,
    editProposal: result.edits.length
      ? {
          edits: result.edits,
          chapterId: ch!.id,
          inputHash: ch!.contentHash,
          inputRevision: ch!.revision,
          conversationVersion: next.conversationVersion ?? 0,
          status: "PROPOSED",
        }
      : null,
  });
  const project = s.prepare(`projects/${p.id}`, next, p.revision);
  const ops = [project, turn];
  if (rawChapter)
    ops.push({
      path: chapterPath(p),
      expected: rawChapter.revision,
      guard: true,
    });
  if (result.canonChanges.length)
    ops.push(
      s.prepare(`projects/${p.id}/canon_history/${key}`, {
        before: p.conversationCanon ?? [],
        after: canon,
        evidence: body.message,
        createdAt: now(),
      }),
    );
  await s.commit(ops);
  return { project: project.data, turn: turn.data };
}
export async function editCanon(s: Store, p: Doc, body: Doc) {
  validate("CanonEdit", body);
  revision(p, body.revision);
  const canon = mergeCanon(
    p,
    [{ ...body, evidence: body.content.slice(0, 200) }],
    body.content,
    "manual",
  );
  canon.find((c) => c.id === body.id)!.archived = body.archived;
  const op = s.prepare(
    `projects/${p.id}`,
    {
      ...p,
      conversationCanon: canon,
      conversationVersion: (p.conversationVersion ?? 0) + 1,
    },
    p.revision,
  );
  await s.commit([
    op,
    s.prepare(`projects/${p.id}/canon_history/${id()}`, {
      before: p.conversationCanon ?? [],
      after: canon,
      createdAt: now(),
      source: "manual",
    }),
  ]);
  return op.data;
}
export async function activateChatPlan(s: Store, p: Doc, body: Doc) {
  validate("Confirm", body);
  revision(p, body.revision);
  check(
    body.confirmed && p.chatPlan,
    "대화로 기획안을 먼저 만들어주세요. '알아서 기획해줘'라고 요청할 수 있습니다.",
    422,
  );
  check(
    !p.seriesEnabled && !(await s.find(chapterPath(p))),
    "이미 시놉시스나 원고가 있습니다. 대화의 새 설정은 다음 생성부터 반영됩니다. 기존 원고를 보존해 재기획하려면 새 작품에서 시작해주세요.",
    409,
  );
  const proposalId = id();
  const proposal = s.prepare(
    `projects/${p.id}/launch_proposals/${proposalId}`,
    {
      id: proposalId,
      status: "PROPOSED",
      inputRevision: p.revision,
      plan: p.chatPlan,
      source: "conversation",
    },
  );
  await s.commit([
    { path: `projects/${p.id}`, expected: p.revision, guard: true },
    proposal,
  ]);
  return applyLaunch(s, p, {
    revision: p.revision,
    confirmed: true,
    proposalId,
    plan: p.chatPlan,
  });
}
