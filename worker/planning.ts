import { Store } from "./store";
import {
  type Doc,
  requireThat as check,
  revision,
  id,
  now,
  invalidate,
} from "./shared";
import { validate } from "./validation";
import { generate } from "./ai";
import assets from "./assets.json";
const modules: Record<string, string> = assets.modules;
export function validateProposal(
  p: Doc,
  key: string,
  draft: Doc,
  focus: string,
  result: Doc,
) {
  validate(
    "PlanningProposal",
    Object.fromEntries(
      ["summary", "decisions", "characterNames", "sections", "unresolved"].map(
        (k) => [k, result[k]],
      ),
    ),
  );
  const changed = result.sections.map((s: Doc) => s.key);
  check(
    new Set(changed).size === changed.length &&
      changed.includes(key) &&
      changed.every((k: string) => k in modules),
    "자동 기획의 수정 모듈이 올바르지 않습니다.",
    422,
  );
  const known = new Set(p.requirements.map((r: Doc) => r.id));
  for (const patch of result.sections)
    check(
      patch.section.requirementIds.every((rid: string) => known.has(rid)),
      "자동 기획에 잘못된 원문 근거가 있습니다.",
      422,
    );
  check(
    result.decisions.every((d: Doc) =>
      d.affectedSections.every((k: string) => changed.includes(k)),
    ),
    "결정의 변경 영향이 실제 모듈에 반영되지 않았습니다.",
    422,
  );
  const current = { ...p.bible, [key]: draft },
    next = {
      ...current,
      ...Object.fromEntries(
        result.sections.map((s: Doc) => [s.key, s.section]),
      ),
    };
  const before = new Set(
    Object.values(current).flatMap((s: any) => s.requirementIds),
  );
  const after = new Set(
    Object.values(next).flatMap((s: any) => s.requirementIds),
  );
  check(
    [...before].every((rid) => after.has(rid)),
    "기존 원문 근거가 사라지는 기획은 적용할 수 없습니다.",
    422,
  );
  const issues =
    focus === "all"
      ? [...draft.openQuestions, ...draft.conflicts]
      : draft[focus];
  check(
    issues.every(
      (issue: string) =>
        result.decisions.some((d: Doc) => d.issue === issue) ||
        result.unresolved.includes(issue),
    ),
    "일부 미정/충돌에 대한 해결이나 미해결 기록이 빠졌습니다.",
    422,
  );
  for (const patch of result.sections) {
    const previous = patch.key === key ? draft : p.bible[patch.key];
    if (!previous) continue;
    for (const issue of [...previous.openQuestions, ...previous.conflicts]) {
      const kept = [
        ...patch.section.openQuestions,
        ...patch.section.conflicts,
      ].includes(issue);
      check(
        kept ||
          result.decisions.some((d: Doc) => d.issue === issue) ||
          result.unresolved.includes(issue),
        "기존 미정/충돌을 해결 근거 없이 지울 수 없습니다.",
        422,
      );
    }
  }
  check(
    new Set(result.characterNames.map((n: Doc) => n.role)).size ===
      result.characterNames.length,
    "인물 역할마다 하나의 이름 기획을 제안해주세요.",
    422,
  );
  if (result.characterNames.length) {
    check(
      changed.some((k: string) => ["characters", "protagonist"].includes(k)),
      "기획한 이름을 인물 모듈에도 반영해야 합니다.",
      422,
    );
    const text = result.sections
      .filter((x: Doc) => ["characters", "protagonist"].includes(x.key))
      .map((x: Doc) => x.section.content)
      .join("\n");
    check(
      result.characterNames.every((n: Doc) => text.includes(n.name)),
      "기획한 이름이 실제 상세 기획에 반영되지 않았습니다.",
      422,
    );
  }
  for (const unresolved of result.unresolved)
    check(
      result.sections.some((s: Doc) =>
        [...s.section.openQuestions, ...s.section.conflicts].includes(
          unresolved,
        ),
      ),
      "미해결 항목을 기획서에 유지해야 합니다.",
      422,
    );
}
export async function proposePlanning(
  s: Store,
  p: Doc,
  key: string,
  body: Doc,
) {
  validate("AutoPlanRequest", body);
  revision(p, body.revision);
  check(key in modules && p.bible[key], "자동 기획할 모듈이 없습니다.", 404);
  const issues =
    body.focus === "all"
      ? [...body.section.openQuestions, ...body.section.conflicts]
      : body.section[body.focus];
  const input = {
    section: key,
    sectionTitle: modules[key],
    focus: body.focus,
    focus_issues: issues,
    current_section: body.section,
    bible: { ...p.bible, [key]: body.section },
    requirements: p.requirements,
    answers: p.answers,
    planning_decisions: p.planningDecisions ?? [],
    existing_character_names: p.characterNames ?? [],
    style: p.styleBinding,
  };
  const { result, run } = await generate(s, "auto_plan", input, body, {
    projectId: p.id,
    section: key,
  });
  validateProposal(p, key, body.section, body.focus, result);
  const proposal = s.prepare(
    `projects/${p.id}/planning_proposals/${run.requestId}`,
    {
      id: run.requestId,
      status: "PROPOSED",
      inputRevision: p.revision,
      sectionKey: key,
      focus: body.focus,
      inputSection: body.section,
      ...result,
      run,
      createdAt: now(),
    },
  );
  // A concurrent project edit must not publish a proposal for the wrong revision.
  await s.commit([
    { path: "projects/" + p.id, expected: p.revision, guard: true },
    proposal,
  ]);
  return proposal.data;
}
export async function applyPlanning(s: Store, p: Doc, body: Doc) {
  validate("ApplyPlanning", body);
  revision(p, body.revision);
  check(body.confirmed, "자동 기획 결과를 확인하고 적용해주세요.");
  const path = `projects/${p.id}/planning_proposals/${body.proposalId}`,
    proposal = await s.get(path);
  check(
    proposal.status === "PROPOSED" && proposal.inputRevision === p.revision,
    "자동 기획 이후 기획서가 바뀌었습니다. 최신 내용으로 다시 생성하세요.",
  );
  validateProposal(
    p,
    proposal.sectionKey,
    proposal.inputSection,
    proposal.focus,
    proposal,
  );
  const changed = new Set(proposal.sections.map((x: Doc) => x.key));
  const next = structuredClone(p);
  invalidate(next);
  next.status = "BIBLE_REVIEW";
  next.bibleAudit = null;
  for (const [key, sec] of Object.entries(next.bible) as [string, Doc][])
    if (!changed.has(key)) sec.needsReview = true;
  for (const patch of proposal.sections)
    next.bible[patch.key] = {
      ...patch.section,
      needsReview: false,
      planningProposalId: proposal.id,
      run: proposal.run,
    };
  next.planningDecisions = [
    ...(next.planningDecisions ?? []),
    ...proposal.decisions.map((d: Doc) => ({
      ...d,
      proposalId: proposal.id,
      appliedAt: now(),
    })),
  ];
  const names = new Map(
    (next.characterNames ?? []).map((n: Doc) => [n.role, n]),
  );
  for (const n of proposal.characterNames) names.set(n.role, n);
  next.characterNames = [...names.values()];
  const op = s.prepare("projects/" + p.id, next, p.revision),
    auditId = id();
  await s.commit([
    op,
    s.prepare(
      path,
      { ...proposal, status: "APPLIED", appliedAt: now() },
      proposal.revision,
    ),
    s.prepare(`projects/${p.id}/planning_history/${auditId}`, {
      id: auditId,
      proposalId: proposal.id,
      beforeBible: p.bible,
      beforeDecisions: p.planningDecisions ?? [],
      beforeCharacterNames: p.characterNames ?? [],
      changedSections: [...changed],
      createdAt: now(),
    }),
  ]);
  return op.data;
}
