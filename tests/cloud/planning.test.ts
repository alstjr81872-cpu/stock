import { test } from "node:test";
import assert from "node:assert/strict";
import { validateProposal } from "../../worker/planning";
import fixtures from "./fixtures.json";
const section = () => ({
  ...structuredClone(fixtures.section),
  requirementIds: ["R001"],
  openQuestions: ["주인공의 본명은?"],
  conflicts: [],
});
function sample() {
  const draft = section(),
    p = {
      requirements: [{ id: "R001", text: "원문 보존" }],
      bible: { concept: draft },
    };
  const changed = {
    ...section(),
    content:
      section().content +
      " 주인공 이름은 서도윤이며 빙의 전에는 기록관으로 일했다.",
    openQuestions: [],
  };
  const proposal = {
    summary: "이름과 배경을 구체화하는 자동 기획입니다.",
    decisions: [
      {
        issue: "주인공의 본명은?",
        resolution: "서도윤으로 정하고 기록관 출신이라는 배경을 연결합니다.",
        affectedSections: ["concept", "characters"],
      },
    ],
    characterNames: [
      {
        role: "주인공",
        name: "서도윤",
        background: "빙의 이전에는 도시의 기록을 정리하던 기록관이었다.",
      },
    ],
    sections: [
      { key: "concept", section: changed },
      { key: "characters", section: changed },
    ],
    unresolved: [] as string[],
  };
  return { p, draft, proposal };
}
test("automatic planning covers each issue and puts names in actual bible content", () => {
  const { p, draft, proposal } = sample();
  assert.doesNotThrow(() =>
    validateProposal(p, "concept", draft, "openQuestions", proposal),
  );
  const invalid = structuredClone(proposal);
  invalid.sections = invalid.sections.filter((s) => s.key !== "characters");
  assert.throws(() => validateProposal(p, "concept", draft, "all", invalid));
});
test("automatic planning cannot silently erase original requirements or undecided issues", () => {
  const { p, draft, proposal } = sample();
  const lost = structuredClone(proposal);
  for (const patch of lost.sections) patch.section.requirementIds = [];
  assert.throws(() => validateProposal(p, "concept", draft, "all", lost));
  const dropped = structuredClone(proposal);
  dropped.decisions[0].issue = "다른 질문";
  assert.throws(() => validateProposal(p, "concept", draft, "all", dropped));
  const untracked = structuredClone(proposal);
  untracked.unresolved = ["해결하지 못한 원문 충돌"];
  assert.throws(() => validateProposal(p, "concept", draft, "all", untracked));
});
