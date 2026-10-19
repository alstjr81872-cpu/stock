import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("authenticated dashboard reads Supabase through the real Workers fetch runtime", async () => {
  const bundle = await build({
    entryPoints: ["worker/index.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
  });
  const requests: string[] = [];
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: "2026-10-01",
      compatibilityFlags: ["nodejs_compat"],
      bindings: {
        SUPABASE_URL: "https://runtime.supabase.test",
        SUPABASE_SERVICE_ROLE_KEY: "fixture-server-key",
        ALLOWED_EMAILS: "writer@example.com",
        OPENROUTER_API_KEY: "fixture-router-key",
      },
      outboundService: async (request) => {
        const url = new URL(request.url);
        requests.push(url.pathname);
        if (url.hostname === "openrouter.ai") {
          assert.equal(url.pathname, "/api/v1/models");
          return Response.json({
            data: [
              {
                id: "test/model",
                context_length: 200000,
                pricing: { prompt: "0.000001", completion: "0.000002" },
                supported_parameters: [],
              },
            ],
          });
        }
        assert.equal(url.hostname, "runtime.supabase.test");
        assert.equal(request.headers.get("apikey"), "fixture-server-key");
        if (url.pathname === "/auth/v1/user") {
          assert.equal(
            request.headers.get("authorization"),
            "Bearer fixture-session",
          );
          return Response.json({
            id: "11111111-1111-4111-8111-111111111111",
            email: "writer@example.com",
            email_confirmed_at: "2026-10-19T00:00:00Z",
            app_metadata: { provider: "google", providers: ["google"] },
          });
        }
        assert.equal(
          request.headers.get("authorization"),
          "Bearer fixture-server-key",
        );
        assert.equal(url.pathname, "/rest/v1/nf_documents");
        if (url.searchParams.get("path") === "eq.account")
          return Response.json([
            {
              data: {
                ownerUid: "11111111-1111-4111-8111-111111111111",
                revision: 1,
                settings: {
                  models: { questions: "test/model" },
                  monthlyBudgetUsd: 5,
                },
              },
            },
          ]);
        if (url.searchParams.get("path") === "eq.projects/preflight")
          return Response.json([
            {
              data: {
                id: "preflight",
                ownerUid: "11111111-1111-4111-8111-111111111111",
                revision: 1,
                status: "IDEA",
                brief: { text: "테스트 기획" },
                requirements: [],
                answers: {},
              },
            },
          ]);
        return Response.json([]);
      },
    }),
  );
  try {
    for (const path of ["/me", "/projects", "/styles"]) {
      const res = await mf.dispatchFetch("https://app.test/api" + path, {
        headers: { Authorization: "Bearer fixture-session" },
      });
      const data = await res.json();
      assert.equal(res.status, 200, JSON.stringify(data));
      if (path === "/me") assert.equal((data as any).mode, "supabase");
      else assert.deepEqual(data, []);
      assert.equal(res.headers.get("cache-control"), "no-store");
    }
    assert.equal(
      requests.filter((p) => p === "/rest/v1/nf_documents").length,
      3,
    );
    const quoted = await mf.dispatchFetch(
      "https://app.test/api/projects/preflight/analyze",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer fixture-session",
          "Content-Type": "application/json",
          "X-NF-Preflight": "1",
        },
        body: JSON.stringify({ revision: 1, consent: false, maxCostUsd: 5 }),
      },
    );
    const quote: any = await quoted.json();
    assert.equal(quoted.status, 200, JSON.stringify(quote));
    assert.equal(quote.estimateOnly, true);
    assert(quote.suggestedMaxCostUsd > 0);
    assert(!requests.includes("/api/v1/chat/completions"));
    assert(!requests.some((p) => p.includes("/rpc/")));
    const unauthenticated = await mf.dispatchFetch("https://app.test/api/me");
    assert.equal(unauthenticated.status, 401);
  } finally {
    await mf.dispose();
  }
});
