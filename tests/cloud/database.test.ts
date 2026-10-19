import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { Store } from "../../worker/store";
import { HttpError, hash, bytes } from "../../worker/shared";
import { handleApi } from "../../worker/api";
import { authenticate } from "../../worker/index";
import { validate } from "../../worker/validation";
import fixtures from "./fixtures.json";
import { generate } from "../../worker/ai";
const uid = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const env: any = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-server-only",
  ALLOWED_EMAILS: "writer@example.com",
  OPENROUTER_API_KEY: "test-only",
};
let db: PGlite;
const objects = new Map<string, Uint8Array>();
const transport: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  try {
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const body = JSON.parse(init!.body as string);
      if (url.pathname.endsWith("/nf_commit"))
        await db.query("select public.nf_commit($1,$2)", [
          body.p_owner,
          JSON.stringify(body.p_operations),
        ]);
      else
        await db.query("select public.nf_reserve_storage($1,$2,$3)", [
          body.p_owner,
          body.p_path,
          body.p_bytes,
        ]);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/rest/v1/nf_documents") {
      const owner = url.searchParams.get("owner_id")!.slice(3),
        paths = url.searchParams.getAll("path");
      let rows: any[];
      if (paths[0].startsWith("eq."))
        rows = (
          await db.query(
            "select data,path from public.nf_documents where owner_id=$1 and path=$2",
            [owner, paths[0].slice(3)],
          )
        ).rows;
      else {
        const prefix = paths[0].slice(5, -2);
        rows = (
          await db.query(
            "select data,path from public.nf_documents where owner_id=$1 and path like $2 order by updated_at desc",
            [owner, prefix + "/%"],
          )
        ).rows;
        rows = rows.filter(
          (x) => !x.path.slice(prefix.length + 1).includes("/"),
        );
      }
      return Response.json(rows);
    }
    const path = url.pathname.replace("/storage/v1/object/novelforge/", "");
    if (init?.method === "POST") {
      assert(!objects.has(path));
      objects.set(path, new Uint8Array(init.body as Uint8Array));
      return Response.json({ Key: path });
    }
    if (objects.has(path)) return new Response(objects.get(path) as BodyInit);
    return new Response(null, { status: 404 });
  } catch (e: any) {
    return Response.json({ message: e.message }, { status: 400 });
  }
};
const store = () => new Store(env, uid, transport);
const req = (path: string, body?: any, method = body ? "POST" : "GET") =>
  new Request("https://app.example/api" + path, {
    method,
    headers:
      body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
before(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);insert into auth.users values('${uid}'),('${other}');`,
  );
  await db.exec(
    readFileSync("supabase/migrations/202610190001_novelforge.sql", "utf8"),
  );
});
after(async () => {
  await db.close();
});
test("SQL batch CAS rejects stale revision and rolls back its audit", async () => {
  const s = store(),
    d = await s.create("projects/cas", { title: "before" });
  const op = s.prepare("projects/cas", { ...d, title: "winner" }, 1);
  await s.commit([op]);
  await assert.rejects(
    s.commit([
      s.prepare("projects/cas", { ...d, title: "loser" }, 1),
      s.prepare("projects/cas/approval_records/invalid", { kind: "BIBLE" }),
    ]),
    (e: any) => e.status === 409,
  );
  assert.equal((await s.get("projects/cas")).title, "winner");
  assert.equal(await s.find("projects/cas/approval_records/invalid"), null);
});
test("atomic guards prevent partial chapter approval; reads are owner scoped", async () => {
  const s = store();
  await s.create("projects/guard", { status: "ACTIVE" });
  await s.create("projects/guard/chapters/chapter-1", { status: "REVIEW" });
  await assert.rejects(
    s.commit([
      { path: "projects/guard", expected: 99, guard: true },
      s.prepare("projects/guard/chapters/chapter-1", { status: "APPROVED" }, 1),
    ]),
  );
  assert.equal(
    (await s.get("projects/guard/chapters/chapter-1")).status,
    "REVIEW",
  );
  assert.equal(
    await new Store(env, other, transport).find("projects/guard"),
    null,
  );
});
test("browser roles cannot write data or execute privileged functions", async () => {
  await db.exec("set role authenticated");
  try {
    await assert.rejects(
      db.exec(
        `insert into public.nf_documents values('${uid}','projects/attack',1,'{}',now())`,
      ),
    );
    await assert.rejects(db.query("select public.nf_commit($1,$2)", [uid, []]));
  } finally {
    await db.exec("reset role");
  }
});
test("SQL rejects owner forgery and enforces a global storage reservation limit", async () => {
  const s = store();
  await assert.rejects(
    s.commit([
      { path: "projects/forged", expected: 0, data: { ownerUid: other } },
    ]),
  );
  for (let i = 0; i < 71; i++)
    await s.rpc("nf_reserve_storage", {
      p_owner: uid,
      p_path: `users/${uid}/quota/${i}`,
      p_bytes: 8388608,
    });
  await assert.rejects(
    s.rpc("nf_reserve_storage", {
      p_owner: uid,
      p_path: `users/${uid}/quota/overflow`,
      p_bytes: 8388608,
    }),
    (e: any) => e.status === 507,
  );
  await db.exec("delete from public.nf_storage_reservations");
});
test("large Korean manuscript uses private Storage and verifies checksum", async () => {
  const s = store(),
    fields = await s.content("large", "가나다".repeat(80000));
  assert.equal(fields.content, "");
  assert(fields.contentRef);
  assert.equal((await s.hydrate(fields)).content, "가나다".repeat(80000));
  assert.equal(fields.charCountWithSpaces, 240000);
  await assert.rejects(
    s.read({ ...fields.contentRef, path: `users/${other}/wrong` }),
  );
  objects.set(fields.contentRef.path, bytes("tampered"));
  await assert.rejects(s.read(fields.contentRef));
});
test("project upload preserves original bytes and required lines; approval gate holds", async () => {
  const s = store(),
    raw = "성인 주인공\r\n\r\n느린 관계 변화\n",
    form = new FormData();
  form.set("title", "테스트 작품");
  form.set("genre", "판타지");
  form.set("file", new File([raw], "brief.txt"));
  const p: any = await handleApi(req("/projects", form), s);
  assert.equal(p.brief.text, raw);
  assert.equal(p.brief.file.sha256, await hash(raw));
  assert.equal(p.requirements.length, 2);
  assert.equal(p.requirements[1].sourceStart, 10);
  await assert.rejects(
    handleApi(
      req(`/projects/${p.id}/approve`, { revision: 1, confirmed: true }),
      s,
    ),
    (e: any) => e.status === 409,
  );
  const restored: any = await handleApi(
    req(`/projects/${p.id}/trash`, { revision: 1 }),
    s,
  );
  assert.equal(restored.status, "ARCHIVED");
  assert.equal(
    (
      (await handleApi(
        req(`/projects/${p.id}/restore`, { revision: 2 }),
        s,
      )) as any
    ).status,
    "IDEA",
  );
});
test("chapter saves invalidate approved plot and clear prior review atomically", async () => {
  const s = store(),
    pid = "editing";
  await s.create("projects/" + pid, {
    status: "ACTIVE",
    deletedAt: null,
    plot: { status: "APPROVED" },
  });
  await s.create(`projects/${pid}/chapters/chapter-1`, {
    id: "chapter-1",
    status: "APPROVED",
    ...(await s.content(pid, "기존 원고입니다.")),
    review: { contentHash: "old" },
  });
  const saved: any = await handleApi(
    req(
      `/projects/${pid}/chapter`,
      { revision: 1, title: "제목", content: "수정 원고입니다." },
      "PUT",
    ),
    s,
  );
  assert.equal(saved.review, null);
  assert.equal(saved.status, "REVIEW");
  assert.equal((await s.get("projects/" + pid)).plot.status, "INVALIDATED");
  await assert.rejects(
    handleApi(
      req(
        `/projects/${pid}/chapter`,
        { revision: 1, title: "stale", content: "충돌" },
        "PUT",
      ),
      s,
    ),
    (e: any) => e.status === 409,
  );
  const version: any = await handleApi(
    req(`/projects/${pid}/chapter/snapshot`, { revision: 2 }),
    s,
  );
  assert.equal(version.status, "COMMITTED");
  await handleApi(
    req(
      `/projects/${pid}/chapter`,
      { revision: 2, title: "제목", content: "다른 초안" },
      "PUT",
    ),
    s,
  );
  const restored: any = await handleApi(
    req(`/projects/${pid}/chapter/restore`, {
      revision: 3,
      versionId: version.id,
    }),
    s,
  );
  assert.equal(restored.content, "수정 원고입니다.");
});
test("Supabase auth validates remotely and rejects unapproved users", async () => {
  const request = new Request("https://app.example/api/me", {
    headers: { Authorization: "Bearer fake" },
  });
  await assert.rejects(
    authenticate(request, env, async () => new Response(null, { status: 401 })),
    (e: any) => e.status === 401,
  );
  const user = {
    id: uid,
    email: "writer@example.com",
    email_confirmed_at: "now",
    app_metadata: { providers: ["google"] },
  };
  assert.equal(
    await authenticate(request, env, async () => Response.json(user)),
    uid,
  );
  await assert.rejects(
    authenticate(request, env, async () =>
      Response.json({ ...user, email: "stranger@example.com" }),
    ),
    (e: any) => e.status === 403,
  );
});
test("ahead-of-time schemas reject extra fields and incomplete model output", () => {
  assert.throws(() =>
    validate("AIRequest", {
      revision: 1,
      consent: true,
      maxCostUsd: 0.1,
      ownerUid: other,
    }),
  );
  assert.throws(() => validate("BibleSection", { content: "incomplete" }));
  const body = validate("AIRequest", { revision: 1 });
  assert.equal(body.consent, false);
  assert.equal(body.maxCostUsd, 0.15);
});

test("complete planning and writing workflow keeps approvals and rewrite history", async () => {
  const s = store(),
    originalFetch = globalThis.fetch;
  let task = "style";
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    if (!init?.method)
      return Response.json({
        data: [
          {
            id: "test/model",
            context_length: 2000000,
            pricing: { prompt: "0.000000001", completion: "0.000000001" },
            supported_parameters: ["response_format"],
          },
        ],
      });
    calls++;
    const payload = JSON.parse(init.body as string),
      input = JSON.parse(payload.messages[1].content);
    let result = structuredClone((fixtures as any)[task]);
    if (task === "section")
      result.requirementIds = input.requirements.map((r: any) => r.id);
    if (task === "review")
      result.findings[0].quote = Array.from(input.content)
        .slice(0, 24)
        .join("");
    if (task === "rewrite")
      result.replacement = input.passage + " 수정한 문장입니다.";
    return Response.json({
      id: "fixture-" + calls,
      choices: [
        {
          finish_reason: "stop",
          message: {
            content:
              typeof result === "string" ? result : JSON.stringify(result),
          },
        },
      ],
      usage: { cost: 0 },
    });
  };
  try {
    const settings = {
      models: Object.fromEntries(
        [
          "questions",
          "planning",
          "world",
          "style",
          "story",
          "writing",
          "review",
          "editing",
        ].map((r) => [r, "test/model"]),
      ),
      monthlyBudgetUsd: 5,
      maxOutputTokens: 3000,
    };
    await handleApi(req("/settings", settings, "PUT"), s);
    const ai = async (path: string, revision: number, nextTask: string) => {
      task = nextTask;
      const u = await s.get("account");
      await s.change("account", u.revision, (d) => {
        d.rate = {};
      });
      return (await handleApi(
        req(path, { revision, consent: true, maxCostUsd: 0.15 }),
        s,
      )) as any;
    };
    let style: any = await handleApi(
      req("/styles", {
        name: "워크플로 문체",
        sourceType: "interview",
        notes:
          "가까운 삼인칭 시점과 자연스러운 한국어를 사용하고 감정은 행동으로 보여주세요.",
      }),
      s,
    );
    style = await ai(`/styles/${style.id}/analyze`, style.revision, "style");
    style = await handleApi(
      req(`/styles/${style.id}/approve`, {
        revision: style.revision,
        variant: "A",
        confirmed: true,
      }),
      s,
    );
    const form = new FormData();
    form.set("title", "워크플로 작품");
    form.set("file", new File(["성인 주인공이 약속을 지킨다."], "brief.txt"));
    let p: any = await handleApi(req("/projects", form), s);
    p = await ai(`/projects/${p.id}/analyze`, p.revision, "analysis");
    p = await handleApi(
      req(
        `/projects/${p.id}/answers`,
        {
          revision: p.revision,
          answers: Object.fromEntries(
            p.analysis.questions.map((q: any) => [
              q.id,
              "주어진 약속을 유지합니다.",
            ]),
          ),
        },
        "PUT",
      ),
      s,
    );
    for (const key of [
      "concept",
      "protagonist",
      "characters",
      "relationships",
      "world",
      "narrative",
      "fun",
      "density",
      "style",
      "special",
      "serial",
    ])
      p = await ai(
        `/projects/${p.id}/sections/${key}/generate`,
        p.revision,
        "section",
      );
    p = await handleApi(
      req(`/projects/${p.id}/style`, {
        revision: p.revision,
        styleId: style.id,
      }),
      s,
    );
    p = await ai(`/projects/${p.id}/bible/review`, p.revision, "bible_audit");
    p = await handleApi(
      req(`/projects/${p.id}/approve`, {
        revision: p.revision,
        confirmed: true,
      }),
      s,
    );
    assert.equal(p.status, "ACTIVE");
    p = await ai(`/projects/${p.id}/plot/generate`, p.revision, "plot");
    p = await handleApi(
      req(`/projects/${p.id}/plot/approve`, {
        revision: p.revision,
        confirmed: true,
      }),
      s,
    );
    let ch: any;
    for (const scene of p.plot.scenes)
      ch = await ai(
        `/projects/${p.id}/scenes/${scene.id}/write`,
        p.revision,
        "write",
      );
    const original = ch.content;
    const u = await s.get("account");
    await s.change("account", u.revision, (d) => {
      d.rate = {};
    });
    task = "rewrite";
    const proposal: any = await handleApi(
      req(`/projects/${p.id}/chapter/rewrite`, {
        revision: ch.revision,
        consent: true,
        maxCostUsd: 0.15,
        start: 0,
        end: 5,
        instruction: "문장을 다듬어 주세요.",
      }),
      s,
    );
    ch = await handleApi(
      req(`/projects/${p.id}/chapter/rewrite/apply`, {
        revision: ch.revision,
        proposalId: proposal.id,
      }),
      s,
    );
    assert(ch.content.endsWith(Array.from(original).slice(5).join("")));
    assert.equal(ch.review, null);
    ch = await ai(`/projects/${p.id}/chapter/review`, ch.revision, "review");
    ch = await handleApi(
      req(`/projects/${p.id}/chapter/approve`, {
        revision: ch.revision,
        confirmed: true,
        reviewed: true,
      }),
      s,
    );
    assert(
      (await s.list("jobs")).some(
        (j) =>
          j.task === "section" &&
          j.tokenPlan?.mode === "auto" &&
          j.tokenPlan.maxOutputTokens > 3000,
      ),
    );
    const me: any = await handleApi(req("/me"), s);
    assert.equal(me.settings.outputTokenMode, "auto");
    assert.equal(me.settings.maxOutputTokens, undefined);
    assert.equal(ch.status, "APPROVED");
    assert.equal(ch.approvedTextHash, ch.contentHash);
    const records = await s.list(`projects/${p.id}/approval_records`);
    assert.deepEqual(
      new Set(records.map((r) => r.kind)),
      new Set(["BIBLE", "PLOT", "CHAPTER"]),
    );
    assert.equal((await s.list(`projects/${p.id}/chapter_versions`)).length, 2);
    const zip = (await handleApi(
      req(`/projects/${p.id}/export`),
      s,
    )) as Response;
    assert.equal(zip.headers.get("content-type"), "application/zip");
    assert((await zip.arrayBuffer()).byteLength > 1000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("ambiguous OpenRouter failure retains reservation and never retries", async () => {
  const s = store(),
    originalFetch = globalThis.fetch;
  let submissions = 0;
  globalThis.fetch = async (_input, init) => {
    if (!init?.method)
      return Response.json({
        data: [
          {
            id: "test/model",
            context_length: 2000000,
            pricing: { prompt: "0.000001", completion: "0.000001" },
            supported_parameters: [],
          },
        ],
      });
    submissions++;
    throw new Error("connection reset");
  };
  try {
    const u = await s.get("account");
    await s.change("account", u.revision, (d) => {
      d.rate = {};
    });
    await assert.rejects(
      generate(
        s,
        "write",
        { scene: "테스트" },
        { consent: true, maxCostUsd: 1 },
        { projectId: "failure" },
      ),
    );
    assert.equal(submissions, 1);
    assert((await s.get("account")).spend.reservedUsd > 0);
    assert((await s.list("usage")).some((e) => e.status === "UNCERTAIN"));
    assert((await s.list("jobs")).some((e) => e.checkpoint === "uncertain"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenRouter 402 remains a payment error and is saved without upstream secrets", async () => {
  const s = store(),
    originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("sensitive-provider-body", { status: 402 });
  };
  try {
    const u = await s.get("account");
    await s.change("account", u.revision, (d) => {
      d.rate = {};
    });
    await assert.rejects(
      generate(
        s,
        "analysis",
        { brief: "요청 형식 확인" },
        { consent: true, maxCostUsd: 1 },
        { projectId: "payment-error" },
      ),
      (e: any) =>
        e.status === 402 &&
        e.message.includes("원문 분석") &&
        !e.message.includes("sensitive-provider-body"),
    );
    assert.equal(calls, 1);
    const job = (await s.list("jobs")).find(
      (j) => j.scope?.projectId === "payment-error",
    );
    assert.equal(job?.errorStatus, 402);
    assert(job?.error.includes("잔액"));
    assert(!JSON.stringify(job).includes("sensitive-provider-body"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
