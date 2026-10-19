import { test } from "node:test";
import assert from "node:assert/strict";
import { seedTree, mergeTree, syncModuleTree } from "../../worker/tree";
import { renderReferences } from "../../lib/planning-tree";
import fixtures from "./fixtures.json";
const p = () => ({
  title: "기획 트리",
  requirements: [{ id: "R001", text: "원문 조건" }],
  bible: {
    characters: {
      ...structuredClone(fixtures.section),
      requirementIds: ["R001"],
      openQuestions: ["본명이 무엇인가?"],
      conflicts: [],
    },
  },
});
function patch(tree: any) {
  return {
    summary: "작품의 중심과 세계관, 인물, 이야기를 연결한 공통 기획입니다.",
    nodes: tree.nodes
      .filter((n: any) => !n.id.startsWith("module-"))
      .map(({ status, ...n }: any) => ({
        ...n,
        content:
          n.content + " {{entity:person_main}}의 선택이 사건의 원인이 됩니다.",
        entityIds: ["person_main"],
        requirementIds: ["R001"],
      })),
    entities: [
      {
        id: "person_main",
        kind: "person",
        name: "서도윤",
        role: "주인공",
        aliases: [],
        description: "도시의 기록을 관리하던 기록관 출신 주인공이다.",
        nodeIds: ["characters", "story"],
      },
    ],
    issues: [],
  };
}
test("legacy modules and issues are imported without modifying original documents", () => {
  const original = p(),
    before = structuredClone(original),
    tree = seedTree(original);
  assert.equal(tree.foundationReady, false);
  assert(tree.nodes.some((n: any) => n.id === "module-characters"));
  assert.equal(tree.issues[0].sourceIndex, 0);
  assert.deepEqual(original, before);
});
test("foundation connects all branches and registry names render from one entity ID", () => {
  const original = p(),
    tree = seedTree(original),
    next = mergeTree(tree, patch(tree), original.requirements, "root", true);
  assert(next.foundationReady);
  assert.equal(next.issues.length, 1);
  const text = next.nodes.find((n: any) => n.id === "story").content;
  assert(renderReferences(text, next.entities).includes("서도윤"));
  next.entities[0].name = "윤서진";
  assert(renderReferences(text, next.entities).includes("윤서진"));
  assert(!renderReferences(text, next.entities).includes("서도윤"));
});
test("issue wording can change while resolution remains attached to its stable ID", () => {
  const original = p(),
    tree = mergeTree(
      seedTree(original),
      patch(seedTree(original)),
      original.requirements,
      "root",
      true,
    ),
    legacy = tree.nodes.find((n: any) => n.id === "module-characters");
  const { status, updatedAt, ...n } = legacy;
  const issue = tree.issues[0];
  const result = {
    summary: "인물의 본명과 이전 신분을 관련 기획에 구체화합니다.",
    nodes: [
      {
        ...n,
        content: "{{entity:person_main}}는 빙의 이전에 기록관으로 일했다.",
        entityIds: ["person_main"],
      },
    ],
    entities: [],
    issues: [
      {
        id: issue.id,
        title: "문장을 새로 다듬은 이름과 정체 문제",
        detail: "원문과 연결해 이름을 결정합니다.",
        nodeIds: [n.id],
        entityIds: ["person_main"],
        status: "resolved",
        resolution:
          "기록관 출신 서도윤이라는 정체를 인물 기획에 실제 반영했다.",
      },
    ],
  };
  const next = mergeTree(tree, result, original.requirements, n.id);
  assert.equal(next.issues[0].id, issue.id);
  assert.equal(next.issues[0].status, "resolved");
  assert.equal(next.issues[0].sourceIndex, 0);
});
test("graph validation rejects cycles, orphan links, unknown entities and silent evidence loss", () => {
  const original = p(),
    tree = seedTree(original);
  const bad = patch(tree);
  bad.nodes[1].parentId = "unknown";
  assert.throws(() =>
    mergeTree(tree, bad, original.requirements, "root", true),
  );
  const entity = patch(tree);
  entity.nodes[0].entityIds = ["missing"];
  assert.throws(() =>
    mergeTree(tree, entity, original.requirements, "root", true),
  );
  const lost = patch(tree);
  for (const n of lost.nodes) n.requirementIds = [];
  const { status, ...legacy } = tree.nodes.find(
    (n: any) => n.id === "module-characters",
  );
  lost.nodes.push({ ...legacy, requirementIds: [] });
  assert.throws(() =>
    mergeTree(tree, lost, original.requirements, "root", true),
  );
  const cycle = patch(tree);
  cycle.nodes.push(
    {
      id: "new-a",
      parentId: "new-b",
      kind: "detail",
      title: "a",
      content: "충분한 상세 내용의 첫 번째 가지입니다.",
      entityIds: [],
      requirementIds: [],
      dependsOn: [],
    },
    {
      id: "new-b",
      parentId: "new-a",
      kind: "detail",
      title: "b",
      content: "충분한 상세 내용의 두 번째 가지입니다.",
      entityIds: [],
      requirementIds: [],
      dependsOn: [],
    },
  );
  assert.throws(() =>
    mergeTree(tree, cycle, original.requirements, "root", true),
  );
});

test("document projections preserve the core plan while manual edits flag their parent", () => {
  const original: any = p();
  original.planningTree = mergeTree(
    seedTree(original),
    patch(seedTree(original)),
    original.requirements,
    "root",
    true,
  );
  for (const n of original.planningTree.nodes) n.status = "ready";
  const section = {
    ...original.bible.characters,
    content: original.bible.characters.content + "  상세 문서를 정리했다.",
  };
  syncModuleTree(original, "characters", section, true);
  assert.equal(
    original.planningTree.nodes.find((n: any) => n.id === "characters").status,
    "ready",
  );
  syncModuleTree(original, "characters", section, false);
  assert.equal(
    original.planningTree.nodes.find((n: any) => n.id === "characters").status,
    "needsReview",
  );
  assert.equal(original.planningTree.issues[0].status, "open");
});
