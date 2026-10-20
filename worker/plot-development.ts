import { Store } from "./store";
import {
  type Doc,
  active,
  revision,
  requireThat as check,
  id,
  now,
} from "./shared";
import { validate } from "./validation";
import { generate } from "./ai";
import { planningCarryover } from "../lib/planning-tree";
import { fitLength } from "./series";
import { storyContext, checkPlotSeeds } from "./story-ledger";

export function developmentIssues(plot: Doc): Doc[] {
  return [
    ...(plot.risks ?? []).map((text: string, i: number) => ({
      id: "risk-" + i,
      text,
    })),
    ...(plot.openQuestions ?? []).map((text: string, i: number) => ({
      id: "question-" + i,
      text,
    })),
  ];
}
export function plotBody(plot: Doc): Doc {
  return Object.fromEntries(
    [
      "direction",
      "arcs",
      "chapterTitle",
      "scenes",
      "risks",
      "openQuestions",
      "continuationNotes",
    ]
      .filter((key) => plot[key] !== undefined)
      .map((key) => [key, plot[key]]),
  );
}
export function developmentPreview(
  before: Doc,
  result: Doc,
  gaps: Doc[] = [],
): Doc {
  validate("PlotDevelopment", result);
  const issues = [...developmentIssues(before), ...gaps],
    known = new Map(issues.map((i) => [i.id, i]));
  const decisions = new Map<string, Doc>(
    result.decisions.map((d: Doc) => [d.issueId, d]),
  );
  check(
    decisions.size === result.decisions.length &&
      decisions.size === issues.length &&
      [...decisions.keys()].every((key) => known.has(key)),
    "기존 미정·위험마다 해결 또는 이후 전개 근거가 필요합니다. 자동 재요청하지 않았습니다.",
    422,
  );
  const proposed = structuredClone(result.plot),
    ids = new Set(proposed.scenes.map((s: Doc) => s.id));
  check(
    ids.size === proposed.scenes.length &&
      before.scenes.every((s: Doc) => ids.has(s.id)),
    "기존 장면의 ID를 보존하고 중복 없이 전개해야 합니다.",
    422,
  );
  for (const decision of result.decisions)
    check(
      !(
        known.get(decision.issueId)?.scope === "current" &&
        decision.disposition === "later"
      ),
      "현재 회차에 꼭 필요한 누락은 구체화하거나 확인할 문제로 남겨야 합니다.",
      422,
    );
  proposed.openQuestions = [
    ...new Set([
      ...proposed.openQuestions,
      ...result.decisions
        .filter((d: Doc) => d.disposition === "unresolved")
        .map((d: Doc) => `${known.get(d.issueId)!.text} — ${d.resolution}`),
    ]),
  ];
  if (result.decisions.some((d: Doc) => d.disposition === "resolved")) {
    const keys = ["startState", "goal", "action", "endState", "causalEvidence"];
    check(
      proposed.scenes.some((scene: Doc) => {
        const old = before.scenes.find((s: Doc) => s.id === scene.id);
        return !old || keys.some((key) => scene[key] !== old[key]);
      }),
      "미정·위험을 해결한 내용을 장면의 목표·행동·결과에 실제로 반영해야 합니다.",
      422,
    );
  }
  proposed.continuationNotes = [
    ...new Set([
      ...(before.continuationNotes ?? []),
      ...(proposed.continuationNotes ?? []),
      ...result.decisions
        .filter((d: Doc) => d.disposition === "later")
        .map((d: Doc) => `${known.get(d.issueId)!.text} — ${d.resolution}`),
    ]),
  ];
  return proposed;
}
function developmentInput(p: Doc) {
  return {
    current_plot: plotBody(p.plot),
    issues: developmentIssues(p.plot),
    common_planning_tree:
      p.planningMode === "launch" ? null : (p.planningTree ?? null),
    approved_bible: ["tree", "launch"].includes(p.planningMode) ? {} : p.bible,
    story: storyContext(p),
    approved_style: p.styleBinding?.snapshot ?? null,
    character_names: p.characterNames ?? [],
    requirements: p.requirements,
    answers: p.answers,
    pending_planning: planningCarryover(p),
    episode_synopsis: p.episodeSynopsis ?? null,
    targetChars: p.targetChars ?? 5000,
  };
}
async function loadDevelopmentAudit(s: Store, p: Doc, auditId: string | null) {
  if (!auditId) return [];
  check(/^[A-Za-z0-9_-]+$/.test(auditId), "점검 ID를 확인하세요.", 422);
  const audit = await s.get(`projects/${p.id}/plot_checks/${auditId}`);
  check(
    audit.inputRevision === p.revision,
    "기획이나 플롯이 변경됐습니다. 누락 점검부터 다시 실행해주세요.",
    409,
  );
  return audit.result.gaps.map((g: Doc) => ({
    id: g.id,
    text: `${g.title}: ${g.detail}`,
    scope: g.scope,
  }));
}
export async function checkDevelopment(s: Store, p: Doc, body: Doc) {
  validate("AIRequest", body);
  revision(p, body.revision);
  active(p);
  check(
    p.plot && p.plot.status !== "APPROVED",
    "승인 전 플롯에서 전개를 점검해주세요.",
    409,
  );
  const { result, run } = await generate(
    s,
    "plot_develop_check",
    developmentInput(p),
    body,
    { projectId: p.id },
  );
  check(
    new Set(result.gaps.map((g: Doc) => g.id)).size === result.gaps.length,
    "중복된 누락 항목이 있습니다. 자동 재요청하지 않았습니다.",
    422,
  );
  const key = id(),
    op = s.prepare(`projects/${p.id}/plot_checks/${key}`, {
      id: key,
      inputRevision: p.revision,
      result,
      run,
      createdAt: now(),
    });
  await s.commit([
    { path: `projects/${p.id}`, expected: p.revision, guard: true },
    op,
  ]);
  return op.data;
}
export async function proposeDevelopment(s: Store, p: Doc, body: Doc) {
  validate("PlotDevelopRequest", body);
  revision(p, body.revision);
  active(p);
  check(
    p.plot && p.plot.status !== "APPROVED",
    "승인 전 플롯에서 자동 전개를 실행해주세요.",
    409,
  );
  const gaps = await loadDevelopmentAudit(s, p, body.auditId);
  const { result, run } = await generate(
    s,
    "plot_develop",
    { ...developmentInput(p), issues: [...developmentIssues(p.plot), ...gaps] },
    body,
    { projectId: p.id },
  );
  const preview = fitLength(
      developmentPreview(p.plot, result, gaps),
      p.targetChars,
    ),
    key = id();
  checkPlotSeeds(p, preview);
  const op = s.prepare(`projects/${p.id}/plot_proposals/${key}`, {
    id: key,
    inputRevision: p.revision,
    status: "PROPOSED",
    result,
    preview,
    run,
    auditId: body.auditId,
    issues: [...developmentIssues(p.plot), ...gaps],
    createdAt: now(),
  });
  await s.commit([
    { path: `projects/${p.id}`, expected: p.revision, guard: true },
    op,
  ]);
  return op.data;
}
export async function applyDevelopment(s: Store, p: Doc, body: Doc) {
  validate("ApplyPlanning", body);
  revision(p, body.revision);
  active(p);
  check(body.confirmed, "자동 전개안을 확인하고 반영해주세요.", 422);
  check(
    p.plot && p.plot.status !== "APPROVED",
    "승인 전 플롯에만 전개안을 반영할 수 있습니다.",
    409,
  );
  check(
    /^[A-Za-z0-9_-]+$/.test(body.proposalId),
    "전개 제안 ID를 확인하세요.",
    422,
  );
  const path = `projects/${p.id}/plot_proposals/${body.proposalId}`,
    proposal = await s.get(path);
  check(
    proposal.status === "PROPOSED" && proposal.inputRevision === p.revision,
    "플롯이나 기획이 변경됐습니다. 최신 내용을 확인한 뒤 다시 전개해주세요.",
    409,
  );
  const gaps = await loadDevelopmentAudit(s, p, proposal.auditId ?? null);
  const preview = fitLength(
    developmentPreview(p.plot, proposal.result, gaps),
    p.targetChars,
  );
  checkPlotSeeds(p, preview);
  const next = structuredClone(p);
  next.plot = {
    ...preview,
    status: "REVIEW",
    version: (p.plot.version ?? 0) + 1,
    canonVersion: p.canonVersion,
    run: proposal.run,
  };
  const op = s.prepare(`projects/${p.id}`, next, p.revision);
  await s.commit([
    op,
    s.prepare(
      path,
      { ...proposal, status: "APPLIED", appliedAt: now() },
      proposal.revision,
    ),
    s.prepare(`projects/${p.id}/plot_history/${id()}`, {
      beforePlot: p.plot,
      proposalId: proposal.id,
      summary: proposal.result.summary,
      decisions: proposal.result.decisions,
      auditId: proposal.auditId ?? null,
      createdAt: now(),
    }),
  ]);
  return op.data;
}
