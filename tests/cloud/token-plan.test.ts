import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tokenPlan,
  efficientInput,
  compactSchema,
} from "../../worker/token-plan";
const model = (extra: any = {}) => ({
  context_length: 128000,
  pricing: { prompt: "0.000001", completion: "0.000002" },
  supported_parameters: [],
  ...extra,
});
test("automatic output grows with task size and uses reasoning controls only when supported", () => {
  const module = tokenPlan("section", {}, model(), 1000, 0.15);
  assert(module.maxOutputTokens > 3000);
  assert.equal(module.reasoning, undefined);
  const reasoning = tokenPlan(
    "section",
    {},
    model({ supported_parameters: ["reasoning"] }),
    1000,
    0.15,
  );
  assert.deepEqual(reasoning.reasoning, { effort: "low", exclude: true });
  assert(reasoning.maxOutputTokens > module.maxOutputTokens);
  const short = tokenPlan(
    "write",
    { layers: { L4: { targetChars: 1000 } } },
    model(),
    1000,
    1,
  );
  const long = tokenPlan(
    "write",
    { layers: { L4: { targetChars: 5000 } } },
    model(),
    1000,
    1,
  );
  assert(long.maxOutputTokens > short.maxOutputTokens);
});
test("automatic output respects model, request budget and context limits", () => {
  const capped = tokenPlan(
    "section",
    {},
    model({ top_provider: { max_completion_tokens: 7000 } }),
    1000,
    1,
  );
  assert.equal(capped.maxOutputTokens, 7000);
  const budget = tokenPlan("section", {}, model(), 1000, 0.015);
  assert(budget.estimatedMaxUsd <= 0.015);
  assert(budget.maxOutputTokens >= 6144);
  assert(budget.maxOutputTokens < 12288);
  const context = tokenPlan(
    "section",
    {},
    model({ context_length: 12000 }),
    1000,
    1,
  );
  assert(context.inputBound + context.maxOutputTokens <= 12000 * 0.78);
  assert.throws(
    () => tokenPlan("section", {}, model(), 1000, 0.002),
    (e: any) => e.status === 402,
  );
  assert.throws(
    () =>
      tokenPlan(
        "section",
        {},
        model({ top_provider: { max_completion_tokens: 2048 } }),
        1000,
        1,
      ),
    (e: any) => e.status === 413,
  );
});
test("schema compression preserves fields named title and all validation constraints", () => {
  const compact = compactSchema({
    title: "A schema",
    type: "object",
    properties: {
      title: { title: "Title", type: "string", minLength: 5, default: "value" },
    },
    required: ["title"],
  });
  assert.deepEqual(compact, {
    type: "object",
    properties: { title: { type: "string", minLength: 5 } },
    required: ["title"],
  });
});
test("input compression preserves original text, requirement IDs, canon and style rules", () => {
  const original = {
    raw_brief: "첫 요구\n둘째 요구",
    known_constraints: [
      { id: "R001", text: "첫 요구", sourceStart: 0, sourceEnd: 5 },
    ],
    bible: {
      world: {
        content: "세계의 규칙",
        requirementIds: ["R001"],
        run: { requestId: "unused" },
      },
    },
    approved_style: { rules: { perspective: "삼인칭" } },
  };
  const packed = efficientInput("analysis", original);
  assert.equal(packed.raw_brief, original.raw_brief);
  assert.equal(packed.known_constraints[0].id, "R001");
  assert.equal(packed.known_constraints[0].sourceStart, 0);
  assert.equal(packed.known_constraints[0].text, undefined);
  assert.equal(original.known_constraints[0].text, "첫 요구");
  assert.equal(packed.bible.world.content, "세계의 규칙");
  assert.equal(packed.bible.world.run, undefined);
  assert.deepEqual(packed.approved_style, original.approved_style);
});
