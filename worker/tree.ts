import { Store } from "./store";
import {
  type Doc,
  id,
  now,
  revision,
  requireThat as check,
  invalidate,
} from "./shared";
import { validate } from "./validation";
import { generate } from "./ai";
import {
  branchLabels,
  moduleBranches,
  moduleLabels,
  entityReferences,
  descendants,
  renderReferences,
} from "../lib/planning-tree";
export function seedTree(p: Doc): Doc {
  if (p.planningTree) return structuredClone(p.planningTree);
  const nodes = Object.entries(branchLabels).map(([key, title]) => ({
    id: key,
    parentId: key === "root" ? null : "root",
    kind: key === "root" ? "root" : "branch",
    title,
    content:
      key === "root"
        ? `${p.title}의 독자 약속과 중심 갈등을 함께 설계합니다.`
        : `${title}의 큰 방향을 공통 기획에서 연결합니다.`,
    entityIds: [],
    requirementIds: [],
    dependsOn: [],
    status: "draft",
  }));
  const issues: Doc[] = [];
  for (const [key, section] of Object.entries(p.bible ?? {}) as [
    string,
    Doc,
  ][]) {
    const nid = "module-" + key;
    nodes.push({
      id: nid,
      parentId: moduleBranches[key] ?? "root",
      kind: "detail",
      title: "기존 문서 · " + (moduleLabels[key] ?? key),
      content: section.content,
      entityIds: [],
      requirementIds: section.requirementIds ?? [],
      dependsOn: [],
      status: section.needsReview ? "needsReview" : "draft",
    });
    for (const type of ["openQuestions", "conflicts"])
      for (const [i, text] of (section[type] ?? []).entries())
        issues.push({
          id: `legacy-${key}-${type}-${i}`,
          title: String(text).slice(0, 300),
          detail: text,
          nodeIds: [nid],
          entityIds: [],
          status: "open",
          resolution: "",
          sourceModule: key,
          sourceType: type,
          sourceIndex: i,
        });
  }
  const entities = (p.characterNames ?? []).map((n: Doc, i: number) => ({
    id: "legacy-person-" + i,
    kind: "person",
    name: n.name,
    role: n.role,
    aliases: [],
    description: n.background,
    nodeIds: ["characters"],
  }));
  return {
    schemaVersion: 1,
    foundationReady: false,
    nodes,
    entities,
    issues,
    decisions: [],
  };
}
export function mergeTree(
  tree: Doc,
  patch: Doc,
  requirements: Doc[],
  selected: string,
  foundation = false,
): Doc {
  validate("TreePatch", patch);
  check(
    new Set(patch.entities.map((e: Doc) => e.id)).size ===
      patch.entities.length &&
      new Set(patch.issues.map((i: Doc) => i.id)).size === patch.issues.length,
    "중복된 공통 대상 또는 문제 ID가 있습니다.",
    422,
  );
  const changed = patch.nodes.map((n: Doc) => n.id);
  check(
    new Set(changed).size === changed.length && changed.includes(selected),
    "선택한 가지와 수정 노드의 ID를 확인하세요.",
    422,
  );
  if (foundation)
    check(
      Object.keys(branchLabels).every((k) => changed.includes(k)),
      "작품·세계관·인물·스토리·문체의 큰 틀을 함께 작성해야 합니다.",
      422,
    );
  const next = structuredClone(tree),
    nodeMap = new Map<string, Doc>(next.nodes.map((n: Doc) => [n.id, n])),
    entityMap = new Map<string, Doc>(next.entities.map((e: Doc) => [e.id, e])),
    issueMap = new Map<string, Doc>(next.issues.map((i: Doc) => [i.id, i]));
  for (const n of patch.nodes) {
    const old = nodeMap.get(n.id);
    if (old)
      check(
        old.parentId === n.parentId && old.kind === n.kind,
        "기존 가지의 정체성과 상위 연결은 유지해주세요.",
        422,
      );
    nodeMap.set(n.id, { ...n, status: "draft", updatedAt: now() });
  }
  for (const e of patch.entities) {
    const old = entityMap.get(e.id);
    if (old)
      check(old.kind === e.kind, "기존 대상의 종류를 바꿀 수 없습니다.", 422);
    entityMap.set(e.id, { ...e, version: (old?.version ?? 0) + 1 });
  }
  check(
    nodeMap.size <= 160 && entityMap.size <= 100,
    "기획 트리가 너무 큽니다. 현재 범위는 노드 160개·공통 대상 100개입니다.",
    413,
  );
  const known = new Set(requirements.map((r) => r.id));
  for (const n of nodeMap.values()) {
    check(
      n.id === "root"
        ? n.parentId === null && n.kind === "root"
        : n.kind !== "root" && n.parentId && nodeMap.has(n.parentId),
      "기획 가지의 상위 연결이 없습니다.",
      422,
    );
    check(
      n.dependsOn.every((k: string) => nodeMap.has(k) && k !== n.id),
      "다른 가지와의 연결 ID를 확인하세요.",
      422,
    );
    check(
      n.requirementIds.every((k: string) => known.has(k)),
      "원문 근거 ID를 확인하세요.",
      422,
    );
    check(
      [...n.entityIds, ...entityReferences(n.content)].every((k: string) =>
        entityMap.has(k),
      ),
      "이름·대상의 공통 등록 ID를 확인하세요.",
      422,
    );
    const visited = new Set<string>([n.id]);
    let parent = n.parentId;
    while (parent) {
      check(!visited.has(parent), "기획 트리의 상위 연결이 순환합니다.", 422);
      visited.add(parent);
      parent = nodeMap.get(parent)!.parentId;
    }
  }
  for (const e of entityMap.values())
    check(
      e.nodeIds.every((n: string) => nodeMap.has(n)),
      "공통 대상의 연결 가지를 확인하세요.",
      422,
    );
  for (const issue of patch.issues) {
    check(
      issue.nodeIds.every((n: string) => nodeMap.has(n)) &&
        issue.entityIds.every((e: string) => entityMap.has(e)),
      "문제의 연결 대상을 확인하세요.",
      422,
    );
    if (issue.status === "resolved")
      check(
        issue.resolution.trim().length >= 10 &&
          issue.nodeIds.some((n: string) => changed.includes(n)),
        "해결 근거와 실제 관련 가지 수정을 함께 남겨주세요.",
        422,
      );
    issueMap.set(issue.id, {
      ...issueMap.get(issue.id),
      ...issue,
      updatedAt: now(),
    });
  }
  // Omitted issues and nodes persist by ID, so wording changes never erase history.
  const priorCoverage = new Set<string>(
    tree.nodes.flatMap((n: Doc) => n.requirementIds),
  );
  const coverage = new Set<string>(
    [...nodeMap.values()].flatMap((n) => n.requirementIds),
  );
  check(
    [...priorCoverage].every((r) => coverage.has(r)),
    "기존 원문 근거를 보존해주세요.",
    422,
  );
  const impacted = new Set<string>(changed);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodeMap.values())
      if (
        !impacted.has(n.id) &&
        (impacted.has(n.parentId) ||
          n.dependsOn.some((d: string) => impacted.has(d)))
      ) {
        impacted.add(n.id);
        grew = true;
      }
  }
  for (const nid of impacted)
    if (!changed.includes(nid)) nodeMap.get(nid)!.status = "needsReview";
  next.nodes = [...nodeMap.values()];
  next.entities = [...entityMap.values()];
  next.issues = [...issueMap.values()];
  next.foundationReady = foundation || tree.foundationReady;
  return next;
}
export async function proposeTree(
  s: Store,
  p: Doc,
  nodeId: string,
  body: Doc,
  foundation = false,
) {
  validate("TreeRequest", body);
  revision(p, body.revision);
  const tree = seedTree(p);
  check(
    foundation || tree.foundationReady,
    "먼저 공통 기획의 큰 틀을 만들어주세요.",
  );
  const node = tree.nodes.find((n: Doc) => n.id === nodeId);
  check(node, "구체화할 가지가 없습니다.", 404);
  const focus = body.issueId
    ? tree.issues.find((i: Doc) => i.id === body.issueId)
    : null;
  check(!body.issueId || focus, "문제 ID를 확인하세요.", 404);
  const { result, run } = await generate(
    s,
    foundation ? "tree_foundation" : "tree_expand",
    {
      title: p.title,
      genre: p.genre,
      requirements: p.requirements,
      answers: p.answers,
      analysis: p.analysis,
      tree,
      selected_node: node,
      focus_issue: focus,
      previous_decisions: p.planningDecisions ?? [],
    },
    body,
    { projectId: p.id, nodeId },
  );
  const preview = mergeTree(tree, result, p.requirements, nodeId, foundation);
  const op = s.prepare(`projects/${p.id}/tree_proposals/${run.requestId}`, {
    id: run.requestId,
    inputRevision: p.revision,
    nodeId,
    foundation,
    patch: result,
    preview,
    status: "PROPOSED",
    run,
    createdAt: now(),
  });
  await s.commit([
    { path: "projects/" + p.id, expected: p.revision, guard: true },
    op,
  ]);
  return op.data;
}
export async function applyTree(s: Store, p: Doc, body: Doc) {
  validate("ApplyPlanning", body);
  revision(p, body.revision);
  check(body.confirmed, "기획안을 확인하고 적용해주세요.");
  const path = `projects/${p.id}/tree_proposals/${body.proposalId}`,
    proposal = await s.get(path);
  check(
    proposal.status === "PROPOSED" && proposal.inputRevision === p.revision,
    "기획이 변경되었습니다. 최신 내용으로 다시 제안받으세요.",
  );
  const tree = mergeTree(
    seedTree(p),
    proposal.patch,
    p.requirements,
    proposal.nodeId,
    proposal.foundation,
  );
  tree.decisions = [
    ...(tree.decisions ?? []),
    {
      id: id(),
      summary: proposal.patch.summary,
      nodeIds: proposal.patch.nodes.map((n: Doc) => n.id),
      issueIds: proposal.patch.issues.map((i: Doc) => i.id),
      createdAt: now(),
    },
  ];
  const next = structuredClone(p);
  invalidate(next);
  next.status = "BIBLE_REVIEW";
  next.bibleAudit = null;
  next.planningTree = tree;
  next.characterNames = tree.entities
    .filter((e: Doc) => e.kind === "person")
    .map((e: Doc) => ({
      entityId: e.id,
      role: e.role || e.name,
      name: e.name,
      background: e.description,
    }));
  for (const section of Object.values(next.bible) as Doc[])
    section.needsReview = true;
  for (const patch of proposal.patch.nodes) {
    if (!patch.id.startsWith("module-")) continue;
    const key = patch.id.slice(7);
    if (next.bible[key])
      next.bible[key].content = renderReferences(patch.content, tree.entities);
  }
  for (const [key, section] of Object.entries(next.bible) as [string, Doc][]) {
    for (const type of ["openQuestions", "conflicts"]) {
      const source = tree.issues.filter(
        (i: Doc) =>
          i.sourceModule === key &&
          i.sourceType === type &&
          Number.isInteger(i.sourceIndex),
      );
      const removed = new Set<number>(
        source
          .filter((i: Doc) => i.status === "resolved")
          .map((i: Doc) => i.sourceIndex),
      );
      section[type] = section[type].filter(
        (_v: string, i: number) => !removed.has(i),
      );
      for (const issue of source) {
        if (removed.has(issue.sourceIndex)) {
          issue.sourceLegacyIndex = issue.sourceIndex;
          issue.sourceIndex = null;
        } else
          issue.sourceIndex -= [...removed].filter(
            (i) => i < issue.sourceIndex,
          ).length;
      }
    }
  }
  const op = s.prepare("projects/" + p.id, next, p.revision);
  await s.commit([
    op,
    s.prepare(
      path,
      { ...proposal, status: "APPLIED", appliedAt: now() },
      proposal.revision,
    ),
    s.prepare(`projects/${p.id}/tree_history/${id()}`, {
      beforeTree: p.planningTree ?? null,
      beforeCharacterNames: p.characterNames ?? [],
      proposalId: proposal.id,
      createdAt: now(),
    }),
  ]);
  return op.data;
}
export async function renameEntity(
  s: Store,
  p: Doc,
  entityId: string,
  body: Doc,
) {
  validate("RenameEntity", body);
  revision(p, body.revision);
  const tree = seedTree(p),
    entity = tree.entities.find((e: Doc) => e.id === entityId);
  check(entity, "공통 대상이 없습니다.", 404);
  const oldName = entity.name;
  entity.name = body.name.trim();
  check(entity.name, "이름을 입력하세요.", 422);
  entity.version = (entity.version ?? 0) + 1;
  entity.aliases = [...new Set([...entity.aliases, oldName])];
  const touched = tree.nodes.filter(
    (n: Doc) =>
      n.entityIds.includes(entityId) ||
      entityReferences(n.content).includes(entityId) ||
      entity.nodeIds.includes(n.id),
  );
  const affected = new Set<string>();
  for (const n of touched) {
    affected.add(n.id);
    for (const child of descendants(tree.nodes, n.id)) affected.add(child);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of tree.nodes)
      if (
        !affected.has(n.id) &&
        (affected.has(n.parentId) ||
          n.dependsOn.some((k: string) => affected.has(k)))
      ) {
        affected.add(n.id);
        grew = true;
      }
  }
  for (const n of tree.nodes) if (affected.has(n.id)) n.status = "needsReview";
  const next = structuredClone(p);
  invalidate(next);
  next.status = "BIBLE_REVIEW";
  next.bibleAudit = null;
  next.planningTree = tree;
  next.characterNames = tree.entities
    .filter((e: Doc) => e.kind === "person")
    .map((e: Doc) => ({
      entityId: e.id,
      role: e.role || e.name,
      name: e.name,
      background: e.description,
    }));
  for (const sec of Object.values(next.bible) as Doc[]) sec.needsReview = true;
  const op = s.prepare("projects/" + p.id, next, p.revision);
  await s.commit([
    op,
    s.prepare(`projects/${p.id}/tree_history/${id()}`, {
      entityId,
      oldName,
      newName: entity.name,
      beforeTree: p.planningTree ?? null,
      createdAt: now(),
    }),
  ]);
  return op.data;
}

export function syncModuleTree(
  p: Doc,
  key: string,
  section: Doc,
  derived = false,
) {
  if (!p.planningTree) return;
  const tree = structuredClone(p.planningTree),
    nid = "module-" + key;
  const current = tree.nodes.find((n: Doc) => n.id === nid);
  const fields = {
    id: nid,
    parentId: moduleBranches[key] ?? "root",
    kind: "detail",
    title: "상세 문서 · " + (moduleLabels[key] ?? key),
    content: section.content,
    entityIds: current?.entityIds ?? [],
    requirementIds: section.requirementIds,
    dependsOn: current?.dependsOn ?? [],
    status: derived ? "draft" : "needsReview",
  };
  if (current) Object.assign(current, fields);
  else tree.nodes.push(fields);
  for (const node of tree.nodes)
    if (
      !derived &&
      (node.id === fields.parentId || node.dependsOn.includes(nid))
    )
      node.status = "needsReview";
  for (const type of ["openQuestions", "conflicts"])
    for (const [index, text] of section[type].entries()) {
      const old = tree.issues.find(
        (i: Doc) =>
          i.sourceModule === key &&
          i.sourceType === type &&
          i.sourceIndex === index,
      );
      if (old && p.bible[key]?.[type]?.[index] === text) continue;
      const issue = {
        id: old?.id ?? "issue-" + id(),
        title: text.slice(0, 300),
        detail: text,
        nodeIds: [nid],
        entityIds: [],
        status: "open",
        resolution: "",
        sourceModule: key,
        sourceType: type,
        sourceIndex: index,
      };
      if (old) Object.assign(old, issue);
      else tree.issues.push(issue);
    }
  p.planningTree = tree;
}
