const { chromium } = require("@playwright/test");
const { createServer } = require("node:http");
const { readFileSync, existsSync } = require("node:fs");
const { resolve, extname } = require("node:path");
const assert = require("node:assert/strict");
require("tsx/cjs");
const { seedTree, mergeTree } = require("../../worker/tree.ts");
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
    const old = {
      ...fixtures.section,
      requirementIds: ["R001"],
      openQuestions: ["주인공의 본명은?"],
      conflicts: [],
    };
    let p = {
      id: "tree-ui",
      title: "연결된 기획 검증",
      genre: "판타지",
      status: "BIBLE_REVIEW",
      revision: 1,
      canonVersion: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      requirements: [{ id: "R001", text: "원문 요구를 보존한다." }],
      answers: {},
      analysis: fixtures.analysis,
      bible: { characters: old },
      brief: {
        text: "원문 요구",
        encoding: "utf-8",
        file: { sha256: "fixture" },
      },
      plot: null,
      styleBinding: null,
    };
    let pending,
      preflights = 0,
      generations = 0,
      applies = 0,
      nameSuggestions = 0,
      developments = 0,
      developmentChecks = 0,
      plotProposal,
      synopsisProposal;
    const synopsisBatches = [];
    const clean = (n) =>
      Object.fromEntries(
        [
          "id",
          "parentId",
          "kind",
          "title",
          "content",
          "entityIds",
          "requirementIds",
          "dependsOn",
        ].map((k) => [k, n[k]]),
      );
    await page.route("**/api/**", async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      let data;
      if (path === "/api/me")
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
      else if (path === "/api/projects") data = [p];
      else if (path === "/api/styles") data = [];
      else if (path === "/api/projects/tree-ui") data = p;
      else if (path.endsWith("/tree")) data = seedTree(p);
      else if (path.endsWith("/synopsis"))
        data = {
          batches: synopsisBatches,
          currentEpisode: p.currentEpisode ?? 1,
          targetChars: p.targetChars ?? 5000,
          nextStart: synopsisBatches.at(-1)?.end + 1 || 1,
          canExtend:
            !synopsisBatches.length ||
            (p.completedEpisodes ?? []).includes(synopsisBatches.at(-1).end),
        };
      else if (path.endsWith("/writing-settings")) {
        p = {
          ...p,
          revision: p.revision + 1,
          targetChars: request.postDataJSON().targetChars,
          defaultTargetChars: request.postDataJSON().targetChars,
        };
        data = p;
      } else if (path.endsWith("/synopsis/generate")) {
        if (request.headers()["x-nf-preflight"] === "1")
          data = {
            estimateOnly: true,
            model: "test/model",
            estimatedMaxUsd: 0.1,
            suggestedMaxCostUsd: 0.1,
            remainingMonthlyUsd: 5,
            maxOutputTokens: 8192,
          };
        else {
          const start = synopsisBatches.at(-1)?.end + 1 || 1;
          synopsisProposal = {
            id: "synopsis-" + start,
            inputRevision: p.revision,
            start,
            end: start + 9,
            result: {
              summary:
                "열 회차의 사건과 인물 변화를 유기적으로 연결한 시놉시스입니다.",
              episodes: Array.from({ length: 10 }, (_, i) => ({
                number: start + i,
                title: `${start + i}화 기록의 약속`,
                synopsis:
                  "인물이 잃어버린 기록을 되찾기 위해 약속을 선택하고, 그 선택의 결과를 통해 새로운 사건의 단서를 발견한다.",
                characterChange: "동료와 작은 신뢰를 쌓는다.",
                endingHook: "기록의 마지막 줄이 다음 사건을 연다.",
              })),
            },
          };
          data = synopsisProposal;
        }
      } else if (path.endsWith("/synopsis/apply")) {
        synopsisBatches.push({ ...synopsisProposal, status: "APPLIED" });
        const number = synopsisProposal.start;
        p = {
          ...p,
          revision: p.revision + 1,
          seriesEnabled: true,
          currentEpisode: number,
          episodeSynopsis: synopsisProposal.result.episodes[0],
          synopsisThrough: synopsisProposal.end,
          plot: number > 1 ? null : p.plot,
        };
        data = p;
      } else if (path.endsWith("/episodes/select")) {
        const number = request.postDataJSON().number;
        p = {
          ...p,
          revision: p.revision + 1,
          currentEpisode: number,
          episodeSynopsis: synopsisBatches
            .flatMap((b) => b.result.episodes)
            .find((e) => e.number === number),
          plot: null,
        };
        data = p;
      } else if (
        path.endsWith("/plot/generate") ||
        path.endsWith("/plot/develop") ||
        path.endsWith("/plot/develop/check")
      ) {
        if (request.headers()["x-nf-preflight"] === "1")
          data = {
            estimateOnly: true,
            model: "test/model",
            estimatedMaxUsd: 0.1,
            suggestedMaxCostUsd: 0.1,
            remainingMonthlyUsd: 5,
            maxOutputTokens: 8192,
          };
        else if (path.endsWith("/check")) {
          developmentChecks++;
          data = {
            id: "plot-check",
            inputRevision: p.revision,
            result: {
              summary:
                "장면 사이에 시간이 어떻게 흘렀는지 모호한 부분을 찾았습니다.",
              gaps: [
                {
                  id: "gap-time",
                  title: "시간 전환",
                  detail:
                    "첫 장면과 다음 장면 사이의 시간 경과를 구체화해야 합니다.",
                  scope: "current",
                },
              ],
            },
          };
        } else if (path.endsWith("/generate")) {
          p = {
            ...p,
            revision: p.revision + 1,
            plot: {
              ...structuredClone(fixtures.plot),
              status: "REVIEW",
              version: 1,
              risks: ["행동 동기가 부족하다."],
              openQuestions: ["후반 결말은?"],
            },
          };
          data = p;
        } else {
          developments++;
          assert.equal(request.postDataJSON().auditId, "plot-check");
          const preview = {
            ...structuredClone(fixtures.plot),
            continuationNotes: ["후반 결말은 이후 아크에서 결정한다."],
          };
          preview.scenes[0].action = "기록을 돌려주기 위한 약속을 선택한다.";
          plotProposal = {
            id: "development-preview",
            inputRevision: p.revision,
            result: {
              summary:
                "첫 회차의 동기를 구체화하고 장기 결말을 이후 메모로 남깁니다.",
              decisions: [
                {
                  issueId: "risk-0",
                  disposition: "resolved",
                  resolution:
                    "기록을 돌려주려는 행동 동기를 첫 장면에 반영했습니다.",
                },
                {
                  issueId: "question-0",
                  disposition: "later",
                  resolution:
                    "후반 결말은 지금 집필에 필요하지 않아 이후 아크에서 결정합니다.",
                },
                {
                  issueId: "gap-time",
                  disposition: "resolved",
                  resolution:
                    "같은 날 오후의 사건으로 시간을 정해 장면 사이를 연결합니다.",
                },
              ],
            },
            preview,
          };
          data = plotProposal;
        }
      } else if (path.endsWith("/plot/develop/apply")) {
        p = {
          ...p,
          revision: p.revision + 1,
          plot: { ...plotProposal.preview, status: "REVIEW", version: 2 },
        };
        data = p;
      } else if (path.endsWith("/suggest-name")) {
        if (request.headers()["x-nf-preflight"] === "1")
          data = {
            estimateOnly: true,
            model: "test/model",
            estimatedMaxUsd: 0.01,
            suggestedMaxCostUsd: 0.01,
            remainingMonthlyUsd: 5,
            maxOutputTokens: 1024,
          };
        else {
          nameSuggestions++;
          assert.equal(request.postDataJSON().consent, true);
          assert.equal(request.postDataJSON().maxCostUsd, 0.01);
          data = {
            name: "윤서진",
            reason: "기록관의 배경과 주인공의 성격에 어울리는 이름입니다.",
            projectRevision: p.revision,
          };
        }
      } else if (
        path.endsWith("/tree/foundation") ||
        path.endsWith("/expand")
      ) {
        if (request.headers()["x-nf-preflight"] === "1") {
          preflights++;
          data = {
            estimateOnly: true,
            model: "test/model",
            estimatedMaxUsd: 0.32,
            suggestedMaxCostUsd: 0.32,
            remainingMonthlyUsd: 5,
            maxOutputTokens: 16000,
          };
        } else {
          const body = request.postDataJSON();
          assert.equal(body.maxCostUsd, 0.32);
          generations++;
          const foundation = path.endsWith("/foundation"),
            tree = seedTree(p),
            nid = foundation ? "root" : path.split("/").at(-2);
          const patch = foundation
            ? {
                summary:
                  "세계의 제약이 인물의 목표와 중심 사건에 연결되는 공통 기획입니다.",
                nodes: tree.nodes
                  .filter((n) => !n.id.startsWith("module-"))
                  .map((n) => ({
                    ...clean(n),
                    content:
                      n.content +
                      " {{entity:person_main}}는 세계의 규칙을 이해하고 자신의 약속을 지킨다.",
                    entityIds: ["person_main"],
                    requirementIds: ["R001"],
                    dependsOn: n.id === "story" ? ["characters", "world"] : [],
                  })),
                entities: [
                  {
                    id: "person_main",
                    kind: "person",
                    name: "서도윤",
                    role: "주인공",
                    aliases: [],
                    description:
                      "도시의 기록관에서 잊힌 약속을 조사하던 인물이다.",
                    nodeIds: ["characters", "story"],
                  },
                ],
                issues: [],
              }
            : {
                summary:
                  "인물의 이전 삶을 하위 가지로 확장하고 스토리와 연결했습니다.",
                nodes: [
                  {
                    ...clean(tree.nodes.find((n) => n.id === nid)),
                    content:
                      "{{entity:person_main}}는 기록관의 지식을 바탕으로 금지된 기록을 조사한다.",
                  },
                  {
                    id: "past-life",
                    parentId: nid,
                    kind: "detail",
                    title: "빙의 전 삶",
                    content:
                      "{{entity:person_main}}는 도시 기록관에서 잊힌 약속을 추적했다.",
                    entityIds: ["person_main"],
                    requirementIds: ["R001"],
                    dependsOn: ["world"],
                  },
                ],
                entities: [],
                issues: [],
              };
          pending = {
            id: "tree-proposal-" + generations,
            nodeId: nid,
            foundation,
            inputRevision: p.revision,
            patch,
            preview: mergeTree(tree, patch, p.requirements, nid, foundation),
          };
          data = pending;
        }
      } else if (path.endsWith("/tree/apply")) {
        applies++;
        p = { ...p, revision: p.revision + 1, planningTree: pending.preview };
        data = p;
      } else if (path.endsWith("/tree/approve")) {
        assert.equal(request.postDataJSON().confirmed, true);
        p = {
          ...p,
          revision: p.revision + 1,
          status: "ACTIVE",
          planningMode: "tree",
        };
        data = p;
      } else if (path.endsWith("/tree/entities/person_main")) {
        const tree = seedTree(p);
        tree.entities[0].name = request.postDataJSON().name;
        p = { ...p, revision: p.revision + 1, planningTree: tree };
        data = p;
      } else if (path.endsWith("/tree/history")) data = [];
      else throw Error("unexpected route " + path);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    });
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page
      .getByRole("heading", { name: "이야기를 이어갈 시간이에요." })
      .waitFor();
    await page
      .getByRole("button", { name: /연결된 기획 검증/ })
      .first()
      .click();
    await page.getByRole("button", { name: /STEP 02/ }).click();
    await page
      .getByRole("heading", { name: "하나의 작품, 연결된 설계" })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "모듈 생성", exact: true })
        .count(),
      0,
    );
    await page.getByRole("button", { name: "큰 틀 잡기", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "전송 범위와 실행 한도를 확인했습니다." })
      .check();
    assert.equal(preflights, 1);
    assert.equal(generations, 0);
    assert.equal(
      await page
        .getByRole("spinbutton", {
          name: "이번 작업 비용 상한 · 자동 계산 (USD)",
        })
        .inputValue(),
      "0.32",
    );
    await page
      .getByRole("button", { name: "확인하고 실행", exact: true })
      .click();
    const modal = page.getByRole("dialog", { name: "연결된 기획 제안" });
    await modal.waitFor();
    assert.equal(applies, 0);
    await modal
      .getByRole("button", { name: "기획에 반영", exact: true })
      .click();
    await modal.waitFor({ state: "hidden" });
    assert.equal(applies, 1);
    assert.equal(p.bible.characters.content, old.content);
    await page.getByRole("button", { name: "바꾸기", exact: true }).click();
    const renameModal = page.getByRole("dialog", {
      name: "이름 바꾸기",
      exact: true,
    });
    await renameModal
      .getByRole("button", { name: "새 이름 자동 제안", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "전송 범위와 실행 한도를 확인했습니다." })
      .check();
    assert.equal(nameSuggestions, 0);
    await page
      .getByRole("button", { name: "확인하고 실행", exact: true })
      .click();
    await renameModal
      .getByText("기록관의 배경과 주인공의 성격에 어울리는 이름입니다.")
      .waitFor();
    assert.equal(nameSuggestions, 1);
    assert.equal(p.planningTree.entities[0].name, "서도윤");
    assert.equal(
      await renameModal
        .getByRole("textbox", { name: "바꿀 새 이름" })
        .inputValue(),
      "윤서진",
    );
    await renameModal
      .getByRole("button", { name: "이 이름으로 바꾸기", exact: true })
      .click();
    await renameModal.waitFor({ state: "hidden" });
    await page
      .getByRole("textbox", { name: "윤서진 이름", exact: true })
      .waitFor();
    assert(
      (await page.locator(".planning-node-text").innerText()).includes(
        "윤서진",
      ),
    );
    assert(
      !(await page.locator(".planning-node-text").innerText()).includes(
        "서도윤",
      ),
    );
    await page
      .getByRole("navigation", { name: "작품 기획 트리" })
      .getByRole("button", { name: "인물", exact: true })
      .click();
    await page
      .getByRole("button", { name: "이 가지 구체화", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "전송 범위와 실행 한도를 확인했습니다." })
      .check();
    await page
      .getByRole("button", { name: "확인하고 실행", exact: true })
      .click();
    await modal.waitFor();
    await modal
      .getByRole("button", { name: "기획에 반영", exact: true })
      .click();
    await modal.waitFor({ state: "hidden" });
    await page
      .locator(".planning-child-grid")
      .getByRole("button", { name: /빙의 전 삶/ })
      .waitFor();
    assert.equal(generations, 2);
    assert.equal(applies, 2);
    assert.equal(
      await page
        .getByRole("button", { name: "상세 모듈 보기", exact: true })
        .count(),
      0,
    );
    const nextStep = page.getByRole("button", {
      name: "이 기획으로 다음 단계",
      exact: true,
    });
    assert(await nextStep.isDisabled());
    await page
      .getByRole("checkbox", {
        name: "현재 기획을 확인했으며, 남은 미정은 진행하면서 구체화하겠습니다.",
      })
      .check();
    await nextStep.click();
    await page
      .getByRole("button", { name: "첫 회차 설계", exact: true })
      .waitFor();
    assert(
      await page
        .getByRole("button", { name: "첫 회차 설계", exact: true })
        .isDisabled(),
    );
    await page
      .getByRole("spinbutton", { name: "원고 목표 글자 수" })
      .fill("6000");
    await page.getByRole("button", { name: "분량 저장", exact: true }).click();
    await page
      .getByRole("button", { name: "1~10화 시놉시스 설계", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "전송 범위와 실행 한도를 확인했습니다." })
      .check();
    await page
      .getByRole("button", { name: "확인하고 실행", exact: true })
      .click();
    const synopsisModal = page.getByRole("dialog", {
      name: "1~10화 시놉시스 제안",
      exact: true,
    });
    await synopsisModal.waitFor();
    assert.equal(synopsisBatches.length, 0);
    await synopsisModal
      .getByRole("button", { name: "이 구간 기록", exact: true })
      .click();
    await synopsisModal.waitFor({ state: "hidden" });
    assert.equal(synopsisBatches[0].result.episodes.length, 10);
    assert.equal(p.targetChars, 6000);
    assert.equal(p.planningTree.issues[0].status, "open");
    await page
      .getByRole("button", { name: "첫 회차 설계", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "전송 범위와 실행 한도를 확인했습니다." })
      .check();
    await page
      .getByRole("button", { name: "확인하고 실행", exact: true })
      .click();
    await page.getByRole("button", { name: "자동 전개", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "전송 범위와 실행 한도를 확인했습니다." })
      .check();
    assert.equal(developments, 0);
    await page
      .getByRole("button", { name: "확인하고 실행", exact: true })
      .click();
    await page.getByText(/^자동 전개 2\/2:/).waitFor();
    assert.equal(developmentChecks, 1);
    assert.equal(developments, 0);
    await page
      .getByRole("checkbox", { name: "전송 범위와 실행 한도를 확인했습니다." })
      .check();
    await page
      .getByRole("button", { name: "확인하고 실행", exact: true })
      .click();
    const developmentModal = page.getByRole("dialog", {
      name: "자동 전개 제안",
      exact: true,
    });
    await developmentModal.waitFor();
    assert.equal(developments, 1);
    assert.equal(p.plot.risks.length, 1);
    await developmentModal
      .getByRole("button", { name: "이 전개 반영", exact: true })
      .click();
    await developmentModal.waitFor({ state: "hidden" });
    await page
      .getByText("후반 결말은 이후 아크에서 결정한다.", { exact: true })
      .waitFor();
    const approvePlot = page.getByRole("button", {
      name: "플롯 승인 · 집필실로",
      exact: true,
    });
    assert(await approvePlot.isDisabled());
    await page
      .getByRole("checkbox", {
        name: "인과·관계 진전·미정과 위험을 검수하고 현재 플롯을 승인합니다.",
      })
      .check();
    assert(await approvePlot.isEnabled());
    assert.equal(p.plot.openQuestions.length, 0);
    p.completedEpisodes = Array.from({ length: 10 }, (_, i) => i + 1);
    await page
      .getByRole("combobox", { name: "집필할 회차" })
      .selectOption("10");
    const nextBatchModal = page.getByRole("dialog", {
      name: "다음 10화 시놉시스",
      exact: true,
    });
    await nextBatchModal
      .getByRole("heading", {
        name: "11화부터 20화까지 시놉시스를 만들까요?",
        exact: true,
      })
      .waitFor();
    await nextBatchModal
      .getByRole("button", { name: "만들기", exact: true })
      .click();
    await page
      .getByRole("checkbox", { name: "전송 범위와 실행 한도를 확인했습니다." })
      .check();
    await page
      .getByRole("button", { name: "확인하고 실행", exact: true })
      .click();
    const secondBatchModal = page.getByRole("dialog", {
      name: "11~20화 시놉시스 제안",
      exact: true,
    });
    await secondBatchModal
      .getByRole("button", { name: "이 구간 기록", exact: true })
      .click();
    await secondBatchModal.waitFor({ state: "hidden" });
    assert.equal(p.currentEpisode, 11);
    assert.equal(synopsisBatches.length, 2);
    await page
      .getByRole("button", { name: "11화 장면 설계", exact: true })
      .waitFor();
    await page.getByRole("button", { name: /STEP 02/ }).click();
    await page
      .getByRole("button", { name: "스토리 설계로 이동", exact: true })
      .waitFor();
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
      "PASS: shared foundation, tree branch expansion, canonical rename, paid-call preflight, preserved legacy modules and 320–1440px layouts. API/auth/model fixtures only.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
