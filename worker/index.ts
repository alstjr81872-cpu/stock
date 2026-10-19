import { type Env, HttpError, requireThat, QuoteReady, id } from "./shared";
import { Store } from "./store";
import { handleApi } from "./api";
const privacy = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};
export async function authenticate(
  request: Request,
  env: Env,
  transport: typeof fetch = fetch,
) {
  const token = request.headers.get("Authorization");
  requireThat(
    token && token.startsWith("Bearer "),
    "Google 로그인이 필요합니다.",
    401,
  );
  requireThat(
    env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.ALLOWED_EMAILS,
    "서버 로그인 설정이 필요합니다.",
    503,
  );
  // Remote validation checks the real Supabase session. Never trust decoded JWT claims alone.
  const res = await transport(env.SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: token },
    signal: AbortSignal.timeout(15000),
  });
  requireThat(
    res.ok,
    "인증이 만료되었거나 올바르지 않습니다. 다시 로그인해주세요.",
    401,
  );
  const user = (await res.json()) as {
    id: string;
    email?: string;
    email_confirmed_at?: string;
    app_metadata?: { provider?: string; providers?: string[] };
  };
  const allowed = env.ALLOWED_EMAILS.split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  requireThat(
    user.id &&
      user.email &&
      user.email_confirmed_at &&
      allowed.includes(user.email.toLowerCase()),
    "등록된 작가 계정으로 로그인해주세요.",
    403,
  );
  requireThat(
    user.app_metadata?.providers?.includes("google") ||
      user.app_metadata?.provider === "google",
    "Google 계정으로 로그인해주세요.",
    403,
  );
  return user.id;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!new URL(request.url).pathname.startsWith("/api/")) {
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(privacy))
        if (k !== "Cache-Control") headers.set(k, v);
      return new Response(response.body, { status: response.status, headers });
    }
    try {
      if (new URL(request.url).pathname === "/api/health")
        return Response.json(
          {
            ok: true,
            name: "NovelForge AI",
            mode: "supabase",
            aiMode: "live",
            configured: !!(
              env.SUPABASE_URL &&
              env.SUPABASE_SERVICE_ROLE_KEY &&
              env.ALLOWED_EMAILS &&
              env.OPENROUTER_API_KEY
            ),
            ready: null,
          },
          { headers: privacy },
        );
      const uid = await authenticate(request, env);
      const advertised = Number(request.headers.get("content-length") ?? 0);
      requireThat(
        advertised <= 9 * 1024 * 1024,
        "요청은 9MB 이하여야 합니다.",
        413,
      );
      // Enforce the limit even when content-length is missing or misleading.
      if (request.body) {
        const reader = request.body.getReader();
        let size = 0;
        const chunks: Uint8Array[] = [];
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 9 * 1024 * 1024) {
            await reader.cancel();
            throw new HttpError(413, "요청은 9MB 이하여야 합니다.");
          }
          chunks.push(value);
        }
        const raw = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          raw.set(chunk, offset);
          offset += chunk.length;
        }
        request = new Request(request, { body: raw });
      }
      const result = await handleApi(
        request,
        new Store(
          env,
          uid,
          undefined,
          request.headers.get("X-NF-Preflight") === "1",
        ),
      );
      if (result instanceof Response) {
        const h = new Headers(result.headers);
        for (const [k, v] of Object.entries(privacy)) h.set(k, v);
        return new Response(result.body, { status: result.status, headers: h });
      }
      return Response.json(result, { headers: privacy });
    } catch (e) {
      if (e instanceof QuoteReady)
        return Response.json(
          { estimateOnly: true, ...e.quote },
          { headers: privacy },
        );
      const reference = id();
      if (!(e instanceof HttpError))
        console.error(
          JSON.stringify({
            event: "api_unhandled",
            reference,
            type: e instanceof Error ? e.name : "UnknownError",
            // Only stack frames: exclude the exception message and request data.
            frames:
              e instanceof Error
                ? e.stack
                    ?.split("\n")
                    .filter((line) => /^\s+at /.test(line))
                    .slice(0, 6)
                : [],
          }),
        );
      return Response.json(
        {
          detail:
            e instanceof HttpError
              ? e.detail
              : "서버 처리 중 오류가 발생했습니다. 저장 여부를 확인한 뒤 다시 불러와주세요. 오류 번호: " +
                reference,
        },
        { status: e instanceof HttpError ? e.status : 500, headers: privacy },
      );
    }
  },
};
