export type Doc = Record<string, any>;
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  OPENROUTER_API_KEY: string;
  ALLOWED_EMAILS: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}
export class HttpError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
  ) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
}
export function requireThat(
  condition: unknown,
  message: string,
  status = 409,
): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID().replaceAll("-", "");
export const bytes = (s: string) => new TextEncoder().encode(s);
export const chars = (s: string) => Array.from(s);
export const cut = (s: string, a: number, b?: number) =>
  chars(s).slice(a, b).join("");
export const length = (s: string) => chars(s).length;
export async function hash(value: string | Uint8Array) {
  const data = typeof value === "string" ? bytes(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(digest), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
}
export function stable(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stable(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function revision(doc: Doc, expected: number) {
  if (doc.revision !== expected)
    throw new HttpError(409, {
      message: "다른 창에서 변경되었습니다. 새 버전을 불러와 비교하세요.",
      currentRevision: doc.revision,
    });
}
export const undecided = (s: string) =>
  !s?.trim() ||
  [
    "미정",
    "보류",
    "아직미정",
    "모르겠음",
    "나중에결정",
    "hold",
    "pending",
  ].includes(s.replaceAll(" ", "").toLowerCase());
export function active(p: Doc) {
  requireThat(
    p.status === "ACTIVE" && !p.deletedAt,
    "먼저 최신 기획서를 승인하세요.",
  );
}
export function invalidate(p: Doc) {
  if (p.plot) p.plot.status = "INVALIDATED";
  if (p.status === "ACTIVE") p.status = "BIBLE_REVIEW";
}
export async function bibleHash(p: Doc) {
  return hash(
    stable({
      bible: p.bible,
      requirements: p.requirements.map(({ approved, ...q }: Doc) => q),
      answers: p.answers,
      style: p.styleBinding,
    }),
  );
}
