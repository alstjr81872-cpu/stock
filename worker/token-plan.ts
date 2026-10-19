import { type Doc, bytes, requireThat } from "./shared";
// Internal bounds are chosen per request. The user's old maxOutputTokens is ignored.
export function tokenPlan(
  task: string,
  input: Doc,
  model: Doc,
  inputBound: number,
  budgetUsd: number,
) {
  const promptPrice = Number(model.pricing?.prompt),
    completionPrice = Number(model.pricing?.completion),
    requestPrice = Number(model.pricing?.request ?? 0);
  requireThat(
    [promptPrice, completionPrice, requestPrice].every(
      (p) => Number.isFinite(p) && p >= 0,
    ),
    "모델의 현재 가격을 확인할 수 없습니다.",
    422,
  );
  const context = Number(model.context_length);
  requireThat(
    Number.isFinite(context) && context > 0,
    "모델의 문맥 한도를 확인할 수 없습니다.",
    422,
  );
  const limits = [
    model.top_provider?.max_completion_tokens,
    model.per_request_limits?.completion_tokens,
  ]
    .map(Number)
    .filter((v) => Number.isFinite(v) && v > 0);
  const contextAvailable = Math.floor(context * 0.78) - inputBound;
  const hardLimit = Math.floor(Math.min(contextAvailable, ...limits));
  const chars =
    task === "write"
      ? Number(input.layers?.L4?.targetChars ?? 1500)
      : task === "rewrite"
        ? Array.from(input.passage ?? "").length
        : 0;
  const complexity = Math.min(
    8192,
    Math.ceil(bytes(JSON.stringify(input)).length / 16),
  );
  const base: Record<string, [number, number]> = {
    analysis: [4096, 8192],
    style_interview: [4096, 8192],
    section: [6144, 12288],
    style: [8192, 16384],
    plot: [6144, 12288],
    bible_audit: [4096, 8192],
    review: [4096, 8192],
    write: [2048, Math.max(8192, chars * 3)],
    rewrite: [1024, Math.max(4096, chars * 3)],
  };
  const [minimum, preferred] = base[task] ?? [4096, 8192];
  const supportsReasoning = (model.supported_parameters ?? []).includes(
    "reasoning",
  );
  const reasoningReserve = supportsReasoning ? 4096 : 0;
  const target = Math.ceil(
    Math.min(preferred + complexity + reasoningReserve, 65536),
  );
  const inputCost = inputBound * promptPrice + requestPrice;
  const affordable =
    completionPrice > 0
      ? Math.floor((budgetUsd - inputCost) / completionPrice)
      : Infinity;
  requireThat(
    hardLimit >= minimum,
    "이 작업을 완성할 모델 문맥·출력 공간이 부족합니다. 입력 범위를 줄이거나 더 긴 출력을 지원하는 모델을 선택하세요.",
    413,
  );
  requireThat(
    budgetUsd >= inputCost && affordable >= minimum,
    "현재 요청 또는 남은 월 예산으로는 이 작업의 응답 공간을 확보할 수 없습니다. 더 저렴한 모델이나 더 높은 비용 한도를 선택하세요.",
    402,
  );
  const maxOutputTokens = Math.floor(Math.min(target, hardLimit, affordable));
  return {
    mode: "auto",
    maxOutputTokens,
    inputBound,
    estimatedMaxUsd: inputCost + maxOutputTokens * completionPrice,
    reasoning: supportsReasoning ? { effort: "low", exclude: true } : undefined,
  };
}
export function compactSchema(schema: Doc): Doc {
  const result: Doc = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "title" || key === "default") continue;
    if (key === "properties" || key === "$defs")
      result[key] = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, compactSchema(v as Doc)]),
      );
    else if (Array.isArray(value))
      result[key] = value.map((v) =>
        v && typeof v === "object" ? compactSchema(v) : v,
      );
    else
      result[key] =
        value && typeof value === "object" ? compactSchema(value) : value;
  }
  return result;
}
export function efficientInput(task: string, input: Doc): Doc {
  const data = structuredClone(input);
  if (
    task === "analysis" &&
    typeof data.raw_brief === "string" &&
    Array.isArray(data.known_constraints)
  )
    data.known_constraints = data.known_constraints.map((q: Doc) => {
      if (
        typeof q.text === "string" &&
        Number.isInteger(q.sourceStart) &&
        Number.isInteger(q.sourceEnd) &&
        data.raw_brief.includes(q.text)
      ) {
        const { text, ...pointer } = q;
        return { ...pointer, textInRawBrief: true };
      }
      return q;
    });
  // Keep every canon field; omit request/account bookkeeping from repeated bible context.
  const slim = (bible: Doc) =>
    Object.fromEntries(
      Object.entries(bible).map(([k, v]) => {
        const { run, editedBy, ownerUid, createdAt, updatedAt, ...content } =
          v as Doc;
        return [k, content];
      }),
    );
  for (const key of ["bible", "approved_bible"])
    if (data[key]) data[key] = slim(data[key]);
  if (data.layers?.L3?.bible) data.layers.L3.bible = slim(data.layers.L3.bible);
  return data;
}
