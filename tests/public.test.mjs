import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import sharp from "sharp";
import { createApp } from "../server/app.mjs";

async function start(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stock-public-"));
  const { app } = createApp({
    dataDir,
    publicMode: true,
    publicHost: "stock-studio.onrender.com",
    sessionSecret: "test-only-secret-not-for-deployment-123456789",
  });
  const http = app.listen(0, "127.0.0.1");
  await once(http, "listening");
  t.after(async () => {
    await new Promise((r) => http.close(r));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${http.address().port}`;
  const client = () => {
    let cookie = "";
    return {
      get cookie() {
        return cookie;
      },
      async request(
        route,
        body,
        method = body ? "POST" : "GET",
        extraHeaders = {},
      ) {
        const r = await fetch(url + route, {
          method,
          headers: {
            "X-Stock-Studio": "1",
            Cookie: cookie,
            ...(body instanceof FormData
              ? {}
              : { "Content-Type": "application/json" }),
            ...extraHeaders,
          },
          body:
            body instanceof FormData
              ? body
              : body
                ? JSON.stringify(body)
                : undefined,
        });
        if (r.headers.get("set-cookie"))
          cookie = r.headers.get("set-cookie").split(";")[0];
        return r;
      },
    };
  };
  return { client, url, dataDir };
}

test("public server refuses startup without a signing secret", () => {
  assert.throws(
    () =>
      createApp({
        publicMode: true,
        publicHost: "example.onrender.com",
        sessionSecret: "short",
      }),
    /SESSION_SECRET/,
  );
});
test("anonymous workspaces isolate images, downloads, settings and metadata", async (t) => {
  const { client, dataDir } = await start(t);
  const a = client(),
    b = client();
  const settings = await a.request("/api/settings");
  assert.match(settings.headers.get("set-cookie"), /HttpOnly/);
  assert.match(settings.headers.get("set-cookie"), /Secure/);
  assert.match(settings.headers.get("set-cookie"), /SameSite=Lax/);
  assert.equal((await settings.json()).publicMode, true);
  await a.request(
    "/api/settings",
    { geminiKey: "private-a-key", provider: "gemini" },
    "PUT",
  );
  const other = await (await b.request("/api/settings")).json();
  assert.equal(other.geminiKeySet, false);
  const form = new FormData();
  const png = await sharp({
    create: { width: 30, height: 30, channels: 4, background: "#80aa00" },
  })
    .png()
    .toBuffer();
  form.append("images", new Blob([png]), "public.png");
  const result = await a.request("/api/assets", form);
  assert.equal(result.status, 201);
  const image = (await result.json()).assets[0];
  assert.equal((await (await a.request("/api/assets")).json()).length, 1);
  assert.equal((await (await b.request("/api/assets")).json()).length, 0);
  assert.equal((await b.request(`/api/assets/${image.id}/file`)).status, 404);
  assert.equal(
    (await b.request(`/api/assets/${image.id}`, { isAi: false }, "PATCH"))
      .status,
    404,
  );
  assert.equal((await a.request(`/api/assets/${image.id}/file`)).status, 200);
  const folders = fs.readdirSync(path.join(dataDir, "sessions"));
  const settingsFile = folders
    .map((f) => path.join(dataDir, "sessions", f, "settings.json"))
    .find((f) => fs.existsSync(f));
  const onDisk = fs.readFileSync(settingsFile, "utf8");
  assert.ok(!onDisk.includes("private-a-key"));
  assert.ok(JSON.parse(onDisk).encrypted);
  assert.equal(
    (await (await a.request("/api/settings")).json()).geminiKeySet,
    true,
  );
});
test("forged cookie creates a separate workspace and cross-site writes fail", async (t) => {
  const { client, url } = await start(t);
  const a = client();
  await a.request("/api/settings", { geminiKey: "private-key" }, "PUT");
  const forged = a.cookie.replace(/.$/, a.cookie.endsWith("0") ? "1" : "0");
  const r = await fetch(url + "/api/settings", { headers: { Cookie: forged } });
  assert.equal((await r.json()).geminiKeySet, false);
  assert.equal(
    (
      await a.request("/api/settings", {}, "PUT", {
        Origin: "https://other.example",
      })
    ).status,
    403,
  );
  const health = await fetch(url + "/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("set-cookie"), null);
});
test("public visitors cannot consume the operator's environment API keys", async (t) => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "operator-key-never-for-visitors";
  t.after(() => {
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  });
  const { client } = await start(t);
  const a = client();
  assert.equal(
    (await (await a.request("/api/settings")).json()).geminiKeySet,
    false,
  );
  const form = new FormData();
  form.append(
    "images",
    new Blob([
      await sharp({
        create: { width: 20, height: 20, channels: 3, background: "white" },
      })
        .png()
        .toBuffer(),
    ]),
    "image.png",
  );
  const image = (await (await a.request("/api/assets", form)).json()).assets[0];
  const r = await a.request(`/api/assets/${image.id}/generate`, {});
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /키를 입력/);
});
