const { chromium } = require("@playwright/test");
const { createServer } = require("node:http");
const { readFileSync, existsSync } = require("node:fs");
const { resolve, extname } = require("node:path");
const assert = require("node:assert/strict");
const fixtures = require("./fixtures.json");
(async () => {
  const server = createServer((req, res) => {
    let path = resolve(
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
        viewport: { width: 1440, height: 1000 },
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
    const original = {
      ...fixtures.section,
      openQuestions: ["주인공의 본명은?"],
      conflicts: ["시간 순서가 맞는가?"],
    };
    let p = {
      id: "planning-ui",
      title: "자동 기획 UI 검증",
      genre: "판타지",
      status: "BIBLE_REVIEW",
      revision: 1,
      canonVersion: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      requirements: [{ id: "R001", text: "원문 요구" }],
      answers: {},
      analysis: fixtures.analysis,
      bible: { concept: original },
      brief: {
        text: "원문 요구",
        file: {
          sha256: "fixture",
          byteLength: 20,
          path: "users/test/brief.txt",
        },
        textHash: "fixture",
        encoding: "utf-8",
      },
      plot: null,
      styleBinding: null,
    };
    const revised = {
      ...original,
      content: original.content + " 서도윤은 도시 기록관 출신이다.",
      openQuestions: [],
      conflicts: [],
    };
    let submitted,
      applies = 0,
      preflights = 0,
      generations = 0;
    const proposal = {
      id: "proposal-ui",
      inputRevision: 1,
      sectionKey: "concept",
      inputSection: original,
      summary: "주인공 이름과 배경을 구체적으로 기획했습니다.",
      decisions: [
        {
          issue: "주인공의 본명은?",
          resolution: "주인공은 서도윤, 빙의 전에는 도시 기록관에서 일했다.",
          affectedSections: ["concept", "characters"],
        },
      ],
      characterNames: [
        {
          role: "주인공",
          name: "서도윤",
          background: "도시 기록관에서 오래된 문서를 정리했다.",
        },
      ],
      sections: [
        { key: "concept", section: revised },
        { key: "characters", section: revised },
      ],
      unresolved: [],
    };
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
      else if (path.endsWith("/auto-plan")) {
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
          generations++;
          submitted = request.postDataJSON();
          data = proposal;
        }
      } else if (path.endsWith("/planning/apply")) {
        applies++;
        p = {
          ...p,
          revision: 2,
          bible: { concept: revised, characters: revised },
        };
        data = p;
      } else if (path === "/api/projects/planning-ui") data = p;
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
      .getByRole("button", { name: /자동 기획 UI 검증/ })
      .first()
      .click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /STEP 02/ }).click();
    await page.waitForTimeout(500);
    await page
      .getByLabel("상세 기획", { exact: false })
      .fill(original.content + " 저장 전 문장도 함께 보낸다.");
    await page
      .getByRole("button", {
        name: "미정 · 사용자 선택 필요 자동 기획",
        exact: true,
      })
      .click();
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
    const modal = page.getByRole("dialog", { name: "자동 기획 제안" });
    await modal.waitFor();
    assert.equal(submitted.focus, "openQuestions");
    assert.equal(submitted.maxCostUsd, 0.32);
    assert.equal(generations, 1);
    assert(submitted.section.content.includes("저장 전 문장"));
    assert.equal(applies, 0);
    await modal
      .getByRole("heading", { name: "등장인물 이름 · 배경" })
      .waitFor();
    await modal
      .getByRole("button", { name: "이 기획 적용", exact: true })
      .click();
    await modal.waitFor({ state: "hidden" });
    assert.equal(applies, 1);
    assert(
      (
        await page.getByLabel("상세 기획", { exact: false }).inputValue()
      ).includes("서도윤"),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: adjacent automatic planning button sends unsaved edits, previews names and patches, applies only on click, and fits mobile. API/auth are test fixtures.",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
