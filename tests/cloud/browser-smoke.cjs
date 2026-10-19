const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");
(async () => {
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
    await page.goto("http://127.0.0.1:8787");
    await page.getByRole("button", { name: /Google.*시작/ }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: /개발 로그인/ }).count(),
      0,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    let oauth;
    await page.route(
      "https://wqzavlosvhljstkxwhle.supabase.co/auth/v1/authorize**",
      async (route) => {
        oauth = new URL(route.request().url());
        await route.fulfill({
          contentType: "text/html",
          body: "OAuth redirect captured by local smoke test",
        });
      },
    );
    await page.getByRole("button", { name: /Google.*시작/ }).click();
    await page.waitForURL("**/auth/v1/authorize**");
    assert.equal(oauth.searchParams.get("provider"), "google");
    assert.equal(oauth.searchParams.get("code_challenge_method"), "s256");
    assert.equal(
      oauth.searchParams.get("redirect_to"),
      "http://127.0.0.1:8787/",
    );
    assert.equal(errors.length, 0);
    const health = await (
      await page.request.get("http://127.0.0.1:8787/api/health")
    ).json();
    assert.equal(health.mode, "supabase");
    assert.equal(health.configured, false);
    assert.equal(
      (await page.request.get("http://127.0.0.1:8787/api/me")).status(),
      401,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("http://127.0.0.1:8787");
    await page.getByRole("button", { name: /Google.*시작/ }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    console.log(
      "PASS: Cloudflare workerd serves static UI, mobile layout, PKCE Google redirect and authenticated API gate. Real Google login not exercised.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
