import { Store } from "./store";
import {
  type Doc,
  revision,
  active,
  requireThat as check,
  id,
  now,
} from "./shared";
import { validate } from "./validation";
import { generate } from "./ai";
import { validateStoryBatch } from "./story-ledger";
export const episodeNumber = (p: Doc) => p.currentEpisode ?? 1;
export const chapterId = (p: Doc, number = episodeNumber(p)) =>
  `${p.storyRevision ? `story-${p.storyRevision}-` : ""}chapter-${number}`;
export const chapterPath = (p: Doc, number = episodeNumber(p)) =>
  `projects/${p.id}/chapters/${chapterId(p, number)}`;
export const episodePlanPath = (p: Doc, number = episodeNumber(p)) =>
  `projects/${p.id}/episode_plans/${p.storyRevision ? `story-${p.storyRevision}-` : ""}episode-${number}`;
const done = (ch: Doc | null) =>
  ch && ["APPROVED", "LOCKED"].includes(ch.status);

export function fitLength(plot: Doc, target?: number): Doc {
  if (!target) return plot;
  const count = plot.scenes.length;
  check(
    target >= count * 200 && target <= count * 5000,
    "설정한 분량에 맞는 장면 수가 필요합니다. 회차를 다시 설계하거나 자동 전개로 장면을 구체화해주세요.",
    422,
  );
  const weights = plot.scenes.map((s: Doc) =>
    Number.isFinite(s.targetChars) && s.targetChars > 0 ? s.targetChars : 1,
  );
  const remaining = new Set<number>(weights.map((_w: number, i: number) => i)),
    lengths: number[] = [];
  let available = target;
  while (remaining.size) {
    const indices = [...remaining],
      sum = indices.reduce((n, i) => n + weights[i], 0);
    const quota = (i: number) => (available * weights[i]) / sum;
    // Clamp minimums first so short setup beats cannot be crowded out.
    const low = indices.find((i) => quota(i) < 200);
    const high =
      low === undefined ? indices.find((i) => quota(i) > 5000) : undefined;
    const fixed = low ?? high;
    if (fixed !== undefined) {
      lengths[fixed] = low !== undefined ? 200 : 5000;
      available -= lengths[fixed];
      remaining.delete(fixed);
      continue;
    }
    for (const i of indices) lengths[i] = Math.floor(quota(i));
    let rest = available - indices.reduce((n, i) => n + lengths[i], 0);
    for (const i of indices.sort((a, b) => (quota(b) % 1) - (quota(a) % 1)))
      if (rest > 0 && lengths[i] < 5000) {
        lengths[i]++;
        rest--;
      }
    break;
  }
  return {
    ...plot,
    scenes: plot.scenes.map((scene: Doc, i: number) => ({
      ...scene,
      targetChars: lengths[i],
    })),
  };
}
export async function synopsisState(s: Store, p: Doc) {
  const batches = (await s.list(`projects/${p.id}/synopsis_batches`))
    .filter(
      (b: Doc) =>
        b.status === "APPLIED" &&
        (b.storyRevision ?? 0) === (p.storyRevision ?? 0),
    )
    .sort((a: Doc, b: Doc) => a.start - b.start);
  const end = batches.at(-1)?.end ?? 0;
  const completed = p.completedEpisodes ?? [];
  return {
    batches,
    currentEpisode: episodeNumber(p),
    targetChars: p.targetChars ?? 5000,
    completedEpisodes: completed,
    nextStart: end + 1,
    canExtend:
      !end ||
      Array.from({ length: 10 }, (_, i) => end - 9 + i).every((n) =>
        completed.includes(n),
      ),
    seeds: p.foreshadowing ?? [],
    worldFacts: p.storyFacts ?? [],
  };
}
export async function proposeSynopsis(s: Store, p: Doc, body: Doc) {
  validate("AIRequest", body);
  revision(p, body.revision);
  active(p);
  const state = await synopsisState(s, p),
    start = state.nextStart,
    end = start + 9;
  check(
    state.canExtend,
    `${start - 1}화 원고를 확정한 뒤 다음 10화 시놉시스를 이어가세요.`,
    409,
  );
  const recent = (await s.list(`projects/${p.id}/chapters`))
    .filter(
      (ch: Doc) =>
        done(ch) &&
        (ch.number ?? 1) < start &&
        (ch.storyRevision ?? 0) === (p.storyRevision ?? 0),
    )
    .sort((a: Doc, b: Doc) => (b.number ?? 1) - (a.number ?? 1))
    .slice(0, 10)
    .map((ch: Doc) => ({
      number: ch.number ?? 1,
      title: ch.title,
      summary: ch.review?.summary ?? "",
      tail: (ch.content ?? "").slice(-700),
    }));
  const { result, run } = await generate(
    s,
    "synopsis",
    {
      start,
      end,
      targetChars: p.defaultTargetChars ?? p.targetChars ?? 5000,
      common_planning_tree:
        p.planningMode === "launch" ? null : (p.planningTree ?? null),
      launch_plan: p.launchPlan ?? null,
      foreshadowing: p.foreshadowing ?? [],
      worldFacts: p.storyFacts ?? [],
      requirements: p.requirements,
      answers: p.answers,
      character_names: p.characterNames ?? [],
      previous_batch: state.batches.at(-1)?.result ?? null,
      completed_episodes: recent,
      current_episode_plot: p.plot ?? null,
    },
    body,
    { projectId: p.id, start, end },
  );
  check(
    result.episodes.every((e: Doc, i: number) => e.number === start + i),
    "시놉시스는 요청한 10개 회차를 번호 순서대로 모두 포함해야 합니다.",
    422,
  );
  validateStoryBatch(p, result, start, end);
  const key = id(),
    op = s.prepare(`projects/${p.id}/synopsis_batches/${key}`, {
      id: key,
      start,
      end,
      status: "PROPOSED",
      inputRevision: p.revision,
      result,
      run,
      createdAt: now(),
      storyRevision: p.storyRevision ?? 0,
    });
  await s.commit([
    { path: `projects/${p.id}`, expected: p.revision, guard: true },
    op,
  ]);
  return op.data;
}
export async function applySynopsis(s: Store, p: Doc, body: Doc) {
  validate("ApplyPlanning", body);
  revision(p, body.revision);
  active(p);
  check(
    body.confirmed && /^[A-Za-z0-9_-]+$/.test(body.proposalId),
    "시놉시스를 확인해주세요.",
    422,
  );
  const path = `projects/${p.id}/synopsis_batches/${body.proposalId}`,
    proposal = await s.get(path);
  const state = await synopsisState(s, p);
  check(
    proposal.status === "PROPOSED" &&
      proposal.inputRevision === p.revision &&
      proposal.start === state.nextStart,
    "시놉시스 제안 이후 기획이나 진행 상황이 변경되었습니다.",
    409,
  );
  const next = structuredClone(p);
  const ledger = validateStoryBatch(
    p,
    proposal.result,
    proposal.start,
    proposal.end,
  );
  next.foreshadowing = ledger.seeds;
  next.storyFacts = ledger.facts;
  next.seriesEnabled = true;
  next.targetChars ??=
    p.plot?.scenes?.reduce(
      (sum: number, scene: Doc) => sum + scene.targetChars,
      0,
    ) || 5000;
  next.defaultTargetChars ??= next.targetChars;
  next.currentEpisode ??= 1;
  next.episodeSynopsis ??=
    proposal.result.episodes.find(
      (e: Doc) => e.number === next.currentEpisode,
    ) ?? null;
  next.synopsisThrough = proposal.end;
  const extras = [];
  if (
    proposal.start > 1 &&
    next.currentEpisode === proposal.start - 1 &&
    (p.completedEpisodes ?? []).includes(proposal.start - 1)
  ) {
    const source = episodePlanPath(p, next.currentEpisode),
      old = await s.find(source);
    extras.push(
      s.prepare(
        source,
        {
          number: next.currentEpisode,
          plot: p.plot ?? null,
          targetChars: p.targetChars ?? 5000,
        },
        old?.revision ?? 0,
      ),
    );
    next.currentEpisode = proposal.start;
    next.episodeSynopsis = proposal.result.episodes[0];
    next.plot = null;
    next.targetChars = p.defaultTargetChars ?? 5000;
  }
  const op = s.prepare(`projects/${p.id}`, next, p.revision);
  await s.commit([
    op,
    s.prepare(
      path,
      { ...proposal, status: "APPLIED", appliedAt: now() },
      proposal.revision,
    ),
    ...extras,
  ]);
  return op.data;
}
export async function selectEpisode(s: Store, p: Doc, body: Doc) {
  validate("SelectEpisode", body);
  revision(p, body.revision);
  active(p);
  if (body.number === episodeNumber(p)) return p;
  const state = await synopsisState(s, p);
  const synopsis = state.batches
    .flatMap((b: Doc) => b.result.episodes)
    .find((e: Doc) => e.number === body.number);
  check(synopsis, "먼저 해당 구간의 시놉시스를 만들어주세요.", 422);
  const source = episodePlanPath(p);
  const old = await s.find(source),
    target = await s.find(episodePlanPath(p, body.number));
  const next = {
    ...p,
    currentEpisode: body.number,
    episodeSynopsis: synopsis,
    plot: target?.plot ?? null,
    targetChars: target?.targetChars ?? p.defaultTargetChars ?? 5000,
  };
  if (
    next.plot?.status === "APPROVED" &&
    next.plot.canonVersion !== p.canonVersion
  )
    next.plot = { ...next.plot, status: "INVALIDATED" };
  const op = s.prepare(`projects/${p.id}`, next, p.revision);
  await s.commit([
    op,
    s.prepare(
      source,
      {
        number: episodeNumber(p),
        plot: p.plot ?? null,
        targetChars: p.targetChars ?? 5000,
      },
      old?.revision ?? 0,
    ),
  ]);
  return op.data;
}
export async function writingSettings(s: Store, p: Doc, body: Doc) {
  validate("WritingSettings", body);
  revision(p, body.revision);
  active(p);
  const ch = await s.find(chapterPath(p));
  check(
    !ch || !(ch.charCountWithSpaces > 0),
    "이미 집필한 회차의 분량은 보존합니다. 다음 회차로 이동한 뒤 목표 분량을 설정해주세요.",
    409,
  );
  return s.change(`projects/${p.id}`, body.revision, (d) => {
    d.targetChars = body.targetChars;
    d.defaultTargetChars = body.targetChars;
    if (d.plot) d.plot.status = "INVALIDATED";
    // Keep the existing scenes even when the new length needs more scenes.
    if (d.plot && body.targetChars <= d.plot.scenes.length * 5000)
      d.plot = fitLength(d.plot, body.targetChars);
  });
}
export async function requirePreviousChapter(s: Store, p: Doc) {
  const number = episodeNumber(p);
  if (number > 1)
    check(
      done(await s.find(chapterPath(p, number - 1))),
      `${number - 1}화 원고를 확정한 뒤 다음 회차를 집필해주세요.`,
      409,
    );
}
