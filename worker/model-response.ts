import { type Doc, HttpError } from "./shared";
import { validate } from "./validation";
const taskNames: Record<string, string> = {
  analysis: "원문 분석",
  section: "모듈 생성",
  style: "문체 분석",
  style_interview: "문체 인터뷰",
  bible_audit: "기획 교차 검토",
  plot: "플롯 생성",
  write: "집필",
  review: "원고 검토",
  rewrite: "부분 수정",
};
export function upstreamError(
  status: number,
  task: string,
  requestId: string,
): HttpError {
  const messages: Record<number, string> = {
    400: "모델이 요청 형식이나 토큰 설정을 지원하지 않습니다. 해당 역할의 모델 지원 범위를 확인하세요.",
    401: "OpenRouter API 키 인증에 실패했습니다. Cloudflare의 OPENROUTER_API_KEY 설정을 확인하세요.",
    402: "OpenRouter 잔액 또는 API 키 사용 한도가 부족합니다. Credits 잔액·키 한도를 확인하고 필요하면 더 저렴한 모델을 선택하세요.",
    403: "선택한 모델 또는 제공자가 이 요청을 허용하지 않았습니다. OpenRouter의 모델 이용 조건과 정책을 확인하세요.",
    404: "선택한 모델의 제공 경로를 찾을 수 없습니다. 해당 역할의 모델을 다시 선택하세요.",
    408: "모델 제공자의 응답 시간이 초과됐습니다. 작업 기록을 확인하세요.",
    422: "선택한 모델이 요청 설정을 처리하지 못했습니다. 해당 역할의 모델 지원 범위를 확인하세요.",
    429: "OpenRouter 또는 모델 제공자의 요청 한도에 도달했습니다. 잠시 후 작업 기록을 확인하세요.",
    502: "OpenRouter 또는 모델 제공자에서 오류가 발생했습니다. 작업 기록과 제공자 상태를 확인하세요.",
    503: "선택한 모델의 제공자가 현재 응답할 수 없습니다. 모델 가용성을 확인하세요.",
  };
  const code =
    status === 402
      ? 402
      : status === 429
        ? 429
        : [400, 403, 404, 422].includes(status)
          ? 422
          : [401, 503].includes(status)
            ? 503
            : 502;
  return new HttpError(
    code,
    `${taskNames[task] ?? "AI 작업"} 실패: ${messages[status] ?? messages[502]} (OpenRouter ${status}) 자동 재요청하지 않았습니다. 작업: ${requestId}`,
  );
}
export function modelResult(data: Doc, schema: string | undefined): any {
  if (!data || typeof data !== "object")
    throw new HttpError(502, "모델 제공자의 응답 형식을 읽을 수 없습니다.");
  const choice = data.choices?.[0],
    reason = choice?.finish_reason;
  if (reason === "length")
    throw new HttpError(
      422,
      "자동으로 확보한 응답 공간에서도 모델 출력이 잘렸습니다. 모델의 출력 한도 또는 추론 소모량 때문일 수 있습니다. 더 긴 출력을 지원하는 모델이나 더 작은 입력 범위를 선택하세요.",
    );
  if (reason === "content_filter" || choice?.message?.refusal)
    throw new HttpError(
      422,
      "선택한 모델 또는 제공자가 응답을 제한했습니다. 모델의 이용 조건과 정책을 확인하세요.",
    );
  if (reason !== "stop")
    throw new HttpError(
      502,
      "모델 응답이 정상적으로 끝나지 않았습니다. 작업 기록을 확인하세요.",
    );
  const raw = choice?.message?.content;
  if (typeof raw !== "string" || !raw.trim())
    throw new HttpError(
      422,
      "모델의 텍스트 응답이 비어 있습니다. 해당 역할에 텍스트 출력을 지원하는 모델을 선택하세요.",
    );
  if (!schema) {
    if (raw.trim().length < 20)
      throw new HttpError(422, "원고 응답이 너무 짧습니다.");
    return raw.trim();
  }
  let value: unknown;
  try {
    value = JSON.parse(
      raw
        .trim()
        .replace(/^```(?:json)?\s*/, "")
        .replace(/```\s*$/, ""),
    );
  } catch {
    throw new HttpError(
      422,
      "모델이 필요한 JSON 형식으로 응답하지 않았습니다. 이 역할에는 JSON 출력을 지원하는 모델을 선택하세요.",
    );
  }
  try {
    return validate(schema, value);
  } catch (e) {
    if (e instanceof HttpError)
      throw new HttpError(
        422,
        `모델 응답이 필요한 ${schema} 구조를 충족하지 않았습니다. 질문·필수 항목·글자 수 형식을 지킬 수 있는 모델로 변경하세요.`,
      );
    throw e;
  }
}
