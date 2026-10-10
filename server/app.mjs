import express from "express";
import multer from "multer";
import sharp from "sharp";
import archiver from "archiver";
import { Client as FtpClient } from "basic-ftp";
import { Readable } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { createStore } from "./store.mjs";
import {
  metadataSchema,
  prepareMetadata,
  spreadsheet,
  embedIptc,
} from "./metadata.mjs";
import {
  generateMetadata,
  startUpscale,
  pollUpscale,
  downloadUpscale,
  restoreAlpha,
} from "./providers.mjs";
import { localReady, localUpscale } from "./local-upscale.mjs";
import { publicWorkspaces } from "./public-workspaces.mjs";

const secretNames = ["openaiKey", "geminiKey", "replicateKey", "ftpPassword"];
const envNames = {
  openaiKey: "OPENAI_API_KEY",
  geminiKey: "GEMINI_API_KEY",
  replicateKey: "REPLICATE_API_TOKEN",
  ftpPassword: "FREEPIK_FTP_PASSWORD",
};
function displayFilename(name) {
  try {
    if (/^[\u0000-\u00ff]*$/.test(name)) {
      return path
        .basename(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.from(name, "latin1"),
          ),
        )
        .slice(0, 240);
    }
  } catch {}
  return path.basename(name).slice(0, 240);
}
const settingsSchema = z.object({
  upscaler: z.enum(["local", "replicate"]).optional(),
  provider: z.enum(["openai", "gemini"]).optional(),
  openaiModel: z
    .string()
    .regex(/^[a-zA-Z0-9._:-]+$/)
    .max(120)
    .optional(),
  geminiModel: z
    .string()
    .regex(/^[a-zA-Z0-9._-]+$/)
    .max(120)
    .optional(),
  openaiKey: z.string().max(500).optional(),
  geminiKey: z.string().max(500).optional(),
  replicateKey: z.string().max(500).optional(),
  ftpHost: z.string().max(253).optional(),
  ftpUser: z.string().max(200).optional(),
  ftpPassword: z.string().max(500).optional(),
  ftpPort: z.number().int().min(1).max(65535).optional(),
  ftpMode: z.enum(["explicit", "implicit"]).optional(),
  ftpDirectory: z
    .string()
    .max(200)
    .regex(/^[a-zA-Z0-9_./ -]*$/)
    .optional(),
});

export function createApp({
  dataDir = path.resolve(".data"),
  fetcher = fetch,
  ftpFactory = () => new FtpClient(30_000),
  publicMode = false,
  sessionSecret = process.env.SESSION_SECRET,
  publicHost = process.env.RENDER_EXTERNAL_HOSTNAME ||
    (process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).host : ""),
} = {}) {
  if (publicMode && !publicHost)
    throw new Error(
      "Public mode requires RENDER_EXTERNAL_HOSTNAME or APP_ORIGIN.",
    );
  const app = express(),
    busy = new Set();
  const workspaces = publicMode
    ? publicWorkspaces({ dataDir, secret: sessionSecret })
    : null;
  const store = workspaces ? workspaces.store : createStore(dataDir);
  let heavyRequests = 0;
  const diskBytes = (root) =>
    fs
      .readdirSync(root, { withFileTypes: true })
      .reduce(
        (total, entry) =>
          total +
          (entry.isDirectory()
            ? diskBytes(path.join(root, entry.name))
            : entry.isFile()
              ? fs.statSync(path.join(root, entry.name)).size
              : 0),
        0,
      );
  const checkStorage = () => {
    if (
      publicMode &&
      (diskBytes(store.root) > 100_000_000 ||
        diskBytes(path.join(dataDir, "sessions")) > 1_000_000_000)
    )
      throw new Error(
        "저장 공간 한도에 도달했습니다. 결과를 내려받고 불필요한 이미지를 삭제해주세요.",
      );
  };
  if (publicMode) {
    app.set("trust proxy", 1);
    sharp.cache({ memory: 24, files: 10, items: 30 });
    sharp.concurrency(1);
  }
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    if (
      !(publicMode && req.get("host") === publicHost) &&
      !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(
        req.get("host") || "",
      )
    )
      return res
        .status(403)
        .json({ error: "개인용 앱은 로컬 주소로 접속해주세요." });
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    if (publicMode) {
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
      );
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    }
    if (req.path.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
      if (
        !["GET", "HEAD"].includes(req.method) &&
        req.get("X-Stock-Studio") !== "1"
      )
        return res.status(403).json({ error: "앱에서 요청해주세요." });
      if (req.get("origin")) {
        try {
          if (new URL(req.get("origin")).host !== req.get("host"))
            return res
              .status(403)
              .json({ error: "외부 사이트 요청은 허용되지 않습니다." });
        } catch {
          return res.sendStatus(403);
        }
      }
    }
    next();
  });
  if (workspaces) app.use(workspaces.middleware);
  // Small public instances process one memory-intensive operation at a time.
  app.use((req, res, next) => {
    const heavy =
      publicMode &&
      req.method === "POST" &&
      (req.path === "/api/assets" ||
        req.path === "/api/export" ||
        req.path.startsWith("/api/transfer/") ||
        /^\/api\/assets\/[^/]+\/(?:generate|upscale)(?:\/poll)?$/.test(
          req.path,
        ));
    if (!heavy) return next();
    if (heavyRequests >= 1)
      return res
        .status(429)
        .json({
          error: "다른 이미지를 처리 중입니다. 잠시 후 다시 시도해주세요.",
        });
    heavyRequests++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        heavyRequests--;
      }
    };
    const end = res.end.bind(res);
    res.end = (...args) => {
      release();
      return end(...args);
    };
    res.once("finish", release);
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  const settings = () => ({
    provider: "gemini",
    upscaler: "local",
    openaiModel: "gpt-4.1-mini",
    geminiModel: "gemini-2.5-flash",
    ftpHost: "",
    ftpUser: "",
    ftpPort: 21,
    ftpMode: "explicit",
    ftpDirectory: "/",
    ...store.read("settings", {}),
    environmentCredentials: !publicMode,
  });
  const publicSettings = () => {
    const value = settings();
    for (const name of secretNames) {
      value[name + "Set"] = !!(
        value[name] ||
        (!publicMode && process.env[envNames[name]])
      );
      delete value[name];
    }
    value.localUpscaleReady = localReady();
    value.publicMode = publicMode;
    return value;
  };
  const asset = (id) => {
    const a = store.assets().find((a) => a.id === id);
    if (!a)
      throw Object.assign(new Error("이미지를 찾을 수 없습니다."), {
        status: 404,
      });
    return a;
  };
  const file = (a) => path.join(store.files, a.file);
  const lock = async (id, action) => {
    if (busy.has(id))
      throw Object.assign(new Error("이미 처리 중입니다. 잠시 기다려주세요."), {
        status: 409,
      });
    busy.add(id);
    try {
      return await action();
    } finally {
      busy.delete(id);
    }
  };
  const selected = (ids) => {
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > (publicMode ? 10 : 100) ||
      ids.some((id) => typeof id !== "string")
    )
      throw new Error(
        publicMode
          ? "한 번에 최대 10개를 선택해주세요."
          : "1~100개의 이미지를 선택해주세요.",
      );
    return [...new Set(ids)].map(asset);
  };
  const siteName = (value) =>
    z.enum(["adobe", "freepik", "miricanvas"]).parse(value);
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, name: "Stock Studio", version: "0.1.0" }),
  );
  app.get("/api/settings", (_req, res) => res.json(publicSettings()));
  app.put("/api/settings", (req, res) => {
    const patch = settingsSchema.parse(req.body);
    if (
      patch.ftpHost &&
      !/^(?:[a-zA-Z0-9-]+\.)+(?:freepik|magnific)\.com$/.test(patch.ftpHost)
    )
      throw new Error(
        "프리픽 계정에서 제공한 freepik.com 또는 magnific.com 하위 FTP 호스트를 입력해주세요.",
      );
    if (patch.ftpDirectory?.split("/").includes(".."))
      throw new Error("상위 디렉터리는 사용할 수 없습니다.");
    store.write("settings", { ...settings(), ...patch });
    res.json(publicSettings());
  });
  app.get("/api/assets", (_req, res) => res.json(store.assets()));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: (publicMode ? 10 : 25) * 1024 * 1024,
      files: publicMode ? 5 : 30,
    },
  });
  app.post("/api/assets", upload.array("images", 30), async (req, res) => {
    checkStorage();
    if (publicMode && store.assets().length + (req.files?.length || 0) > 20)
      throw new Error("공개 서버는 작업 공간당 최대 20개 이미지를 보관합니다.");
    if (!req.files?.length) throw new Error("이미지를 선택해주세요.");
    const added = [],
      errors = [];
    for (const input of req.files) {
      try {
        const bytes = input.buffer;
        const isPng = bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const isJpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        const isWebp =
          bytes.subarray(0, 4).toString() === "RIFF" &&
          bytes.subarray(8, 12).toString() === "WEBP";
        if (!isPng && !isJpeg && !isWebp)
          throw new Error("정지 PNG, JPEG, WebP 이미지만 지원합니다.");
        const image = sharp(input.buffer, {
          limitInputPixels: publicMode ? 6_000_000 : 40_000_000,
          animated: false,
        });
        const meta = await image.metadata();
        if (!["jpeg", "png", "webp"].includes(meta.format) || meta.pages > 1)
          throw new Error("정지 PNG, JPEG, WebP 이미지만 지원합니다.");
        const id = crypto.randomUUID(),
          ext = meta.format === "jpeg" ? "jpg" : "png";
        const filename = `${id}.${ext}`;
        // Normalize orientation and remove hidden metadata; preserve image pixels and alpha.
        const normalized =
          ext === "jpg"
            ? image.rotate().jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
            : image.rotate().png();
        const info = await normalized.toFile(path.join(store.files, filename));
        await sharp(path.join(store.files, filename))
          .resize(400, 400, { fit: "inside", withoutEnlargement: true })
          .png()
          .toFile(path.join(store.files, id + "-thumb.png"));
        const alphaStats = meta.hasAlpha
          ? await sharp(path.join(store.files, filename)).stats()
          : null;
        const hasAlpha = !!alphaStats && alphaStats.channels.at(-1).min < 255;
        const a = {
          id,
          originalName: displayFilename(input.originalname),
          exportName: `stock_${id.slice(0, 8)}.${ext}`,
          file: filename,
          originalFile: filename,
          width: info.width,
          height: info.height,
          originalWidth: info.width,
          originalHeight: info.height,
          bytes: info.size,
          hasAlpha,
          isAi: req.body.isAi !== "false",
          metadata: null,
          createdAt: new Date().toISOString(),
        };
        // Preserve byte-exact uploaded original separately for downloads and comparison.
        fs.writeFileSync(path.join(store.files, id + "-source"), input.buffer, {
          mode: 0o600,
        });
        a.sourceFormat = meta.format;
        added.push(a);
      } catch (e) {
        errors.push({ name: input.originalname, error: e.message });
      }
    }
    store.write("assets", [...store.assets(), ...added]);
    res.status(added.length ? 201 : 400).json({ assets: added, errors });
  });
  app.get("/api/assets/:id/file", (req, res) => {
    const a = asset(req.params.id);
    const original = req.query.original === "1",
      thumb = req.query.thumb === "1";
    const target = path.join(
      store.files,
      thumb ? a.id + "-thumb.png" : original ? a.originalFile : a.file,
    );
    if (req.query.download === "source")
      return res.download(
        path.join(store.files, a.id + "-source"),
        a.originalName,
      );
    if (req.query.download === "1")
      return res.download(
        target,
        original ? `original_${a.exportName}` : a.exportName,
      );
    res.sendFile(target);
  });
  app.patch("/api/assets/:id", (req, res) => {
    const a = asset(req.params.id);
    if (busy.has(a.id)) throw new Error("처리 중인 이미지입니다.");
    const parsed = z
      .object({
        isAi: z.boolean().optional(),
        metadata: metadataSchema.optional(),
      })
      .parse(req.body);
    if (parsed.isAi !== undefined && a.metadata && !parsed.metadata)
      parsed.metadata = prepareMetadata(a.metadata, parsed.isAi);
    if (parsed.metadata)
      parsed.metadata = prepareMetadata(parsed.metadata, parsed.isAi ?? a.isAi);
    res.json(store.update(a.id, parsed));
  });
  app.delete("/api/assets/:id", (req, res) => {
    const a = asset(req.params.id);
    if (busy.has(a.id) || a.upscale?.status === "processing")
      throw new Error("진행 중인 작업이 끝난 후 삭제해주세요.");
    store.write(
      "assets",
      store.assets().filter((x) => x.id !== a.id),
    );
    for (const name of fs.readdirSync(store.files))
      if (name.startsWith(a.id)) fs.rmSync(path.join(store.files, name));
    res.json({ ok: true });
  });
  app.post("/api/assets/:id/generate", async (req, res) => {
    res.json(
      await lock(req.params.id, async () => {
        const a = asset(req.params.id),
          config = settings();
        const metadata = await generateMetadata(file(a), a, config, fetcher);
        return store.update(a.id, {
          metadata,
          generatedBy: {
            provider: config.provider,
            model:
              config.provider === "openai"
                ? config.openaiModel
                : config.geminiModel,
            at: new Date().toISOString(),
          },
        });
      }),
    );
  });
  app.post("/api/assets/:id/upscale", async (req, res) => {
    checkStorage();
    res.json(
      await lock(req.params.id, async () => {
        const a = asset(req.params.id),
          scale = z.union([z.literal(2), z.literal(4)]).parse(req.body.scale);
        if (a.upscale?.status === "processing") return a;
        if (
          a.width * a.height * scale * scale >
          (publicMode ? 8_000_000 : 80_000_000)
        )
          throw new Error(
            publicMode
              ? "공개 서버의 출력 한도는 8MP입니다. 더 작은 이미지나 낮은 배율을 선택해주세요."
              : "결과가 80MP를 초과합니다. 더 낮은 배율을 선택해주세요.",
          );
        if (settings().upscaler === "local") {
          const filename = `${a.id}-local-${crypto.randomUUID().slice(0, 8)}.png`;
          await localUpscale(file(a), path.join(store.files, filename), scale);
          const info = await sharp(path.join(store.files, filename)).metadata();
          if (
            info.width !== a.width * scale ||
            info.height !== a.height * scale
          )
            throw new Error("복원 결과 크기가 올바르지 않습니다.");
          await sharp(path.join(store.files, filename))
            .resize(400, 400, { fit: "inside" })
            .png()
            .toFile(path.join(store.files, a.id + "-thumb.png"));
          return store.update(a.id, {
            file: filename,
            exportName: a.exportName.replace(/\.[^.]+$/, ".png"),
            width: info.width,
            height: info.height,
            bytes: fs.statSync(path.join(store.files, filename)).size,
            upscale: {
              status: "succeeded",
              engine: "FSRCNN",
              scale,
              completedAt: new Date().toISOString(),
            },
          });
        }
        const prediction = await startUpscale(
          file(a),
          scale,
          settings(),
          fetcher,
        );
        return store.update(a.id, {
          upscale: {
            ...prediction,
            engine: "Real-ESRGAN",
            status: "processing",
            scale,
            inputFile: a.file,
            width: a.width * scale,
            height: a.height * scale,
            startedAt: new Date().toISOString(),
          },
        });
      }),
    );
  });
  app.post("/api/assets/:id/upscale/poll", async (req, res) => {
    res.json(
      await lock(req.params.id, async () => {
        const a = asset(req.params.id),
          job = a.upscale;
        if (!job || job.status !== "processing") return a;
        const result = await pollUpscale(job.id, settings(), fetcher);
        if (["failed", "canceled"].includes(result.status))
          return store.update(a.id, {
            upscale: {
              ...job,
              status: "failed",
              error:
                "모델 실행이 실패하거나 취소되었습니다. Replicate 작업 내역을 확인해주세요.",
            },
          });
        if (result.status !== "succeeded") return a;
        try {
          const url = Array.isArray(result.output)
            ? result.output[0]
            : result.output;
          if (typeof url !== "string")
            throw new Error("모델에서 이미지 결과를 받지 못했습니다.");
          const output = await restoreAlpha(
            await downloadUpscale(url, fetcher),
            path.join(store.files, job.inputFile),
            job.width,
            job.height,
            a.hasAlpha,
          );
          const filename = `${a.id}-upscale-${crypto.randomUUID().slice(0, 8)}.png`;
          fs.writeFileSync(path.join(store.files, filename), output, {
            mode: 0o600,
          });
          await sharp(output)
            .resize(400, 400, { fit: "inside" })
            .png()
            .toFile(path.join(store.files, a.id + "-thumb.png"));
          return store.update(a.id, {
            file: filename,
            exportName: a.exportName.replace(/\.[^.]+$/, ".png"),
            width: job.width,
            height: job.height,
            bytes: output.length,
            upscale: {
              ...job,
              status: "succeeded",
              completedAt: new Date().toISOString(),
            },
          });
        } catch (e) {
          return store.update(a.id, {
            upscale: { ...job, status: "failed", error: e.message },
          });
        }
      }),
    );
  });
  app.post("/api/export", async (req, res) => {
    const site = siteName(req.body.site),
      assets = selected(req.body.ids),
      format = site === "miricanvas" ? "xlsx" : "csv";
    const metadata = await spreadsheet(site, assets);
    if (site === "adobe" && metadata.length > 1_000_000)
      throw new Error("어도비 CSV가 1MB를 초과합니다. 선택 개수를 줄여주세요.");
    if (!req.body.includeImages) {
      res.attachment(`${site}-metadata.${format}`);
      return res.send(metadata);
    }
    const files = [];
    for (const a of assets) {
      const buffer =
        site === "freepik"
          ? embedIptc(
              await sharp(file(a))
                .flatten({ background: "#ffffff" })
                .jpeg({ quality: 98, chromaSubsampling: "4:4:4" })
                .toBuffer(),
              a.metadata.freepik,
            )
          : fs.readFileSync(file(a));
      files.push({
        buffer,
        name:
          site === "freepik"
            ? a.exportName.replace(/\.[^.]+$/, ".jpg")
            : a.exportName,
      });
    }
    res.attachment(`${site}-package.zip`);
    const zip = archiver("zip", { zlib: { level: 3 } });
    zip.on("error", (e) => res.destroy(e));
    zip.pipe(res);
    zip.append(metadata, { name: `metadata.${format}` });
    for (const f of files) zip.append(f.buffer, { name: f.name });
    zip.append(
      site === "freepik"
        ? "JPEGs include IPTC title and keywords. Transparent backgrounds were flattened to white. Upload files and CSV, then review AI tag, model and prompt in the contributor portal and Submit for review. File transfer is not submission.\n"
        : "Upload the images with the exact filenames in this package, then import the metadata spreadsheet. Check AI labels, content type and rights in the contributor portal before requesting review. MiriCanvas fileName excludes the extension; uniqueId is intentionally empty.\n",
      { name: "READ-ME.txt" },
    );
    await zip.finalize();
  });
  app.post("/api/transfer/freepik", async (req, res) => {
    const assets = selected(req.body.ids),
      config = settings();
    if (
      !config.ftpHost ||
      !config.ftpUser ||
      !(config.ftpPassword || (!publicMode && process.env.FREEPIK_FTP_PASSWORD))
    )
      throw new Error("설정에서 프리픽 FTP 계정을 연결해주세요.");
    await spreadsheet("freepik", assets);
    const results = [];
    await lock("ftp-transfer", async () => {
      const client = ftpFactory();
      try {
        await client.access({
          host: config.ftpHost,
          port: config.ftpPort,
          user: config.ftpUser,
          password:
            config.ftpPassword ||
            (!publicMode && process.env.FREEPIK_FTP_PASSWORD),
          secure: config.ftpMode === "implicit" ? "implicit" : true,
          secureOptions: { rejectUnauthorized: true },
        });
        await client.cd(config.ftpDirectory || "/");
        for (const a of assets) {
          const digest = crypto
            .createHash("sha256")
            .update(a.file + JSON.stringify(a.metadata.freepik))
            .digest("hex");
          if (
            a.transfer?.status === "transferred" &&
            a.transfer.digest === digest
          ) {
            results.push({ id: a.id, status: "already-transferred" });
            continue;
          }
          try {
            const jpeg = embedIptc(
              await sharp(file(a))
                .flatten({ background: "#ffffff" })
                .jpeg({ quality: 98 })
                .toBuffer(),
              a.metadata.freepik,
            );
            await client.uploadFrom(
              Readable.from(jpeg),
              a.exportName.replace(/\.[^.]+$/, ".jpg"),
            );
            store.update(a.id, {
              transfer: {
                status: "transferred",
                digest,
                at: new Date().toISOString(),
                destination: "freepik",
                note: "파일 전송 완료 · 포털 검토/심사 제출 필요",
              },
            });
            results.push({ id: a.id, status: "transferred" });
          } catch {
            results.push({ id: a.id, status: "failed" });
            break;
          }
        }
        // Only associate metadata for successfully transferred assets, not failed ones.
        const sent = assets.filter((a) =>
          results.some((r) => r.id === a.id && r.status !== "failed"),
        );
        if (sent.length)
          await client.uploadFrom(
            Readable.from(await spreadsheet("freepik", sent)),
            `metadata_${Date.now()}.csv`,
          );
        res.json({
          results,
          submitted: false,
          message: "전송 결과를 확인한 뒤 기여자 포털에서 최종 제출해주세요.",
        });
      } catch {
        res.status(502).json({
          error:
            "FTPS 전송 또는 CSV 등록에 실패했습니다. 계정·TLS 지원·포트·네트워크 설정을 확인해주세요. 일부 파일은 전송됐을 수 있으므로 포털을 확인해주세요.",
          results,
        });
      } finally {
        client.close();
      }
    });
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "지원하지 않는 요청입니다." }),
  );
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return res.end();
    const message =
      error instanceof z.ZodError
        ? "입력 형식이 올바르지 않습니다. 필수 값과 길이를 확인해주세요."
        : error instanceof multer.MulterError
          ? publicMode
            ? "파일당 10MB, 한 번에 최대 5개까지 업로드할 수 있습니다."
            : "파일당 25MB, 한 번에 최대 30개까지 업로드할 수 있습니다."
          : /fetch failed|ECONN|ETIMEDOUT/.test(error.message)
            ? "외부 서비스에 연결할 수 없습니다. 네트워크 허용 설정을 확인해주세요."
            : error.message;
    res
      .status(error.status || 400)
      .json({ error: message || "요청을 처리하지 못했습니다." });
  });
  return { app, store };
}
