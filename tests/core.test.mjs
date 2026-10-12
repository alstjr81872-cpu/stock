import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import ExcelJS from "exceljs";
import { once } from "node:events";
import { createApp } from "../server/app.mjs";
import {
  csv,
  embedIptc,
  exportRows,
  prepareMetadata,
  spreadsheet,
} from "../server/metadata.mjs";
import {
  generateMetadata,
  restoreAlpha,
  downloadUpscale,
  startUpscale,
} from "../server/providers.mjs";
import { validateMetadata } from "../src/platforms.js";
import { localReady } from "../server/local-upscale.mjs";

const metadata = {
  adobe: {
    title: "Green leaf icon isolated on transparent background",
    keywords: ["leaf", "green", "nature", "icon", "botanical"],
    category: 14,
  },
  freepik: {
    title: "Green leaf icon",
    keywords: ["leaf", "green", "nature", "icon", "botanical", "_ai_generated"],
    prompt: "",
    model: "",
  },
  miricanvas: {
    title: "초록색 나뭇잎 아이콘",
    keywords: ["나뭇잎", "초록", "자연", "아이콘", "식물"],
    contentType: "PNG element",
    tier: "Premium",
  },
};
const seed = {
  id: "test",
  originalName: "원본.png",
  exportName: "stock_test.png",
  width: 64,
  height: 64,
  hasAlpha: true,
  isAi: true,
  metadata,
};
async function fixture() {
  return sharp(
    Buffer.from(
      '<svg width="64" height="64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="23" fill="#7ba541"/><path d="M20 45L45 20" stroke="#364d20" stroke-width="3"/></svg>',
    ),
  )
    .png()
    .toBuffer();
}
async function server(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stock-test-"));
  const { app, store } = createApp({ dataDir: root, ...options });
  const http = app.listen(0, "127.0.0.1");
  await once(http, "listening");
  t.after(async () => {
    await new Promise((resolve) => http.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${http.address().port}`;
  async function request(route, body, method = "POST") {
    return fetch(url + route, {
      method: body === undefined && method === "POST" ? "GET" : method,
      headers: {
        "X-Stock-Studio": "1",
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
    });
  }
  async function upload() {
    const form = new FormData();
    form.append(
      "images",
      new Blob([await fixture()], { type: "image/png" }),
      "leaf.png",
    );
    const r = await request("/api/assets", form);
    assert.equal(r.status, 201);
    return (await r.json()).assets[0];
  }
  return { url, request, upload, store };
}

test("platform formats preserve exact filenames and different delimiters", () => {
  const adobe = exportRows("adobe", [seed]);
  assert.deepEqual(adobe[0], [
    "Filename",
    "Title",
    "Keywords",
    "Category",
    "Releases",
  ]);
  assert.equal(adobe[1][0], "stock_test.png");
  assert.match(csv(adobe), /"leaf,green,nature,icon,botanical"/);
  const freepik = csv(exportRows("freepik", [seed]), ";");
  assert.match(freepik, /^File name;Title;Keywords;Prompt;Model\r\n/);
  assert.match(
    freepik,
    /stock_test.jpg;Green leaf icon;leaf,green,nature,icon,botanical,_ai_generated;;/,
  );
  const miri = exportRows("miricanvas", [seed]);
  assert.equal(miri[1][0], "stock_test");
  assert.equal(miri[1][1], "");
});
test("MiriCanvas XLSX round-trips Korean and exact columns", async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await spreadsheet("miricanvas", [seed]));
  assert.deepEqual(workbook.worksheets[0].getRow(1).values.slice(1), [
    "fileName",
    "uniqueId",
    "elementName",
    "keywords",
    "tier",
    "contentType",
  ]);
  assert.equal(
    workbook.worksheets[0].getCell("C2").value,
    metadata.miricanvas.title,
  );
});
test("CSV formula escaping and quoting handle untrusted text", () => {
  assert.equal(
    csv([["=1+2", 'a"b', "first\nsecond", "x,y"]]),
    `'\u003d1+2,"a""b","first\nsecond","x,y"\r\n`,
  );
});
test("validators block incompatible PNG elements and missing AI label", () => {
  assert.match(
    validateMetadata("miricanvas", metadata.miricanvas, {
      ...seed,
      hasAlpha: false,
    }).errors.join(),
    /투명/,
  );
  assert.match(
    validateMetadata(
      "freepik",
      {
        ...metadata.freepik,
        keywords: ["leaf", "green", "icon", "art", "nature"],
      },
      seed,
    ).errors.join(),
    /_ai_generated/,
  );
  assert.equal(
    prepareMetadata(metadata, false).freepik.keywords.includes("_ai_generated"),
    false,
  );
  const many = structuredClone(metadata);
  many.freepik.keywords = Array.from({ length: 50 }, (_, i) => `tag${i}`);
  const normalized = prepareMetadata(many, true);
  assert.equal(normalized.freepik.keywords.length, 50);
  assert.equal(normalized.freepik.keywords.at(-1), "_ai_generated");
});
test("JPEG IPTC contains correct Photoshop block and UTF8 fields, remains decodable", async () => {
  const jpeg = await sharp(await fixture())
    .flatten({ background: "white" })
    .jpeg()
    .toBuffer();
  const encoded = embedIptc(jpeg, metadata.freepik);
  const decoded = await sharp(encoded).metadata();
  assert.equal(decoded.width, 64);
  assert.ok(decoded.iptc);
  assert.ok(decoded.iptc.includes(Buffer.from("_ai_generated")));
  assert.ok(decoded.iptc.includes(Buffer.from("Green leaf icon")));
});
test("both image providers receive image bytes and return validated platform metadata", async (t) => {
  const filename = path.join(os.tmpdir(), `stock-provider-${Date.now()}.png`);
  fs.writeFileSync(filename, await fixture());
  t.after(() => fs.rmSync(filename));
  for (const provider of ["openai", "gemini"]) {
    const result = await generateMetadata(
      filename,
      seed,
      { provider, openaiKey: "test-only", geminiKey: "test-only", geminiModel: "gemini-2.5-flash" },
      async (url, options) => {
        const body = JSON.parse(options.body);
        if (provider === "openai") {
          assert.equal(url, "https://api.openai.com/v1/chat/completions");
          assert.match(
            body.messages[1].content[1].image_url.url,
            /^data:image\/jpeg;base64,/,
          );
        } else {
          assert.match(url, /generativelanguage.googleapis.com/);
          assert.equal(
            body.contents[0].parts[1].inlineData.mimeType,
            "image/jpeg",
          );
          assert.ok(body.contents[0].parts[1].inlineData.data.length > 100);
        }
        return Response.json(
          provider === "openai"
            ? { choices: [{ message: { content: JSON.stringify(metadata) } }] }
            : {
                candidates: [
                  { content: { parts: [{ text: JSON.stringify(metadata) }] } },
                ],
              },
        );
      },
    );
    assert.equal(result.miricanvas.title, metadata.miricanvas.title);
  }
});
test("API errors do not leak provider body or credentials", async (t) => {
  const filename = path.join(
    os.tmpdir(),
    `stock-provider-error-${Date.now()}.png`,
  );
  fs.writeFileSync(filename, await fixture());
  t.after(() => fs.rmSync(filename));
  await assert.rejects(
    generateMetadata(
      filename,
      seed,
      { provider: "openai", openaiKey: "super-secret" },
      async () => new Response("super-secret", { status: 401 }),
    ),
    (error) =>
      error.message.includes("HTTP 401") &&
      !error.message.includes("super-secret"),
  );
});
test("Replicate request resolves a model version and requests real inference", async (t) => {
  const filename = path.join(os.tmpdir(), `stock-upscale-${Date.now()}.png`);
  fs.writeFileSync(filename, await fixture());
  t.after(() => fs.rmSync(filename));
  let calls = 0;
  const result = await startUpscale(
    filename,
    4,
    { replicateKey: "test-token" },
    async (url, options) => {
      calls++;
      if (url.endsWith("/models/nightmareai/real-esrgan"))
        return Response.json({
          latest_version: {
            id: "version-1",
            openapi_schema: {
              components: { schemas: { Input: { properties: { image: {} } } } },
            },
          },
        });
      const body = JSON.parse(options.body);
      assert.equal(body.version, "version-1");
      assert.equal(body.input.scale, 4);
      assert.equal(body.input.face_enhance, false);
      assert.match(body.input.image, /^data:image\/png;base64,/);
      return Response.json({ id: "prediction-1", status: "starting" });
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.id, "prediction-1");
});
test("upscale download rejects untrusted URL and preserves source alpha", async () => {
  await assert.rejects(downloadUpscale("http://127.0.0.1/private"), /주소/);
  const original = await fixture();
  const rgb = await sharp(original)
    .flatten({ background: "white" })
    .resize(128, 128)
    .png()
    .toBuffer();
  const output = await restoreAlpha(rgb, original, 128, 128, true);
  const stats = await sharp(output).stats();
  assert.equal(stats.channels.length, 4);
  assert.equal(stats.channels[3].min, 0);
  assert.equal(stats.channels[3].max, 255);
  await assert.rejects(restoreAlpha(rgb, original, 256, 256, true), /크기/);
});
test("HTTP upload, edit, export, original retention, delete and persistent settings", async (t) => {
  const { request, upload, store } = await server(t);
  const a = await upload();
  assert.equal(a.hasAlpha, true);
  assert.equal(a.width, 64);
  const put = await request(
    "/api/settings",
    { geminiKey: "secret-test-key", provider: "gemini" },
    "PUT",
  );
  const publicSettings = await put.json();
  assert.equal(publicSettings.geminiKeySet, true);
  assert.equal(publicSettings.geminiKey, undefined);
  assert.equal(
    fs.statSync(path.join(store.root, "settings.json")).mode & 0o777,
    0o600,
  );
  assert.equal(
    (await request(`/api/assets/${a.id}`, { metadata }, "PATCH")).status,
    200,
  );
  const xlsx = await request("/api/export", {
    site: "miricanvas",
    ids: [a.id],
  });
  assert.equal(xlsx.status, 200);
  assert.equal(
    Buffer.from(await xlsx.arrayBuffer())
      .subarray(0, 2)
      .toString(),
    "PK",
  );
  const original = await request(`/api/assets/${a.id}/file?download=source`);
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), await fixture());
  assert.equal(
    (await request(`/api/assets/${a.id}`, undefined, "DELETE")).status,
    200,
  );
  assert.deepEqual(await (await request("/api/assets")).json(), []);
});
test("mutations reject cross-origin requests and exports block missing metadata", async (t) => {
  const { url, request, upload } = await server(t);
  assert.equal(
    (
      await fetch(url + "/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(url + "/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Stock-Studio": "1",
          Origin: "https://evil.example",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  const a = await upload();
  assert.equal(
    (await request("/api/export", { site: "adobe", ids: [a.id] })).status,
    400,
  );
  const form = new FormData();
  form.append("images", new Blob(["not a real image"]), "bad.png");
  assert.equal((await request("/api/assets", form)).status, 400);
});
test("FTPS sends JPEG plus CSV, verifies TLS, skips duplicate files and never claims submission", async (t) => {
  const sent = [];
  let options;
  const ftpFactory = () => ({
    async access(o) {
      options = o;
    },
    async cd() {},
    async uploadFrom(stream, name) {
      const chunks = [];
      for await (const chunk of stream)
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      sent.push({ name, data: Buffer.concat(chunks) });
    },
    close() {},
  });
  const { request, upload } = await server(t, { ftpFactory });
  const a = await upload();
  await request(`/api/assets/${a.id}`, { metadata }, "PATCH");
  await request(
    "/api/settings",
    {
      ftpHost: "ftp.freepik.com",
      ftpUser: "test-user",
      ftpPassword: "test-password",
    },
    "PUT",
  );
  const r = await request("/api/transfer/freepik", { ids: [a.id] });
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.submitted, false);
  assert.equal(options.secure, true);
  assert.equal(options.secureOptions.rejectUnauthorized, true);
  assert.equal(sent.length, 2);
  assert.ok(sent[0].name.endsWith(".jpg"));
  assert.ok((await sharp(sent[0].data).metadata()).iptc);
  assert.match(
    sent[1].data.toString(),
    /^File name;Title;Keywords;Prompt;Model/,
  );
  const second = await (
    await request("/api/transfer/freepik", { ids: [a.id] })
  ).json();
  assert.equal(second.results[0].status, "already-transferred");
  assert.equal(sent.length, 3);
});
test(
  "actual local neural super-resolution doubles pixels while retaining transparency",
  { timeout: 90_000 },
  async (t) => {
    assert.equal(
      localReady(),
      true,
      "Run Python setup and scripts/setup_models.py before tests",
    );
    const { request, upload } = await server(t);
    const a = await upload();
    const r = await request(`/api/assets/${a.id}/upscale`, { scale: 2 });
    const d = await r.json();
    assert.equal(r.status, 200, JSON.stringify(d));
    assert.equal(d.width, 128);
    assert.equal(d.height, 128);
    assert.equal(d.hasAlpha, true);
    assert.equal(d.upscale.engine, "FSRCNN");
    const result = Buffer.from(
      await (await request(`/api/assets/${a.id}/file`)).arrayBuffer(),
    );
    assert.equal((await sharp(result).stats()).channels[3].min, 0);
    assert.equal(
      (await request(`/api/assets/${a.id}/upscale`, { scale: 3 })).status,
      400,
    );
  },
);
