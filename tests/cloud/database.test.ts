import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { Store } from "../../worker/store";
import { HttpError, hash, bytes, QuoteReady, now } from "../../worker/shared";
import { handleApi } from "../../worker/api";
import { authenticate } from "../../worker/index";
import { validate } from "../../worker/validation";
import fixtures from "./fixtures.json";
import { generate, settleUsage } from "../../worker/ai";
import { seedTree } from "../../worker/tree";
import { launchPlan, seedPlan, storyBatch } from "./launch-fixtures";
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

test("automatic planning previews then atomically applies names, related sections and history", async () => {
  const s = store(),
    originalFetch = globalThis.fetch,
    pid = "autoplan";
  const originalSection = {
    ...structuredClone(fixtures.section),
    requirementIds: ["R001"],
    openQuestions: ["주인공의 본명은?"],
    conflicts: [],
  };
  const p = await s.create("projects/" + pid, {
    title: "자동 기획 작품",
    brief: { text: "원문 요구를 보존한다." },
    requirements: [{ id: "R001", text: "원문 요구를 보존한다." }],
    answers: {},
    bible: {
      concept: originalSection,
      world: { ...originalSection, openQuestions: [] },
    },
    status: "ACTIVE",
    canonVersion: 1,
    plot: { status: "APPROVED" },
    bibleAudit: { inputHash: "old" },
  });
  const draft = {
    ...originalSection,
    content: originalSection.content + " 저장 전 편집도 유지합니다.",
  };
  const revised = {
    ...draft,
    content:
      draft.content + " 주인공의 본명은 서도윤이며 도시 기록관 출신이다.",
    openQuestions: [],
  };
  const result = {
    summary: "미정 이름과 배경을 결정하고 인물 모듈에 연결했습니다.",
    decisions: [
      {
        issue: "주인공의 본명은?",
        resolution:
          "서도윤이라는 이름과 도시 기록관 출신 배경을 기획에 반영합니다.",
        affectedSections: ["concept", "characters"],
      },
    ],
    characterNames: [
      {
        role: "주인공",
        name: "서도윤",
        background: "빙의 전 도시 기록관에서 시민들의 기록을 관리했다.",
      },
    ],
    sections: [
      { key: "concept", section: revised },
      { key: "characters", section: revised },
    ],
    unresolved: [],
  };
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      id: "test-planning",
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify(result) } },
      ],
      usage: { cost: 0 },
    });
  };
  try {
    const u = await s.get("account");
    await s.change("account", u.revision, (d) => {
      d.rate = {};
    });
    const proposal: any = await handleApi(
      req(`/projects/${pid}/sections/concept/auto-plan`, {
        revision: p.revision,
        section: draft,
        focus: "openQuestions",
        consent: true,
        maxCostUsd: 1,
      }),
      s,
    );
    assert.equal(calls, 1);
    assert.deepEqual((await s.get("projects/" + pid)).bible, p.bible);
    assert.equal(proposal.status, "PROPOSED");
    assert(proposal.inputSection.content.includes("저장 전 편집"));
    await assert.rejects(
      handleApi(
        req(`/projects/${pid}/planning/apply`, {
          revision: 1,
          proposalId: proposal.id,
          confirmed: false,
        }),
        s,
      ),
    );
    const updated: any = await handleApi(
      req(`/projects/${pid}/planning/apply`, {
        revision: 1,
        proposalId: proposal.id,
        confirmed: true,
      }),
      s,
    );
    assert.equal(calls, 1);
    assert.equal(updated.characterNames[0].name, "서도윤");
    assert(updated.bible.characters.content.includes("서도윤"));
    assert(updated.bible.concept.content.includes("저장 전 편집"));
    assert.equal(updated.bible.world.needsReview, true);
    assert.equal(updated.status, "BIBLE_REVIEW");
    assert.equal(updated.plot.status, "INVALIDATED");
    assert.equal(updated.bibleAudit, null);
    assert.deepEqual(updated.requirements, p.requirements);
    assert.equal(updated.brief.text, p.brief.text);
    const history = await s.list(`projects/${pid}/planning_history`);
    assert.equal(history.length, 1);
    assert.deepEqual(history[0].beforeBible, p.bible);
    await assert.rejects(
      handleApi(
        req(`/projects/${pid}/planning/apply`, {
          revision: updated.revision,
          proposalId: proposal.id,
          confirmed: true,
        }),
        s,
      ),
    );
    const stale = await s.create(`projects/${pid}/planning_proposals/stale`, {
      ...proposal,
      id: "stale",
      status: "PROPOSED",
      inputRevision: 1,
    });
    await assert.rejects(
      handleApi(
        req(`/projects/${pid}/planning/apply`, {
          revision: updated.revision,
          proposalId: stale.id,
          confirmed: true,
        }),
        s,
      ),
      (e: any) => e.status === 409,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preflight returns a quote without consent, paid generation, jobs or budget reservations", async () => {
  const s = new Store(env, uid, transport, true),
    originalFetch = globalThis.fetch;
  let calls = 0,
    quote: any;
  const before = await s.get("account"),
    jobs = (await s.list("jobs")).length,
    usage = (await s.list("usage")).length;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("preflight must not generate");
  };
  try {
    await assert.rejects(
      generate(
        s,
        "section",
        { section: "concept", requirements: [], answers: {} },
        { consent: false, maxCostUsd: 5 },
        { projectId: "quote" },
      ),
      (e: any) => {
        if (e instanceof QuoteReady) {
          quote = e.quote;
          return true;
        }
        return false;
      },
    );
    assert.equal(calls, 0);
    assert(quote.maxOutputTokens > 3000);
    assert(quote.suggestedMaxCostUsd >= quote.estimatedMaxUsd);
    assert.deepEqual(await s.get("account"), before);
    assert.equal((await s.list("jobs")).length, jobs);
    assert.equal((await s.list("usage")).length, usage);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("known billing is settled atomically exactly once even after an invalid response", async () => {
  const s = store(),
    account = await s.get("account"),
    stamp = now(),
    base =
      account.spend?.month === stamp.slice(0, 7)
        ? account.spend.reservedUsd
        : 0;
  await s.commit([
    s.prepare(
      "account",
      {
        ...account,
        spend: { month: stamp.slice(0, 7), reservedUsd: base + 0.05 },
      },
      account.revision,
    ),
    s.prepare("usage/settle-once", {
      id: "settle-once",
      createdAt: stamp,
      status: "SUBMITTED",
      reservedUsd: 0.05,
    }),
  ]);
  await Promise.all([
    settleUsage(s, "settle-once", "FAILED", 0.01),
    settleUsage(s, "settle-once", "FAILED", 0.01),
  ]);
  assert(
    Math.abs((await s.get("account")).spend.reservedUsd - (base + 0.01)) < 1e-9,
  );
  const entry = await s.get("usage/settle-once");
  assert.equal(entry.settled, true);
  assert.equal(entry.actualUsd, 0.01);
});

test("truncated paid response settles its known charge instead of keeping the maximum reservation", async () => {
  const s = store(),
    originalFetch = globalThis.fetch,
    account = await s.get("account"),
    before = account.spend.reservedUsd;
  let calls = 0;
  await s.change("account", account.revision, (d) => {
    d.rate = {};
  });
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      id: "truncated-with-cost",
      choices: [
        { finish_reason: "length", message: { content: "{incomplete" } },
      ],
      usage: { cost: 0.0000001 },
    });
  };
  try {
    await assert.rejects(
      generate(
        s,
        "analysis",
        { brief: "테스트" },
        { consent: true, maxCostUsd: 1 },
        { projectId: "truncated-cost" },
      ),
      (e: any) => e.status === 422,
    );
    assert.equal(calls, 1);
    assert(
      Math.abs(
        (await s.get("account")).spend.reservedUsd - before - 0.0000001,
      ) < 1e-9,
    );
    const job = (await s.list("jobs")).find(
      (j) => j.scope?.projectId === "truncated-cost",
    );
    const entry = await s.get("usage/" + job!.id);
    assert.equal(entry.actualUsd, 0.0000001);
    assert.equal(entry.settled, true);
    assert.equal(entry.status, "FAILED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("common tree foundation, linked refinement, stable issue resolution and shared rename persist atomically", async () => {
  const s = store(),
    originalFetch = globalThis.fetch,
    pid = "tree-flow";
  const sec = {
    ...structuredClone(fixtures.section),
    requirementIds: ["R001"],
    openQuestions: ["주인공의 본명과 빙의 전 신분은?"],
    conflicts: [],
  };
  let p = await s.create("projects/" + pid, {
    title: "공통 기획 작품",
    genre: "판타지",
    analysis: fixtures.analysis,
    brief: { text: "원문 조건을 보존한다." },
    requirements: [{ id: "R001", text: "원문 조건을 보존한다." }],
    answers: {},
    bible: { characters: sec },
    status: "BIBLE_REVIEW",
    canonVersion: 0,
  });
  const tree: any = await handleApi(req(`/projects/${pid}/tree`), s);
  assert.equal(tree.foundationReady, false);
  assert.equal(p.planningTree, undefined);
  await assert.rejects(
    handleApi(
      req(`/projects/${pid}/tree/nodes/characters/expand`, {
        revision: 1,
        consent: true,
        maxCostUsd: 1,
      }),
      s,
    ),
    (e: any) => e.status === 409,
  );
  let nextResult: any = {
    summary: "세계관과 인물, 스토리의 중심 갈등을 함께 연결했습니다.",
    nodes: tree.nodes
      .filter((n: any) => !n.id.startsWith("module-"))
      .map(({ status, ...n }: any) => ({
        ...n,
        content:
          n.content + " {{entity:person_main}}는 세계의 제약을 넘어 선택한다.",
        entityIds: ["person_main"],
        requirementIds: ["R001"],
      })),
    entities: [
      {
        id: "person_main",
        kind: "person",
        name: "서도윤",
        role: "주인공",
        aliases: [],
        description: "빙의 이전 도시의 기록관에서 시민 기록을 관리했다.",
        nodeIds: ["characters", "story"],
      },
    ],
    issues: [],
  };
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      id: "tree-fixture",
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify(nextResult) },
        },
      ],
      usage: { cost: 0 },
    });
  };
  try {
    const u = await s.get("account");
    await s.change("account", u.revision, (d) => {
      d.rate = {};
    });
    const proposal: any = await handleApi(
      req(`/projects/${pid}/tree/foundation`, {
        revision: 1,
        consent: true,
        maxCostUsd: 1,
      }),
      s,
    );
    assert.equal((await s.get("projects/" + pid)).planningTree, undefined);
    p = (await handleApi(
      req(`/projects/${pid}/tree/apply`, {
        revision: 1,
        proposalId: proposal.id,
        confirmed: true,
      }),
      s,
    )) as any;
    assert(p.planningTree.foundationReady);
    assert.deepEqual(p.bible.characters.content, sec.content);
    assert.equal(p.planningTree.issues[0].status, "open");
    p = (await handleApi(
      req(
        `/projects/${pid}/tree/entities/person_main`,
        { revision: p.revision, name: "윤서진" },
        "PUT",
      ),
      s,
    )) as any;
    assert.equal(calls, 1);
    assert.equal(p.characterNames[0].name, "윤서진");
    assert.equal(p.planningTree.entities[0].id, "person_main");
    const legacy = p.planningTree.nodes.find(
        (n: any) => n.id === "module-characters",
      ),
      issue = p.planningTree.issues[0];
    const { status, updatedAt, ...node } = legacy;
    nextResult = {
      summary: "이름과 빙의 전 정체를 상세 인물 기획과 연결했습니다.",
      nodes: [
        {
          ...node,
          content:
            "{{entity:person_main}}는 빙의 전 도시 기록관으로 일했으며 기록 지식으로 첫 사건을 해결한다.",
          entityIds: ["person_main"],
        },
        {
          id: "person-background",
          parentId: node.id,
          kind: "detail",
          title: "빙의 전 배경",
          content:
            "{{entity:person_main}}는 기록관의 자료를 정리하면서 세계의 금기를 알게 되었다.",
          entityIds: ["person_main"],
          requirementIds: ["R001"],
          dependsOn: ["world"],
        },
      ],
      entities: [],
      issues: [
        {
          id: issue.id,
          title: "새 표현으로 다듬은 주인공 정체",
          detail: "이름과 직업을 함께 정리합니다.",
          nodeIds: [node.id],
          entityIds: ["person_main"],
          status: "resolved",
          resolution:
            "윤서진은 기록관 출신이며 지식이 첫 사건의 해결 원인이 되도록 연결했다.",
        },
      ],
    };
    const expanded: any = await handleApi(
      req(`/projects/${pid}/tree/nodes/${node.id}/expand`, {
        revision: p.revision,
        issueId: issue.id,
        consent: true,
        maxCostUsd: 1,
      }),
      s,
    );
    const previousRevision = p.revision;
    p = (await handleApi(
      req(`/projects/${pid}/tree/apply`, {
        revision: p.revision,
        proposalId: expanded.id,
        confirmed: true,
      }),
      s,
    )) as any;
    assert.equal(p.planningTree.issues[0].id, issue.id);
    assert.equal(p.planningTree.issues[0].status, "resolved");
    assert.equal(p.bible.characters.openQuestions.length, 0);
    assert(p.bible.characters.content.includes("윤서진"));
    assert.equal(p.brief.text, "원문 조건을 보존한다.");
    assert.equal((await s.list(`projects/${pid}/tree_history`)).length, 3);
    await assert.rejects(
      handleApi(
        req(
          `/projects/${pid}/tree/entities/person_main`,
          { revision: previousRevision, name: "낡은 이름" },
          "PUT",
        ),
        s,
      ),
      (e: any) => e.status === 409,
    );
    assert.equal(calls, 2);
    assert.equal(
      ((await handleApi(req(`/projects/${pid}/tree/history`), s)) as any[])
        .length,
      3,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("name suggestion is quoted before payment and explicit rename updates planning prose while preserving sources", async () => {
  const s = store(),
    pid = "rename-prose",
    originalFetch = globalThis.fetch;
  let p = await s.create(`projects/${pid}`, {
    title: "아카데미",
    genre: "판타지",
    status: "ACTIVE",
    brief: { text: "카일 베르너는 원문의 이름이다." },
    requirements: [{ id: "R001", text: "카일 베르너는 원문의 이름이다." }],
    bible: {
      characters: {
        content: "카일 베르너의 몸에 빙의한 한도윤이다.",
        openQuestions: ["카일 베르너의 목표는?"],
        conflicts: [],
      },
    },
    plot: { status: "APPROVED", chapters: [] },
    planningTree: {
      foundationReady: true,
      nodes: [
        {
          id: "root",
          parentId: null,
          title: "카일 베르너의 이야기",
          content: "카일 베르너는 레온 아르덴과 만난다.",
        },
      ],
      entities: [
        {
          id: "person_main",
          name: "카일 베르너",
          kind: "person",
          description: "카일 베르너와 한도윤은 같은 몸이다.",
        },
        {
          id: "person_hero",
          name: "레온 아르덴",
          kind: "person",
          description: "카일 베르너를 만나는 원작 주인공.",
        },
      ],
    },
  });
  const account = await s.get("account");
  await s.change("account", account.revision, (d) => {
    d.rate = {};
  });
  let paid = 0;
  globalThis.fetch = async () => {
    paid++;
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              name: "에단 로웰",
              reason: "아카데미 배경과 연금술사 역할에 어울리는 이름입니다.",
            }),
          },
        },
      ],
      usage: { cost: 0 },
    });
  };
  try {
    const path = `/projects/${pid}/tree/entities/person_main/suggest-name`;
    await assert.rejects(
      handleApi(
        req(path, { revision: p.revision, consent: false, maxCostUsd: 5 }),
        new Store(env, uid, transport, true),
      ),
      (e: any) => e instanceof QuoteReady && e.quote.suggestedMaxCostUsd > 0,
    );
    assert.equal(paid, 0);
    const suggestion: any = await handleApi(
      req(path, { revision: p.revision, consent: true, maxCostUsd: 1 }),
      s,
    );
    assert.equal(paid, 1);
    assert.equal(suggestion.name, "에단 로웰");
    assert.equal((await s.get(`projects/${pid}`)).revision, p.revision);
    p = (await handleApi(
      req(
        `/projects/${pid}/tree/entities/person_main`,
        { revision: p.revision, name: suggestion.name },
        "PUT",
      ),
      s,
    )) as any;
    assert.equal(paid, 1);
    assert.equal(
      p.bible.characters.content,
      "에단 로웰의 몸에 빙의한 한도윤이다.",
    );
    assert.equal(p.bible.characters.openQuestions[0], "에단 로웰의 목표는?");
    assert.equal(p.planningTree.entities[1].name, "레온 아르덴");
    assert(p.planningTree.entities[1].description.includes("에단 로웰"));
    assert.equal(p.brief.text, "카일 베르너는 원문의 이름이다.");
    assert.equal(p.requirements[0].text, p.brief.text);
    assert.equal(p.plot.status, "INVALIDATED");
    assert.equal(p.planningTree.nodes[0].status, "needsReview");
    assert.deepEqual(p.planningTree.entities[0].aliases, ["카일 베르너"]);
    const history = await s.list(`projects/${pid}/tree_history`);
    assert.equal(history[0].beforeTree.entities[0].name, "카일 베르너");
    await assert.rejects(
      handleApi(
        req(
          `/projects/${pid}/tree/entities/person_main`,
          { revision: p.revision, name: "레온 아르덴" },
          "PUT",
        ),
        s,
      ),
      (e: any) => e.status === 422,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tree approval proceeds with unfinished branches and no legacy modules or style library, through plot and writing context", async () => {
  const s = store(),
    pid = "tree-only",
    originalFetch = globalThis.fetch;
  let p = await s.create(`projects/${pid}`, {
    title: "트리만으로 시작하는 작품",
    status: "BIBLE_REVIEW",
    canonVersion: 0,
    brief: { text: "원문 요구를 보존한다." },
    requirements: [{ id: "R001", text: "원문 요구를 보존한다." }],
    analysis: { questions: [], conflicts: [] },
    answers: {},
    bible: {},
    styleBinding: null,
  });
  await assert.rejects(
    handleApi(
      req(`/projects/${pid}/tree/approve`, {
        revision: p.revision,
        confirmed: true,
      }),
      s,
    ),
    (e: any) => e.status === 422,
  );
  const tree = seedTree(p);
  tree.foundationReady = true;
  tree.nodes[2].status = "needsReview";
  tree.issues.push({
    id: "later",
    title: "이후의 전개",
    detail: "중반의 사건은 집필하면서 구체화한다.",
    nodeIds: ["story"],
    entityIds: [],
    status: "open",
    resolution: "",
  });
  p = await s.change(`projects/${pid}`, p.revision, (d) => {
    d.planningTree = tree;
  });
  await assert.rejects(
    handleApi(
      req(`/projects/${pid}/tree/approve`, {
        revision: p.revision,
        confirmed: false,
      }),
      s,
    ),
    (e: any) => e.status === 422,
  );
  const beforeRevision = p.revision;
  p = (await handleApi(
    req(`/projects/${pid}/tree/approve`, {
      revision: p.revision,
      confirmed: true,
    }),
    s,
  )) as any;
  assert.equal(p.status, "ACTIVE");
  assert.equal(p.planningMode, "tree");
  assert.deepEqual(p.bible, {});
  assert.equal(p.bibleAudit, undefined);
  assert.equal(p.styleBinding.source, "tree");
  assert.equal(p.styleBinding.pinnedVersion, 1);
  assert.equal(p.planningTree.issues[0].status, "open");
  assert(p.treeApproval.warnings.some((w: string) => w.includes("미정")));
  assert(p.treeApproval.warnings.some((w: string) => w.includes("원문 요구")));
  assert.equal(p.brief.text, "원문 요구를 보존한다.");
  assert.equal((await s.list(`projects/${pid}/approval_records`)).length, 1);
  assert((await s.read(p.bibleSnapshot)).length > 0);
  await assert.rejects(
    handleApi(
      req(`/projects/${pid}/tree/approve`, {
        revision: beforeRevision,
        confirmed: true,
      }),
      s,
    ),
    (e: any) => e.status === 409,
  );
  const account = await s.get("account");
  await s.change("account", account.revision, (d) => {
    d.rate = {};
  });
  let paid = 0;
  globalThis.fetch = async (_url, init) => {
    paid++;
    const requestBody = JSON.parse(init!.body as string);
    assert(
      JSON.stringify(requestBody).includes(
        "중반의 사건은 집필하면서 구체화한다.",
      ),
    );
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify(fixtures.plot) },
        },
      ],
      usage: { cost: 0 },
    });
  };
  try {
    p = (await handleApi(
      req(`/projects/${pid}/plot/generate`, {
        revision: p.revision,
        consent: true,
        maxCostUsd: 1,
      }),
      s,
    )) as any;
    p = (await handleApi(
      req(`/projects/${pid}/plot/approve`, {
        revision: p.revision,
        confirmed: true,
      }),
      s,
    )) as any;
    const compiled: any = await handleApi(req(`/projects/${pid}/prompt/s1`), s);
    assert.equal(paid, 1);
    assert.equal(compiled.layers.L2.name, "기획 트리의 문체 · 연출");
    assert.equal(compiled.layers.L3.common_planning_tree.issues[0].id, "later");
    assert.deepEqual(compiled.layers.L3.bible, {});
    p = await s.change(`projects/${pid}`, p.revision, (d) => {
      d.status = "BIBLE_REVIEW";
      d.planningTree.nodes[4].content =
        "다듬은 문체로 인물의 감각을 따라 쓰고 과장된 수사를 줄인다.";
    });
    p = (await handleApi(
      req(`/projects/${pid}/approve`, {
        revision: p.revision,
        confirmed: true,
      }),
      s,
    )) as any;
    assert.equal(p.canonVersion, 2);
    assert.equal(p.styleBinding.pinnedVersion, 2);
    assert(p.styleBinding.snapshot.rules.guidance.includes("다듬은 문체"));
    assert.equal(p.plot.status, "INVALIDATED");
    assert.equal(p.planningTree.issues[0].status, "open");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("automatic plot development quotes once, previews without mutation and applies with CAS and preserved continuation notes", async () => {
  const s = store(),
    pid = "plot-develop",
    originalFetch = globalThis.fetch;
  const oldPlot = {
    ...structuredClone(fixtures.plot),
    status: "REVIEW",
    version: 1,
    canonVersion: 1,
    risks: ["장면의 행동 동기가 부족하다."],
    openQuestions: ["후반 결말은?"],
    continuationNotes: ["기존 장기 메모"],
  };
  let p = await s.create(`projects/${pid}`, {
    title: "자동 전개 작품",
    status: "ACTIVE",
    canonVersion: 1,
    planningMode: "tree",
    requirements: [],
    answers: {},
    bible: {},
    plot: oldPlot,
    styleBinding: {
      pinnedVersion: 1,
      snapshot: { name: "기획의 문체", rules: {} },
    },
  });
  const account = await s.get("account");
  await s.change("account", account.revision, (d) => {
    d.rate = {};
  });
  const developed = structuredClone(fixtures.plot);
  developed.scenes[0].action = "잃어버린 기록을 돌려주기 위해 약속을 선택한다.";
  const result = {
    summary:
      "장면의 행동 동기를 정하고 후반 결말은 이후 전개의 메모로 남깁니다.",
    plot: developed,
    decisions: [
      {
        issueId: "risk-0",
        disposition: "resolved",
        resolution:
          "기록을 돌려주려는 구체적인 행동 동기를 첫 장면에 반영했다.",
      },
      {
        issueId: "question-0",
        disposition: "later",
        resolution:
          "후반 결말은 첫 회차에 필요하지 않아 이후 아크를 설계할 때 구체화한다.",
      },
    ],
  };
  let paid = 0;
  globalThis.fetch = async () => {
    paid++;
    return Response.json({
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify(result) } },
      ],
      usage: { cost: 0 },
    });
  };
  try {
    await assert.rejects(
      handleApi(
        req(`/projects/${pid}/plot/develop`, {
          revision: p.revision,
          consent: false,
          maxCostUsd: 5,
        }),
        new Store(env, uid, transport, true),
      ),
      (e: any) => e instanceof QuoteReady,
    );
    assert.equal(paid, 0);
    const proposal: any = await handleApi(
      req(`/projects/${pid}/plot/develop`, {
        revision: p.revision,
        consent: true,
        maxCostUsd: 1,
      }),
      s,
    );
    assert.equal(paid, 1);
    assert.deepEqual((await s.get(`projects/${pid}`)).plot, oldPlot);
    await assert.rejects(
      handleApi(
        req(`/projects/${pid}/plot/develop/apply`, {
          revision: p.revision + 1,
          confirmed: true,
          proposalId: proposal.id,
        }),
        s,
      ),
      (e: any) => e.status === 409,
    );
    p = (await handleApi(
      req(`/projects/${pid}/plot/develop/apply`, {
        revision: p.revision,
        confirmed: true,
        proposalId: proposal.id,
      }),
      s,
    )) as any;
    assert.equal(paid, 1);
    assert.equal(p.plot.status, "REVIEW");
    assert.equal(p.plot.version, 2);
    assert.equal(p.plot.risks.length, 0);
    assert.equal(p.plot.openQuestions.length, 0);
    assert(p.plot.continuationNotes.includes("기존 장기 메모"));
    assert(
      p.plot.continuationNotes.some((n: string) => n.includes("후반 결말")),
    );
    const history = await s.list(`projects/${pid}/plot_history`);
    assert.deepEqual(history[0].beforePlot, oldPlot);
    await assert.rejects(
      handleApi(
        req(`/projects/${pid}/plot/develop/apply`, {
          revision: p.revision,
          confirmed: true,
          proposalId: proposal.id,
        }),
        s,
      ),
      (e: any) => e.status === 409,
    );
    p = (await handleApi(
      req(`/projects/${pid}/plot/approve`, {
        revision: p.revision,
        confirmed: true,
      }),
      s,
    )) as any;
    const compiled: any = await handleApi(req(`/projects/${pid}/prompt/s1`), s);
    assert(
      compiled.layers.L3.plot_continuation_notes.some((n: string) =>
        n.includes("후반 결말"),
      ),
    );
    await assert.rejects(
      handleApi(
        req(`/projects/${pid}/plot/develop`, {
          revision: p.revision,
          consent: true,
          maxCostUsd: 1,
        }),
        s,
      ),
      (e: any) => e.status === 409,
    );
    assert.equal(paid, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("automatic development checks missing details first and carries the saved check into the second paid stage", async () => {
  const s = store(),
    pid = "plot-gap-stages",
    originalFetch = globalThis.fetch;
  let p = await s.create(`projects/${pid}`, {
    title: "단계별 자동 전개",
    status: "ACTIVE",
    canonVersion: 1,
    planningMode: "tree",
    requirements: [],
    answers: {},
    bible: {},
    plot: { ...structuredClone(fixtures.plot), status: "REVIEW", version: 1 },
    styleBinding: {
      pinnedVersion: 1,
      snapshot: { name: "기획 문체", rules: {} },
    },
  });
  const account = await s.get("account");
  await s.change("account", account.revision, (d) => {
    d.rate = {};
  });
  let paid = 0;
  let output: any = {
    summary: "두 장면 사이의 시간 경과가 모호한 부분을 발견했습니다.",
    gaps: [
      {
        id: "gap-time",
        title: "장면 사이 시간",
        detail: "첫 만남에서 다음 행동으로 넘어가는 시간 경과를 결정해야 한다.",
        scope: "current",
      },
    ],
  };
  globalThis.fetch = async () => {
    paid++;
    return Response.json({
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify(output) } },
      ],
      usage: { cost: 0 },
    });
  };
  try {
    const path = `/projects/${pid}/plot/develop`;
    await assert.rejects(
      handleApi(
        req(path + "/check", {
          revision: p.revision,
          consent: false,
          maxCostUsd: 5,
        }),
        new Store(env, uid, transport, true),
      ),
      (e: any) => e instanceof QuoteReady,
    );
    assert.equal(paid, 0);
    const audit: any = await handleApi(
      req(path + "/check", {
        revision: p.revision,
        consent: true,
        maxCostUsd: 1,
      }),
      s,
    );
    assert.equal(paid, 1);
    assert.equal((await s.get(`projects/${pid}`)).revision, p.revision);
    const developed = structuredClone(fixtures.plot);
    developed.scenes[1].startState = "같은 날 오후, 첫 장면의 약속을 돌아본다.";
    output = {
      summary: "발견한 시간의 공백을 채워 두 장면의 인과를 연결했습니다.",
      decisions: [
        {
          issueId: "gap-time",
          disposition: "resolved",
          resolution:
            "같은 날 오후로 시간을 정해 첫 장면과 두 번째 장면을 연결했다.",
        },
      ],
      plot: developed,
    };
    await assert.rejects(
      handleApi(
        req(path, {
          revision: p.revision,
          auditId: audit.id,
          consent: false,
          maxCostUsd: 5,
        }),
        new Store(env, uid, transport, true),
      ),
      (e: any) => e instanceof QuoteReady,
    );
    assert.equal(paid, 1);
    const proposal: any = await handleApi(
      req(path, {
        revision: p.revision,
        auditId: audit.id,
        consent: true,
        maxCostUsd: 1,
      }),
      s,
    );
    assert.equal(proposal.auditId, audit.id);
    assert.equal(paid, 2);
    p = (await handleApi(
      req(path + "/apply", {
        revision: p.revision,
        proposalId: proposal.id,
        confirmed: true,
      }),
      s,
    )) as any;
    assert(p.plot.scenes[1].startState.includes("같은 날 오후"));
    assert.equal(
      (await s.list(`projects/${pid}/plot_history`))[0].auditId,
      audit.id,
    );
    await assert.rejects(
      handleApi(
        req(path, {
          revision: p.revision,
          auditId: audit.id,
          consent: true,
          maxCostUsd: 1,
        }),
        s,
      ),
      (e: any) => e.status === 409,
    );
    assert.equal(paid, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ten-episode synopsis records drive separate chapter drafts, length and continuation from episode eleven", async () => {
  const s = store(),
    pid = "serial-ten",
    originalFetch = globalThis.fetch;
  let p = await s.create(`projects/${pid}`, {
    title: "연재 테스트",
    status: "ACTIVE",
    planningMode: "tree",
    canonVersion: 1,
    requirements: [],
    answers: {},
    bible: {},
    styleBinding: { pinnedVersion: 1, snapshot: { name: "문체", rules: {} } },
  });
  const account = await s.get("account");
  await s.change("account", account.revision, (d) => {
    d.rate = {};
  });
  const batch = (start: number) => ({
    summary: `${start}화부터 이어지는 열 회차의 사건과 인물 변화를 연결한 시놉시스입니다.`,
    episodes: Array.from({ length: 10 }, (_, i) => ({
      number: start + i,
      title: `${start + i}화 기록의 약속`,
      synopsis:
        "사라진 기록을 찾는 인물이 동료에게 약속을 건네고, 약속을 지키는 선택의 결과로 다음 사건의 단서를 얻는다. 작은 손해와 성과를 함께 누적한다.",
      characterChange: "서로를 경계하던 인물들이 작은 약속으로 신뢰를 쌓는다.",
      endingHook: "되찾은 기록의 마지막 줄에서 다음 사건의 단서가 드러난다.",
    })),
  });
  let output: any = batch(1),
    paid = 0,
    lastInput = "";
  globalThis.fetch = async (_url, init) => {
    paid++;
    lastInput = String(init!.body);
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content:
              typeof output === "string" ? output : JSON.stringify(output),
          },
        },
      ],
      usage: { cost: 0 },
    });
  };
  const request = (
    path: string,
    body?: any,
    method?: string,
    episode?: number,
  ) =>
    req(
      `/projects/${pid}${path}${episode ? `?episode=${episode}` : ""}`,
      body,
      method,
    );
  try {
    await assert.rejects(
      handleApi(
        request("/synopsis/generate", {
          revision: p.revision,
          consent: false,
          maxCostUsd: 5,
        }),
        new Store(env, uid, transport, true),
      ),
      (e: any) => e instanceof QuoteReady,
    );
    assert.equal(paid, 0);
    const proposed: any = await handleApi(
      request("/synopsis/generate", {
        revision: p.revision,
        consent: true,
        maxCostUsd: 1,
      }),
      s,
    );
    assert.equal((await s.get(`projects/${pid}`)).episodeSynopsis, undefined);
    p = (await handleApi(
      request("/synopsis/apply", {
        revision: p.revision,
        proposalId: proposed.id,
        confirmed: true,
      }),
      s,
    )) as any;
    assert.equal(p.episodeSynopsis.number, 1);
    assert.equal(p.synopsisThrough, 10);
    const state: any = await handleApi(request("/synopsis"), s);
    assert.equal(state.batches[0].result.episodes.length, 10);
    assert.equal(state.canExtend, false);
    await assert.rejects(
      handleApi(
        request("/synopsis/generate", {
          revision: p.revision,
          consent: true,
          maxCostUsd: 1,
        }),
        s,
      ),
      (e: any) => e.status === 409,
    );
    p = (await handleApi(
      request(
        "/writing-settings",
        { revision: p.revision, targetChars: 6000 },
        "PUT",
      ),
      s,
    )) as any;
    output = fixtures.plot;
    p = (await handleApi(
      request("/plot/generate", {
        revision: p.revision,
        consent: true,
        maxCostUsd: 1,
      }),
      s,
    )) as any;
    assert(lastInput.includes("1화 기록의 약속"));
    assert.equal(
      p.plot.scenes.reduce((n: number, sc: any) => n + sc.targetChars, 0),
      6000,
    );
    p = (await handleApi(
      request("/plot/approve", { revision: p.revision, confirmed: true }),
      s,
    )) as any;
    const prompt: any = await handleApi(
      request("/prompt/s1", undefined, "GET", 1),
      s,
    );
    assert.equal(prompt.layers.L3.episode_synopsis.number, 1);
    assert.equal(prompt.layers.L4.targetChars, 3000);
    output = fixtures.write;
    let ch: any = await handleApi(
      request(
        "/scenes/s1/write",
        { revision: p.revision, consent: true, maxCostUsd: 1 },
        "POST",
        1,
      ),
      s,
    );
    ch = await handleApi(
      request(
        "/scenes/s2/write",
        { revision: p.revision, consent: true, maxCostUsd: 1 },
        "POST",
        1,
      ),
      s,
    );
    output = {
      findings: [],
      strengths: ["인과가 이어진다."],
      summary: "약속을 지키기 위해 작은 손해를 감수하고 기록을 되찾았다.",
      requiresHuman: false,
    };
    ch = await handleApi(
      request(
        "/chapter/review",
        { revision: ch.revision, consent: true, maxCostUsd: 1 },
        "POST",
        1,
      ),
      s,
    );
    ch = await handleApi(
      request(
        "/chapter/approve",
        { revision: ch.revision, confirmed: true, reviewed: true },
        "POST",
        1,
      ),
      s,
    );
    const firstContent = ch.content;
    p = await s.get(`projects/${pid}`);
    p = (await handleApi(
      request("/episodes/select", { revision: p.revision, number: 2 }),
      s,
    )) as any;
    assert.equal(p.episodeSynopsis.number, 2);
    assert.equal(p.plot, null);
    await assert.rejects(
      handleApi(
        request(
          "/chapter",
          {
            revision: 1,
            title: "잘못된 탭",
            content: "다른 회차에 쓰면 안 된다.",
          },
          "PUT",
          1,
        ),
        s,
      ),
      (e: any) => e.status === 409,
    );
    output = fixtures.plot;
    p = (await handleApi(
      request("/plot/generate", {
        revision: p.revision,
        consent: true,
        maxCostUsd: 1,
      }),
      s,
    )) as any;
    assert(lastInput.includes("2화 기록의 약속"));
    p = (await handleApi(
      request("/plot/approve", { revision: p.revision, confirmed: true }),
      s,
    )) as any;
    output = fixtures.write;
    ch = await handleApi(
      request(
        "/scenes/s1/write",
        { revision: p.revision, consent: true, maxCostUsd: 1 },
        "POST",
        2,
      ),
      s,
    );
    assert.equal(ch.id, "chapter-2");
    assert.equal(ch.number, 2);
    assert.equal(
      (await s.get(`projects/${pid}/chapters/chapter-1`)).content,
      firstContent,
    );
    assert(await s.get(`projects/${pid}/scenes/chapter-2-s1`));
    assert.equal(
      (
        (await handleApi(
          request("/chapter/versions", undefined, "GET", 2),
          s,
        )) as any[]
      ).length,
      0,
    );
    const v = (await s.list(`projects/${pid}/chapter_versions`))[0];
    await assert.rejects(
      handleApi(request(`/chapter/versions/${v.id}`, undefined, "GET", 2), s),
      (e: any) => e.status === 404,
    );
    for (let n = 3; n <= 10; n++)
      await s.create(`projects/${pid}/chapters/chapter-${n}`, {
        id: `chapter-${n}`,
        number: n,
        status: "APPROVED",
        title: `${n}화`,
        content: "앞 회차의 약속을 이어 다음 사건을 해결했다.",
        review: { summary: "이전 선택의 대가가 다음 단서를 열었다." },
      });
    p = await s.change(`projects/${pid}`, p.revision, (d) => {
      d.completedEpisodes = Array.from({ length: 10 }, (_, i) => i + 1);
      d.currentEpisode = 10;
      d.episodeSynopsis = batch(1).episodes[9];
    });
    assert.equal(
      ((await handleApi(request("/synopsis"), s)) as any).canExtend,
      true,
    );
    output = batch(11);
    const next: any = await handleApi(
      request("/synopsis/generate", {
        revision: p.revision,
        consent: true,
        maxCostUsd: 1,
      }),
      s,
    );
    assert(lastInput.includes("previous_batch"));
    p = (await handleApi(
      request("/synopsis/apply", {
        revision: p.revision,
        proposalId: next.id,
        confirmed: true,
      }),
      s,
    )) as any;
    assert.equal(p.currentEpisode, 11);
    assert.equal(p.episodeSynopsis.number, 11);
    assert.equal(p.synopsisThrough, 20);
    assert.equal(p.plot, null);
    assert.equal(p.targetChars, 6000);
    assert.equal(
      (await s.get(`projects/${pid}/synopsis_batches/${proposed.id}`)).result
        .episodes[0].number,
      1,
    );
    assert.equal(
      ((await handleApi(request("/synopsis"), s)) as any).batches.length,
      2,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("file-to-plan launches a preserved story version and carries episode-nine setup to episode-seventeen verified payoff", async () => {
  const s = store(),
    originalFetch = globalThis.fetch;
  const form = new FormData();
  form.set("title", "파일 기획");
  form.set("genre", "파일에서 자동 분석");
  const source =
    "# 아카데미 기획\n공병 출신 빙의자가 누명을 기지로 뒤집는다. 주인공 이름은 카일 베르너다.";
  form.set("file", new File([source], "idea.md"));
  let p: any = await handleApi(req("/projects", form), s),
    pid = p.id;
  await s.create(`projects/${pid}/chapters/chapter-1`, {
    id: "chapter-1",
    status: "APPROVED",
    content: "보존해야 하는 예전 원고",
    number: 1,
  });
  const account = await s.get("account");
  await s.change("account", account.revision, (d) => {
    d.rate = {};
  });
  let output: any = structuredClone(launchPlan),
    paid = 0;
  globalThis.fetch = async () => {
    paid++;
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content:
              typeof output === "string" ? output : JSON.stringify(output),
          },
        },
      ],
      usage: { cost: 0 },
    });
  };
  const call = (path: string, body?: any, method?: string, number?: number) =>
    handleApi(
      req(
        `/projects/${pid}${path}${number ? `?episode=${number}&story=1` : ""}`,
        body,
        method,
      ),
      s,
    );
  try {
    await assert.rejects(
      handleApi(
        req(`/projects/${pid}/launch/generate`, {
          revision: p.revision,
          consent: false,
          maxCostUsd: 5,
        }),
        new Store(env, uid, transport, true),
      ),
      (e: any) => e instanceof QuoteReady,
    );
    assert.equal(paid, 0);
    const proposal: any = await call("/launch/generate", {
      revision: p.revision,
      consent: true,
      maxCostUsd: 1,
    });
    assert.equal((await s.get(`projects/${pid}`)).launchPlan, undefined);
    p = await call("/launch/apply", {
      revision: p.revision,
      proposalId: proposal.id,
      plan: launchPlan,
      confirmed: true,
    });
    assert.equal(p.planningMode, "launch");
    assert.equal(p.status, "ACTIVE");
    assert.equal(p.storyRevision, 1);
    assert.equal(p.styleBinding.source, "launch");
    assert.equal(p.analysis, null);
    assert.equal(p.brief.text, source);
    assert.equal(
      (await s.get(`projects/${pid}/chapters/chapter-1`)).content,
      "보존해야 하는 예전 원고",
    );
    assert.equal(
      (await s.list(`projects/${pid}/launch_history`))[0].beforeProject.brief
        .text,
      source,
    );
    output = storyBatch(1);
    const first: any = await call("/synopsis/generate", {
      revision: p.revision,
      consent: true,
      maxCostUsd: 1,
    });
    p = await call("/synopsis/apply", {
      revision: p.revision,
      proposalId: first.id,
      confirmed: true,
    });
    assert.equal(p.foreshadowing[0].payoffEpisode, 17);
    assert.equal(p.foreshadowing[0].status, "planned");
    output = structuredClone(fixtures.plot);
    p = await call("/plot/generate", {
      revision: p.revision,
      consent: true,
      maxCostUsd: 1,
    });
    p = await call("/plot/approve", { revision: p.revision, confirmed: true });
    const context: any = await call("/prompt/s1", undefined, "GET", 1);
    assert.equal(context.layers.L3.common_planning_tree, null);
    assert.equal(context.layers.L3.story.plan.protagonistId, "person_main");
    assert(
      !context.layers.L3.story.worldFacts.some(
        (f: any) => f.id === "fact-pass",
      ),
    );
    output = fixtures.write;
    let ch: any = await call(
      "/scenes/s1/write",
      { revision: p.revision, consent: true, maxCostUsd: 1 },
      "POST",
      1,
    );
    ch = await call(
      "/scenes/s2/write",
      { revision: p.revision, consent: true, maxCostUsd: 1 },
      "POST",
      1,
    );
    assert.equal(ch.id, "story-1-chapter-1");
    assert.equal(
      (await s.get(`projects/${pid}/chapters/chapter-1`)).content,
      "보존해야 하는 예전 원고",
    );
    output = {
      findings: [],
      strengths: ["선택이 드러난다."],
      summary: "작은 반격으로 첫 단서를 손에 넣었다.",
      requiresHuman: false,
    };
    ch = await call(
      "/chapter/review",
      { revision: ch.revision, consent: true, maxCostUsd: 1 },
      "POST",
      1,
    );
    await call(
      "/chapter/approve",
      { revision: ch.revision, confirmed: true, reviewed: true },
      "POST",
      1,
    );
    p = await s.get(`projects/${pid}`);
    for (let n = 2; n <= 16; n++)
      await s.create(`projects/${pid}/chapters/story-1-chapter-${n}`, {
        id: `story-1-chapter-${n}`,
        number: n,
        storyRevision: 1,
        status: "APPROVED",
        title: `${n}화`,
        content: "인물의 선택과 단서를 이어 온 확정 원고",
        review: { summary: "증거를 찾아 다음 사건을 열었다." },
      });
    p = await s.change(`projects/${pid}`, p.revision, (d) => {
      d.currentEpisode = 10;
      d.plot = null;
      d.completedEpisodes = Array.from({ length: 10 }, (_, i) => i + 1);
      d.foreshadowing[0].status = "planted";
      d.foreshadowing[0].plantedIn = {
        chapterId: "story-1-chapter-9",
        contentHash: "setup-proof",
      };
    });
    const missed = storyBatch(11);
    missed.episodes[6].seedPayoffs = [];
    output = missed;
    await assert.rejects(
      call("/synopsis/generate", {
        revision: p.revision,
        consent: true,
        maxCostUsd: 1,
      }),
      (e: any) => e.status === 422,
    );
    output = storyBatch(11);
    const second: any = await call("/synopsis/generate", {
      revision: p.revision,
      consent: true,
      maxCostUsd: 1,
    });
    p = await call("/synopsis/apply", {
      revision: p.revision,
      proposalId: second.id,
      confirmed: true,
    });
    p = await call("/episodes/select", { revision: p.revision, number: 17 });
    assert.equal(p.episodeSynopsis.seedPayoffs[0].seedId, seedPlan.id);
    const plot: any = structuredClone(fixtures.plot);
    plot.scenes[0].seedPayoffs = [seedPlan.id];
    output = plot;
    p = await call("/plot/generate", {
      revision: p.revision,
      consent: true,
      maxCostUsd: 1,
    });
    p = await call("/plot/approve", { revision: p.revision, confirmed: true });
    const payoff: any = await call("/prompt/s1", undefined, "GET", 17);
    assert.equal(
      payoff.layers.L3.story.payoffs[0].payoffMethod,
      seedPlan.payoffMethod,
    );
    output = fixtures.write;
    ch = await call(
      "/scenes/s1/write",
      { revision: p.revision, consent: true, maxCostUsd: 1 },
      "POST",
      17,
    );
    ch = await call(
      "/scenes/s2/write",
      { revision: p.revision, consent: true, maxCostUsd: 1 },
      "POST",
      17,
    );
    output = {
      findings: [],
      strengths: [],
      summary: "인장을 반전 증거로 사용했다.",
      requiresHuman: false,
    };
    ch = await call(
      "/chapter/review",
      { revision: ch.revision, consent: true, maxCostUsd: 1 },
      "POST",
      17,
    );
    await assert.rejects(
      call(
        "/chapter/approve",
        { revision: ch.revision, confirmed: true, reviewed: true },
        "POST",
        17,
      ),
      (e: any) => e.status === 422,
    );
    await call(
      "/chapter/approve",
      {
        revision: ch.revision,
        confirmed: true,
        reviewed: true,
        verifiedSeeds: [seedPlan.id],
      },
      "POST",
      17,
    );
    p = await s.get(`projects/${pid}`);
    assert.equal(p.foreshadowing[0].status, "paid");
    assert.equal(p.foreshadowing[0].paidIn.chapterId, "story-1-chapter-17");
    assert.equal(p.foreshadowing[0].paidIn.verifiedByAuthor, true);
    await assert.rejects(
      handleApi(req(`/projects/${pid}/chapter?episode=17&story=0`), s),
      (e: any) => e.status === 409,
    );
    const draft: any = await call("/launch/draft", { revision: p.revision });
    p = await call("/launch/apply", {
      revision: p.revision,
      proposalId: draft.id,
      plan: launchPlan,
      confirmed: true,
    });
    assert.equal(p.storyRevision, 2);
    assert.equal(((await call("/synopsis")) as any).batches.length, 0);
    assert.equal(
      (await s.get(`projects/${pid}/chapters/story-1-chapter-17`)).status,
      "APPROVED",
    );
    assert.equal(
      (await s.get(`projects/${pid}/chapters/chapter-1`)).content,
      "보존해야 하는 예전 원고",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
