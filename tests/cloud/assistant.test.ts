import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeCanon,
  applyChatEdits,
  canonContext,
  turnId,
} from "../../worker/assistant";
import { validate } from "../../worker/validation";

test("canon revisions keep stable IDs, exact user evidence and archived facts outside generation", () => {
  const old = {
    conversationCanon: [
      {
        id: "hero",
        kind: "character",
        title: "주인공",
        content: "옛 이름",
        archived: false,
      },
    ],
  };
  const change = {
    id: "hero",
    kind: "character",
    title: "주인공",
    content: "서진으로 정한다",
    evidence: "서진으로 가자",
  };
  const result = mergeCanon(
    old,
    [change],
    "좋아, 서진으로 가자",
    "turn-00000002",
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].content, change.content);
  assert.equal(result[0].sourceTurn, "turn-00000002");
  assert.equal(old.conversationCanon[0].content, "옛 이름");
  assert.throws(
    () => mergeCanon(old, [change], "그 이름은 싫어", "turn-00000002"),
    (e: any) => e.status === 422,
  );
  assert.throws(
    () => mergeCanon(old, [change, change], "서진으로 가자", "turn-00000002"),
    (e: any) => e.status === 422,
  );
  assert.deepEqual(
    canonContext({ conversationCanon: [{ ...change, archived: true }] }),
    [],
  );
});
test("chat edits use exact unique non-overlapping anchors, including Korean and astral characters", () => {
  const content = "🌙 오래된 문장이다.\n대사가 너무 길다.\n끝은 그대로다.";
  assert.equal(
    applyChatEdits(content, [
      { original: "오래된 문장이다.", replacement: "시작부터 들켰다." },
      { original: "대사가 너무 길다.", replacement: '"변명 값은 선불인데."' },
    ]),
    '🌙 시작부터 들켰다.\n"변명 값은 선불인데."\n끝은 그대로다.',
  );
  for (const edits of [
    [{ original: "없는 문장", replacement: "새 글" }],
    [
      { original: "문장", replacement: "글" },
      { original: "오래된 문장", replacement: "새 글" },
    ],
  ])
    assert.throws(
      () => applyChatEdits(content, edits),
      (e: any) => e.status === 422,
    );
  assert.throws(
    () =>
      applyChatEdits("같다. 같다.", [
        { original: "같다.", replacement: "다르다." },
      ]),
    (e: any) => e.status === 422,
  );
});
test("chat response defaults support questions without forced planning, edits or canon saves", () => {
  const data: any = {
    reply: "주인공은 어떤 매력이 있으면 좋을까요?",
    summary: "아카데미물 탐색 중. 아직 확정한 설정 없음.",
  };
  validate("ChatResponse", data);
  assert.deepEqual(data.canonChanges, []);
  assert.deepEqual(data.edits, []);
  assert.equal(data.plan, null);
  assert.equal(turnId(201), "turn-00000201");
});
