import { Store } from "./store";
import {
  type Doc,
  revision,
  requireThat as check,
  id,
  now,
  hash,
} from "./shared";
import { validate } from "./validation";
import { generate } from "./ai";
export function validateLaunchPlan(plan: Doc) {
  validate("LaunchPlan", plan);
  plan.worldRules ??= [];
  plan.sourceConflicts ??= [];
  check(
    new Set(plan.characters.map((c: Doc) => c.id)).size ===
      plan.characters.length &&
      plan.characters.some((c: Doc) => c.id === plan.protagonistId),
    "주인공과 등장인물의 ID를 확인해주세요.",
    422,
  );
}
export async function proposeLaunch(s: Store, p: Doc, body: Doc) {
  validate("AIRequest", body);
  revision(p, body.revision);
  const { result, run } = await generate(
    s,
    "launch_plan",
    {
      raw_source: p.brief.text,
      project_title: p.title,
      requested_genre: p.genre === "파일에서 자동 분석" ? null : p.genre,
      editorial_direction:
        "초반의 강한 사건·주인공의 매력·즉각적인 독자 보상. 장편을 위한 지연과 설명보다 재미를 우선한다.",
    },
    body,
    { projectId: p.id },
  );
  validateLaunchPlan(result);
  const key = id(),
    op = s.prepare(`projects/${p.id}/launch_proposals/${key}`, {
      id: key,
      plan: result,
      inputRevision: p.revision,
      status: "PROPOSED",
      run,
      createdAt: now(),
    });
  await s.commit([
    { path: `projects/${p.id}`, expected: p.revision, guard: true },
    op,
  ]);
  return op.data;
}
export async function applyLaunch(s: Store, p: Doc, body: Doc) {
  validate("ApplyLaunch", body);
  revision(p, body.revision);
  validateLaunchPlan(body.plan);
  check(
    body.confirmed && /^[A-Za-z0-9_-]+$/.test(body.proposalId),
    "기획안을 확인하고 반영해주세요.",
    422,
  );
  const path = `projects/${p.id}/launch_proposals/${body.proposalId}`,
    proposal = await s.get(path);
  check(
    proposal.status === "PROPOSED" && proposal.inputRevision === p.revision,
    "기획 제안 후 자료가 바뀌었습니다. 최신 파일로 다시 기획해주세요.",
    409,
  );
  const plan = body.plan,
    version = (p.storyRevision ?? 0) + 1,
    canon = (p.canonVersion ?? 0) + 1;
  const style = {
    id: "launch-style",
    name: "기획안의 문체",
    profileVersion: canon,
    rules: {
      voice: plan.style,
      readerPromise: plan.readerPromise,
      opening: plan.opening,
      engine: plan.storyEngine,
    },
    selectedVariant: null,
  };
  const next = {
    ...p,
    title: plan.title,
    genre: plan.genre,
    planningMode: "launch",
    launchPlan: plan,
    bible: {},
    planningTree: null,
    analysis: null,
    answers: {},
    bibleAudit: null,
    planningDecisions: [],
    storyRevision: version,
    canonVersion: canon,
    status: "ACTIVE",
    approvedAt: now(),
    currentEpisode: 1,
    episodeSynopsis: null,
    plot: null,
    synopsisThrough: 0,
    completedEpisodes: [],
    seriesEnabled: false,
    targetChars: p.defaultTargetChars ?? 5000,
    characterNames: plan.characters.map((c: Doc) => ({
      entityId: c.id,
      name: c.name,
      role: c.role,
      background: c.background,
    })),
    styleBinding: {
      source: "launch",
      styleId: "launch-style",
      pinnedVersion: canon,
      snapshot: style,
      hash: await hash(JSON.stringify(style)),
    },
    foreshadowing: [],
    storyFacts: plan.worldRules.map((statement: string, i: number) => ({
      id: `launch-rule-${i + 1}`,
      statement,
      introducedEpisode: 0,
      status: "established",
    })),
  };
  const op = s.prepare(`projects/${p.id}`, next, p.revision);
  await s.commit([
    op,
    s.prepare(
      path,
      { ...proposal, status: "APPLIED", appliedAt: now() },
      proposal.revision,
    ),
    s.prepare(`projects/${p.id}/launch_history/${id()}`, {
      beforeProject: p,
      nextStoryRevision: version,
      createdAt: now(),
    }),
  ]);
  return op.data;
}
export async function draftLaunch(s: Store, p: Doc, body: Doc) {
  validate("Revision", body);
  revision(p, body.revision);
  check(p.launchPlan, "먼저 파일에서 기획안을 만들어주세요.", 422);
  const key = id(),
    op = s.prepare(`projects/${p.id}/launch_proposals/${key}`, {
      id: key,
      plan: p.launchPlan,
      inputRevision: p.revision,
      status: "PROPOSED",
      run: null,
      createdAt: now(),
    });
  await s.commit([
    { path: `projects/${p.id}`, expected: p.revision, guard: true },
    op,
  ]);
  return op.data;
}
