import { test } from "node:test";
import assert from "node:assert/strict";
import {
  developmentPreview,
  developmentIssues,
} from "../../worker/plot-development";
import fixtures from "./fixtures.json";

const before = () => ({
  ...structuredClone(fixtures.plot),
  risks: ["첫 만남의 행동 동기가 약하다."],
  openQuestions: ["후반 결말은 어떻게 정할까?"],
  continuationNotes: ["기존에 남겨 둔 장기 메모"],
});
function result() {
  const plot = structuredClone(fixtures.plot);
  plot.scenes[0].action =
    "동료의 잃어버린 기록을 돌려주기 위해 약속을 선택한다.";
  return {
    summary:
      "첫 장면의 동기를 구체화하고 결말은 이후 전개의 메모로 분리했습니다.",
    decisions: [
      {
        issueId: "risk-0",
        disposition: "resolved",
        resolution:
          "첫 만남에서 기록을 돌려주려는 구체적 목적을 행동에 반영했다.",
      },
      {
        issueId: "question-0",
        disposition: "later",
        resolution:
          "후반 결말은 이번 회차의 기록 반환 장면에 필요하지 않아 이후 아크를 설계할 때 결정한다.",
      },
    ],
    plot,
  };
}
test("auto development preserves long-term notes and prior scene IDs while making concrete decisions", () => {
  const old = before(),
    preview = developmentPreview(old, result());
  assert.equal(developmentIssues(old).length, 2);
  assert.equal(preview.risks.length, 0);
  assert.equal(preview.openQuestions.length, 0);
  assert(preview.continuationNotes.includes(old.continuationNotes[0]));
  assert(
    preview.continuationNotes.some((n: string) => n.includes("후반 결말")),
  );
  assert.equal(old.risks.length, 1);
});
test("auto development rejects silent issue removal, invented decisions and unchanged scenes", () => {
  const missing = result();
  missing.decisions.pop();
  assert.throws(
    () => developmentPreview(before(), missing),
    (e: any) => e.status === 422,
  );
  const invented = result();
  invented.decisions[0].issueId = "unknown";
  assert.throws(
    () => developmentPreview(before(), invented),
    (e: any) => e.status === 422,
  );
  const unchanged = result();
  unchanged.plot.scenes = structuredClone(fixtures.plot.scenes);
  assert.throws(
    () => developmentPreview(before(), unchanged),
    (e: any) => e.status === 422,
  );
  const renamed = result();
  renamed.plot.scenes[0].id = "lost-original";
  assert.throws(
    () => developmentPreview(before(), renamed),
    (e: any) => e.status === 422,
  );
});

test("detected gaps must be handled and immediate missing settings cannot silently become later notes", () => {
  const old = before(),
    gaps = [
      {
        id: "gap-time",
        text: "두 장면 사이의 시간 경과가 빠졌다.",
        scope: "current",
      },
    ];
  const output = result();
  assert.throws(
    () => developmentPreview(old, output, gaps),
    (e: any) => e.status === 422,
  );
  output.decisions.push({
    issueId: "gap-time",
    disposition: "later",
    resolution: "장면 사이의 시간은 이후의 아크에서 결정한다.",
  });
  assert.throws(
    () => developmentPreview(old, output, gaps),
    (e: any) => e.status === 422,
  );
  output.decisions[2].disposition = "unresolved";
  const blocked = developmentPreview(old, output, gaps);
  assert(blocked.openQuestions.some((q: string) => q.includes("시간 경과")));
  output.decisions[2].disposition = "resolved";
  output.decisions[2].resolution =
    "두 장면이 같은 날 오후에 이어지도록 시간을 구체화했다.";
  output.plot.scenes[1].startState = "같은 날 오후, 첫 장면의 약속을 돌아본다.";
  const complete = developmentPreview(old, output, gaps);
  assert.equal(complete.openQuestions.length, 0);
});
