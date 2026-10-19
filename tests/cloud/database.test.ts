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
