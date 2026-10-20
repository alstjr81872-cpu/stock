const { chromium } = require("@playwright/test");
const { createServer } = require("node:http");
const { readFileSync, existsSync } = require("node:fs");
const { resolve, extname } = require("node:path");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { launchPlan, seedPlan, storyBatch } = require("./launch-fixtures.ts");
const { validateStoryBatch } = require("../../worker/story-ledger.ts");
const fixtures = require("./fixtures.json");
(async () => {
  const server = createServer((req, res) => {
    const path = resolve(
      "out",
      "." +
        (req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0]),
    );
    if (!path.startsWith(resolve("out") + "/") || !existsSync(path)) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader(
      "Content-Type",
      {
        ".js": "application/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".txt": "text/plain",
      }[extname(path)] || "application/octet-stream",
    );
    res.end(readFileSync(path));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const uid = "11111111-1111-4111-8111-111111111111",
      exp = Math.floor(Date.now() / 1000) + 3600;
    const token =
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
        "base64url",
      ) +
      "." +
      Buffer.from(
        JSON.stringify({
          sub: uid,
          exp,
          aud: "authenticated",
          role: "authenticated",
        }),
      ).toString("base64url") +
      ".fixture";
    await page.addInitScript(
      ({ uid, exp, token }) =>
        localStorage.setItem(
          "sb-wqzavlosvhljstkxwhle-auth-token",
          JSON.stringify({
            access_token: token,
            refresh_token: "fixture",
            token_type: "bearer",
            expires_in: 3600,
            expires_at: exp,
            user: {
              id: uid,
              email: "writer@example.com",
              aud: "authenticated",
              role: "authenticated",
              app_metadata: { provider: "google" },
              user_metadata: { full_name: "테스트 작가" },
              created_at: "2026-10-19T00:00:00Z",
            },
          }),
        ),
      { uid, exp, token },
    );

    let p = {
      id: "launch-ui",
      title: "원문 기획",
      genre: "파일에서 자동 분석",
      status: "IDEA",
      revision: 1,
      canonVersion: 0,
      brief: {
        text: "공병 출신의 빙의자가 누명을 기지로 뒤집는 아카데미 이야기.",
        encoding: "utf-8",
        file: { sha256: "fixture" },
      },
      requirements: [{ id: "R001", text: "주인공은 카일 베르너다." }],
      bible: {},
      answers: {},
      plot: null,
      styleBinding: null,
    };
    const batches = [];
    let planProposal,
      synopsisProposal,
      developmentAudit,
      developmentProposal,
      manuscript;
    const turns = [];
    let paid = 0;
    const quote = {
      estimateOnly: true,
      model: "test/model",
      estimatedMaxUsd: 0.1,
      suggestedMaxCostUsd: 0.1,
      remainingMonthlyUsd: 5,
      maxOutputTokens: 12000,
    };
    await page.route("**/api/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        path = url.pathname;
      let data;
      if (request.headers()["x-nf-preflight"] === "1") data = quote;
      else if (path === "/api/me")
        data = {
          uid,
          mode: "supabase",
          aiMode: "live",
          settings: {
            models: {},
            monthlyBudgetUsd: 5,
            outputTokenMode: "auto",
          },
          spend: {},
          backup: { message: "미구성" },
        };
      else if (path === "/api/projects/chat-start") {
        const body = request.postDataJSON();
        assert(!request.headers()["content-type"].includes("multipart"));
        p = {
          ...p,
          title: body.title,
          genre: body.genre,
          brief: { text: body.idea, encoding: "utf-8" },
          chatSeed: body.idea,
          planningMode: "chat",
          chatSequence: 0,
          conversationCanon: [],
        };
        data = p;
      } else if (path === "/api/projects") data = [p];
      else if (path === "/api/styles") data = [];
      else if (path === "/api/projects/launch-ui") data = p;
      else if (path.endsWith("/assistant/history"))
        data = { turns, nextBefore: null };
      else if (path.endsWith("/assistant/message")) {
        paid++;
        const body = request.postDataJSON(),
          writing = body.mode === "writing";
        const automated = body.message.includes("알아서");
        const change = {
          id: "voice",
          kind: "style",
          title: "주인공의 목소리",
          content: "뻔뻔한 독백과 날카로운 대사로 빠르게 반격한다.",
          evidence: body.message,
        };
        const turn = {
          id: "turn-" + String(turns.length + 1).padStart(8, "0"),
          mode: body.mode,
          episode: p.currentEpisode ?? 1,
          message: body.message,
          reply: writing
            ? "늘어진 정리 문장을 대사와 행동으로 바꾼 수정안입니다."
            : automated
              ? "좋아요. 위임받은 부분을 정하고 첫 사건과 인물, 문체까지 기획으로 정리했어요."
              : "권력에 맞서는 해결사와 허술한 천재 중 어느 쪽이 끌리세요?",
          questions:
            writing || automated
              ? []
              : ["주인공이 어떤 식으로 반격하면 좋을까요?"],
          savedCanon: writing || automated ? [change] : [],
          editProposal: writing
            ? {
                status: "PROPOSED",
                edits: [
                  {
                    original: "카일은 경비의 장부를 뒤집어 들었다.",
                    replacement:
                      '"장부도 주인 닮아서 뒤집어졌네." 카일이 기록을 펼쳤다.',
                    reason: "설명 대신 대사로 빈정거리는 목소리를 드러낸다.",
                  },
                ],
              }
            : null,
        };
        turns.push(turn);
        p = {
          ...p,
          revision: p.revision + 1,
          chatSequence: turns.length,
          conversationCanon: writing || automated ? [change] : [],
          chatPlan: automated ? structuredClone(launchPlan) : p.chatPlan,
        };
        data = { project: p, turn };
      } else if (path.endsWith("/assistant/canon")) {
        const body = request.postDataJSON();
        p = {
          ...p,
          revision: p.revision + 1,
          conversationCanon: [{ ...body }],
        };
        data = p;
      } else if (path.endsWith("/assistant/edits/apply")) {
        const turn = turns.find((t) => t.id === request.postDataJSON().turnId);
        for (const edit of turn.editProposal.edits)
          manuscript.content = manuscript.content.replace(
            edit.original,
            edit.replacement,
          );
        manuscript = {
          ...manuscript,
          revision: manuscript.revision + 1,
          review: null,
          status: "REQUIRES_HUMAN",
        };
        turn.editProposal.status = "APPLIED";
        data = manuscript;
      } else if (path.endsWith("/assistant/activate")) {
        const plan = p.chatPlan;
        p = {
          ...p,
          revision: p.revision + 1,
          title: plan.title,
          genre: plan.genre,
          launchPlan: plan,
          planningMode: "launch",
          storyRevision: 1,
          status: "ACTIVE",
          canonVersion: 1,
          currentEpisode: 1,
          targetChars: 5000,
          defaultTargetChars: 5000,
          completedEpisodes: [],
          foreshadowing: [],
          storyFacts: [],
          styleBinding: {
            source: "launch",
            pinnedVersion: 1,
            snapshot: { name: "대화 문체", rules: { voice: plan.style } },
          },
        };
        data = p;
      } else if (path.endsWith("/synopsis"))
        data = {
          batches,
          currentEpisode: p.currentEpisode ?? 1,
          targetChars: p.targetChars ?? 5000,
          nextStart: batches.at(-1)?.end + 1 || 1,
          seeds: p.foreshadowing ?? [],
          worldFacts: p.storyFacts ?? [],
          canExtend:
            !batches.length ||
            Array.from(
              { length: 10 },
              (_, i) => batches.at(-1).end - 9 + i,
            ).every((n) => (p.completedEpisodes ?? []).includes(n)),
        };
      else if (path.endsWith("/synopsis/generate")) {
        paid++;
        const start = batches.at(-1)?.end + 1 || 1;
        const result = storyBatch(start);
        validateStoryBatch(p, result, start, start + 9);
        synopsisProposal = {
          id: "synopsis-" + start,
          inputRevision: p.revision,
          start,
          end: start + 9,
          storyRevision: 1,
          result,
        };
        data = synopsisProposal;
      } else if (path.endsWith("/synopsis/apply")) {
        const ledger = validateStoryBatch(
          p,
          synopsisProposal.result,
          synopsisProposal.start,
          synopsisProposal.end,
        );
        batches.push({ ...synopsisProposal, status: "APPLIED" });
        const number = synopsisProposal.start;
        p = {
          ...p,
          revision: p.revision + 1,
          seriesEnabled: true,
          currentEpisode: number,
          synopsisThrough: synopsisProposal.end,
          episodeSynopsis: synopsisProposal.result.episodes[0],
          foreshadowing: ledger.seeds,
          storyFacts: ledger.facts,
          plot: null,
        };
        data = p;
      } else if (path.endsWith("/writing-settings")) {
        p = {
          ...p,
          revision: p.revision + 1,
          targetChars: request.postDataJSON().targetChars,
          defaultTargetChars: request.postDataJSON().targetChars,
        };
        data = p;
      } else if (path.endsWith("/episodes/select")) {
        const number = request.postDataJSON().number;
        p = {
          ...p,
          revision: p.revision + 1,
          currentEpisode: number,
          episodeSynopsis: batches
            .flatMap((b) => b.result.episodes)
            .find((e) => e.number === number),
          plot: null,
        };
        data = p;
      } else if (path.endsWith("/plot/generate")) {
        paid++;
        const plot = structuredClone(fixtures.plot);
        plot.chapterTitle = p.episodeSynopsis.title;
        plot.scenes[0].seedPlants = p.episodeSynopsis.seedPlants.map(
          (b) => b.seedId,
        );
        plot.scenes[0].seedPayoffs = p.episodeSynopsis.seedPayoffs.map(
          (b) => b.seedId,
        );
        plot.scenes.forEach((s) => {
          s.targetChars = p.targetChars / 2;
        });
        plot.risks =
          p.currentEpisode === 1 ? ["주인공의 첫 반격이 약하다."] : [];
        p = {
          ...p,
          revision: p.revision + 1,
          plot: { ...plot, status: "REVIEW", version: 1, canonVersion: 1 },
        };
        data = p;
      } else if (path.endsWith("/plot/develop/check")) {
        paid++;
        developmentAudit = {
          id: "audit",
          inputRevision: p.revision,
          result: {
            summary: "첫 반격의 목표와 상대의 반응을 구체화할 필요가 있습니다.",
            gaps: [
              {
                id: "gap-reaction",
                title: "상대의 반응",
                detail: "주인공의 허세를 상대가 어떻게 받아치는지 보완합니다.",
                scope: "current",
              },
            ],
          },
        };
        data = developmentAudit;
      } else if (path.endsWith("/plot/develop")) {
        paid++;
        assert.equal(request.postDataJSON().auditId, "audit");
        const preview = structuredClone(p.plot);
        preview.scenes[0].action =
          "주인공이 상대의 거짓 증거를 돈으로 사겠다고 말해 역으로 자백을 유도한다.";
        preview.risks = [];
        developmentProposal = {
          id: "development",
          inputRevision: p.revision,
          result: {
            summary: "반격과 상대의 반응을 구체적인 장면으로 만들었습니다.",
            decisions: [
              {
                issueId: "risk-0",
                disposition: "resolved",
                resolution:
                  "돈을 요구하는 뻔뻔한 협상으로 상대의 모순을 드러냅니다.",
              },
              {
                issueId: "gap-reaction",
                disposition: "resolved",
                resolution:
                  "상대가 겁먹은 반응을 숨기려다 실수하는 행동을 추가합니다.",
              },
            ],
          },
          preview,
        };
        data = developmentProposal;
      } else if (path.endsWith("/plot/develop/apply")) {
        p = {
          ...p,
          revision: p.revision + 1,
          plot: {
            ...developmentProposal.preview,
            status: "REVIEW",
            version: 2,
          },
        };
        data = p;
      } else if (path.endsWith("/plot/approve")) {
        p = {
          ...p,
          revision: p.revision + 1,
          plot: {
            ...p.plot,
            status: "APPROVED",
            canonVersion: p.canonVersion,
            styleVersion: 1,
          },
        };
        const content =
          "인장이 거꾸로 찍혔다. 카일은 경비의 장부를 뒤집어 들었다. 가짜 알리바이가 무너지자 상대의 웃음이 사라졌다.";
        manuscript = {
          id: "story-1-chapter-17",
          number: 17,
          storyRevision: 1,
          revision: 1,
          title: p.plot.chapterTitle,
          status: "REVIEW",
          content,
          contentHash: "fixture-hash",
          writtenScenes: p.plot.scenes.map((s) => s.id),
          charCountWithSpaces: content.length,
          charCountWithoutSpaces: content.replace(/\s/g, "").length,
          canonVersion: p.canonVersion,
          styleVersion: 1,
          planVersion: p.plot.version,
          review: {
            summary: "인장을 반전 증거로 회수했습니다.",
            findings: [],
            requiresHuman: false,
            contentHash: "fixture-hash",
          },
        };
        data = p;
      } else if (path.endsWith("/chapter") && request.method() === "GET") {
        assert.equal(url.searchParams.get("episode"), "17");
        assert.equal(url.searchParams.get("story"), "1");
        data = manuscript;
      } else if (path.endsWith("/chapter/review")) {
        paid++;
        manuscript = {
          ...manuscript,
          revision: manuscript.revision + 1,
          status: "REVIEW",
          review: {
            findings: [],
            summary: "수정 원고를 검토했습니다.",
            requiresHuman: false,
            contentHash: manuscript.contentHash,
          },
        };
        data = manuscript;
      } else if (path.endsWith("/chapter/approve")) {
        assert(request.postDataJSON().verifiedSeeds.includes(seedPlan.id));
        manuscript = {
          ...manuscript,
          status: "APPROVED",
          revision: manuscript.revision + 1,
        };
        p = {
          ...p,
          revision: p.revision + 1,
          foreshadowing: p.foreshadowing.map((s) => ({ ...s, status: "paid" })),
          completedEpisodes: [...p.completedEpisodes, 17],
        };
        data = manuscript;
      } else throw new Error("unexpected route " + path);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    });
    const confirmAI = async () => {
      await page
        .getByRole("checkbox", {
          name: "전송 범위와 실행 한도를 확인했습니다.",
        })
        .check();
      await page
        .getByRole("button", { name: "확인하고 실행", exact: true })
        .click();
    };
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page
      .getByRole("heading", { name: "이야기를 이어갈 시간이에요." })
      .waitFor();
    await page
      .getByRole("button", { name: "새 작품 기획하기", exact: true })
      .click();
    const create = page.getByRole("dialog", {
      name: "새로운 이야기의 시작",
      exact: true,
    });
    await create.getByRole("textbox", { name: "작품 가제" }).fill("채팅 기획");
    await create
      .getByRole("textbox", { name: "시작할 이야기", exact: true })
      .fill("아카데미 미스터리를 쓰고 싶어");
    await create
      .getByRole("button", { name: "대화 시작하기", exact: true })
      .click();
    await create.waitFor({ state: "hidden" });
    assert.equal(p.brief.file, undefined);
    await page.getByRole("heading", { name: "대화로 만드는 이야기" }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: /STEP 04/ }).count(),
      0,
    );
    const chat = page.getByRole("textbox", { name: "AI에게 보낼 메시지" });
    await chat.fill("아카데미 미스터리를 쓰고 싶어");
    await page.getByRole("button", { name: "보내기", exact: true }).click();
    assert.equal(paid, 0);
    await confirmAI();
    await page
      .getByText("주인공이 어떤 식으로 반격하면 좋을까요?", { exact: false })
      .waitFor();
    assert.equal(p.conversationCanon.length, 0);
    await page.getByText("대화 비용 · 전송 설정", { exact: true }).click();
    await page
      .getByRole("checkbox", {
        name: "응답당 아래 한도 내 유료 전송에 동의합니다",
        exact: true,
      })
      .check();
    await page
      .getByRole("spinbutton", { name: "대화 응답당 비용 한도", exact: true })
      .fill("0.15");
    await chat.fill("빈정거리는 해결사가 좋아. 나머지는 알아서 기획해줘");
    await page.getByRole("button", { name: "보내기", exact: true }).click();
    await page
      .getByText("설정집에 저장: 주인공의 목소리", { exact: false })
      .waitFor();
    assert.equal(p.conversationCanon.length, 1);
    assert.equal(paid, 2);
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page.reload();
    await page
      .getByRole("button", { name: /채팅 기획/ })
      .first()
      .click();
    await page
      .getByText("설정집에 저장: 주인공의 목소리", { exact: false })
      .waitFor();

    await page
      .getByRole("button", { name: "수정 · 보관", exact: true })
      .click();
    const canonModal = page.getByRole("dialog", {
      name: "설정집 수정",
      exact: true,
    });
    await canonModal
      .getByRole("textbox", { name: "설정 내용" })
      .fill("건조한 계산 대신 뻔뻔한 말과 행동으로 반격한다.");
    await canonModal
      .getByRole("button", { name: "설정 저장", exact: true })
      .click();
    await canonModal.waitFor({ state: "hidden" });
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        "planning overflow at " + width,
      );
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.screenshot({
      path: "/tmp/nf-chat-planning.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "이 기획으로 시놉시스 만들기", exact: true })
      .click();
    await confirmAI();
    const firstBatch = page.getByRole("dialog", {
      name: "1~10화 시놉시스 제안",
      exact: true,
    });
    await firstBatch.waitFor();
    assert.equal(batches.length, 0);
    await firstBatch.getByText(/9화 투척 → 17화 회수/).waitFor();
    await firstBatch
      .getByRole("button", { name: "이 구간 기록", exact: true })
      .click();
    await firstBatch.waitFor({ state: "hidden" });
    await page
      .getByRole("spinbutton", { name: "원고 목표 글자 수" })
      .fill("6000");
    await page.getByRole("button", { name: "분량 저장", exact: true }).click();
    await page
      .getByRole("button", { name: "첫 회차 설계", exact: true })
      .click();
    await confirmAI();
    await page.getByRole("button", { name: "자동 전개", exact: true }).click();
    await confirmAI();
    await page.getByText(/^자동 전개 2\/2:/).waitFor();
    await confirmAI();
    const development = page.getByRole("dialog", {
      name: "자동 전개 제안",
      exact: true,
    });
    await development.waitFor();
    assert.equal(p.plot.risks.length, 1);
    await development
      .getByRole("button", { name: "이 전개 반영", exact: true })
      .click();
    await development.waitFor({ state: "hidden" });
    p.completedEpisodes = Array.from({ length: 10 }, (_, i) => i + 1);
    p.foreshadowing[0].status = "planted";
    await page
      .getByRole("combobox", { name: "집필할 회차" })
      .selectOption("10");
    const nextQuestion = page.getByRole("dialog", {
      name: "다음 10화 시놉시스",
      exact: true,
    });
    await nextQuestion
      .getByRole("heading", {
        name: "11화부터 20화까지 시놉시스를 만들까요?",
        exact: true,
      })
      .waitFor();
    await nextQuestion
      .getByRole("button", { name: "만들기", exact: true })
      .click();
    await confirmAI();
    const secondBatch = page.getByRole("dialog", {
      name: "11~20화 시놉시스 제안",
      exact: true,
    });
    await secondBatch.waitFor();
    await secondBatch
      .getByText("복선 회수: " + seedPlan.payoffMethod, { exact: true })
      .waitFor();
    await secondBatch
      .getByRole("button", { name: "이 구간 기록", exact: true })
      .click();
    await secondBatch.waitFor({ state: "hidden" });
    await page
      .getByRole("combobox", { name: "집필할 회차" })
      .selectOption("17");
    await page
      .getByRole("button", { name: "17화 장면 설계", exact: true })
      .click();
    await confirmAI();
    await page
      .getByRole("checkbox", {
        name: "인과·관계 진전·미정과 위험을 검수하고 현재 플롯을 승인합니다.",
      })
      .check();
    await page
      .getByRole("button", { name: "플롯 승인 · 집필실로", exact: true })
      .click();
    await page.getByRole("heading", { name: "집필실", exact: true }).waitFor();
    await page
      .getByRole("heading", { name: "집필 어시스턴트", exact: true })
      .waitFor();
    await page
      .getByRole("textbox", { name: "AI에게 보낼 메시지" })
      .fill("주인공 독백과 대사를 실제 수정안으로 바꿔줘");
    await page.getByRole("button", { name: "보내기", exact: true }).click();
    await confirmAI();
    await page
      .getByRole("button", { name: "원고 수정안 비교", exact: true })
      .click();
    const editModal = page.getByRole("dialog", {
      name: "대화로 만든 원고 수정안",
      exact: true,
    });
    await editModal.getByText("장부도 주인 닮아서", { exact: false }).waitFor();
    assert(!manuscript.content.includes("장부도 주인 닮아서"));
    await editModal
      .getByRole("button", { name: "수정안을 원고에 적용", exact: true })
      .click();
    await editModal.waitFor({ state: "hidden" });
    assert(manuscript.content.includes("장부도 주인 닮아서"));
    await page.getByRole("button", { name: "독립 검토", exact: true }).click();
    await confirmAI();
    await page
      .getByRole("button", { name: "원고 반영 완료", exact: true })
      .waitFor();
    await page.screenshot({ path: "/tmp/nf-chat-writing.png", fullPage: true });

    await page
      .getByRole("checkbox", {
        name: "원고와 검토 근거를 직접 확인했고 이 버전을 확정합니다.",
      })
      .check();
    assert(
      await page
        .getByRole("button", { name: "회차 확정", exact: true })
        .isDisabled(),
    );
    await page
      .getByRole("checkbox", {
        name: "원고에서 이 복선의 회수를 확인했습니다.",
      })
      .check();
    await page.getByRole("button", { name: "회차 확정", exact: true }).click();
    await page
      .getByText("제17화 원고를 확정했습니다.", { exact: true })
      .waitFor();
    assert.equal(p.foreshadowing[0].status, "paid");
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        "overflow at " + width,
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS: planning chat, delegated plan, durable editable canon, writing assistant edits, synopsis/seed continuity and 320–1440px layouts. API/auth/model fixtures only.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
