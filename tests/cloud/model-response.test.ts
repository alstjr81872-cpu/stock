import { test } from "node:test";
import assert from "node:assert/strict";
import { modelResult, upstreamError } from "../../worker/model-response";
const response = (content: any, finish_reason = "stop") => ({
  choices: [{ finish_reason, message: { content } }],
});
test("OpenRouter payment, key, route and rate errors retain actionable classifications", () => {
  for (const [upstream, local, fragment] of [
    [402, 402, "잔액"],
    [401, 503, "API 키"],
    [404, 422, "제공 경로"],
    [429, 429, "요청 한도"],
    [503, 503, "제공자"],
  ] as const) {
    const e = upstreamError(upstream, "section", "job-fixture");
    assert.equal(e.status, local);
    assert(e.message.includes(fragment));
    assert(e.message.includes("모듈 생성"));
    assert(e.message.includes("job-fixture"));
  }
});
test("model truncation, malformed JSON and schema failures identify different causes", () => {
  assert.throws(
    () => modelResult(response("{", "length"), "Analysis"),
    (e: any) => e.status === 422 && e.message.includes("출력이 잘렸"),
  );
  assert.throws(
    () => modelResult(response("not JSON"), "Analysis"),
    (e: any) => e.status === 422 && e.message.includes("JSON 형식"),
  );
  assert.throws(
    () => modelResult(response("{}"), "Analysis"),
    (e: any) => e.status === 422 && e.message.includes("Analysis 구조"),
  );
  assert.throws(
    () => modelResult(response(null), "Analysis"),
    (e: any) => e.status === 422 && e.message.includes("비어"),
  );
  assert.throws(
    () => modelResult(response("blocked", "content_filter"), "Analysis"),
    (e: any) => e.status === 422 && e.message.includes("응답을 제한"),
  );
  assert.equal(
    modelResult(
      response("정상적인 원고입니다. 이 문장은 충분히 긴 원고 응답입니다."),
      undefined,
    ),
    "정상적인 원고입니다. 이 문장은 충분히 긴 원고 응답입니다.",
  );
});
