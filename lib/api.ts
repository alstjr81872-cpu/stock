"use client";
import { currentUser } from "./auth";
export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
  ) {
    super(
      typeof detail === "string"
        ? detail
        : (detail as { message?: string })?.message || JSON.stringify(detail),
    );
  }
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const user = currentUser();
  if (!user) throw new ApiError(401, "로그인해주세요.");
  const token = await user.getIdToken();
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const res = await fetch("/api" + path, {
    ...options,
    headers,
    cache: "no-store",
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ detail: "서버에 연결할 수 없습니다." }));
    throw new ApiError(res.status, data.detail || "요청에 실패했습니다.");
  }
  if (res.headers.get("content-type")?.includes("application/zip"))
    return (await res.blob()) as T;
  return await res.json();
}
export const send = (path: string, data: unknown, method = "POST") =>
  api(path, { method, body: JSON.stringify(data) });
export const modules: Record<string, string> = {
  concept: "콘셉트",
  protagonist: "주인공",
  characters: "주요 인물",
  relationships: "관계망",
  world: "세계관",
  narrative: "장기 서사",
  fun: "재미 설계",
  density: "밀도 설계",
  style: "스타일 바이블",
  special: "장면별 연출",
  serial: "연재 운영",
};
export const statuses: Record<string, string> = {
  IDEA: "아이디어",
  DRAFT_BIBLE: "인터뷰 진행",
  BIBLE_REVIEW: "기획서 검수",
  ACTIVE: "집필 준비",
  ARCHIVED: "휴지통",
  REVIEW: "검수 대기",
  APPROVED: "승인 완료",
  INVALIDATED: "재승인 필요",
  REQUIRES_HUMAN: "직접 검수 필요",
  draft: "초안",
  review: "검수 대기",
  approved: "승인 완료",
};
export const roles: Record<string, string> = {
  questions: "질문 · 인터뷰",
  planning: "기획",
  world: "세계관",
  style: "문체 분석",
  story: "스토리 설계",
  writing: "집필",
  review: "독립 검토",
  editing: "부분 수정",
};
export function date(s: string) {
  return s
    ? new Date(s).toLocaleString("ko-KR", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Seoul",
      })
    : "—";
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
