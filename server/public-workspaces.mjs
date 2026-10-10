import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { createStore } from "./store.mjs";

const COOKIE = "__Host-stock_workspace";
export function publicWorkspaces({
  dataDir,
  secret,
  maxSessions = 500,
  retentionHours = 24,
}) {
  if (!secret || secret.length < 32)
    throw new Error(
      "Public mode requires SESSION_SECRET with at least 32 characters.",
    );
  const context = new AsyncLocalStorage();
  const encryptionKey = crypto.createHash("sha256").update(secret).digest();
  const root = path.join(dataDir, "sessions");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const signature = (id) =>
    crypto.createHmac("sha256", secret).update(id).digest("hex");
  const limits = new Map();
  const signSession = (id) => `${id}.${signature(id)}`;
  const verifySession = (value) => {
    const [id, mac] = (value || "").split(".");
    if (!/^[a-f0-9]{64}$/.test(id || "") || !/^[a-f0-9]{64}$/.test(mac || ""))
      return null;
    return crypto.timingSafeEqual(
      Buffer.from(mac, "hex"),
      Buffer.from(signature(id), "hex"),
    )
      ? id
      : null;
  };
  const current = () => {
    const state = context.getStore();
    if (!state) throw new Error("Missing workspace context");
    return state;
  };
  const store = {
    get root() {
      return current().root;
    },
    get files() {
      return current().files;
    },
    read: (...args) => current().read(...args),
    write: (...args) => current().write(...args),
    assets: () => current().assets(),
    update: (...args) => current().update(...args),
  };
  let lastCleanup = 0;
  const middleware = (req, res, next) => {
    if (
      (req.path !== "/" && !req.path.startsWith("/api/")) ||
      req.path === "/api/health"
    )
      return next();
    const now = Date.now();
    if (now - lastCleanup > 600_000) {
      for (const item of fs.readdirSync(root, { withFileTypes: true })) {
        if (!item.isDirectory() || !/^[a-f0-9]{64}$/.test(item.name)) continue;
        const dir = path.join(root, item.name);
        if (now - fs.statSync(dir).mtimeMs > retentionHours * 3600_000)
          fs.rmSync(dir, { recursive: true, force: true });
      }
      for (const [key, bucket] of limits)
        if (now > bucket.expires) limits.delete(key);
      lastCleanup = now;
    }
    const ip = req.ip || "unknown";
    const bucket = limits.get(ip);
    const rate =
      !bucket || now > bucket.expires
        ? { count: 0, expires: now + 60_000 }
        : bucket;
    if (++rate.count > 120)
      return res
        .status(429)
        .json({ error: "요청이 많습니다. 잠시 후 다시 시도해주세요." });
    limits.set(ip, rate);
    const cookies = Object.fromEntries(
      (req.get("cookie") || "").split(";").map((s) => {
        const i = s.indexOf("=");
        return i < 0 ? ["", ""] : [s.slice(0, i).trim(), s.slice(i + 1).trim()];
      }),
    );
    let id = verifySession(cookies[COOKIE]);
    if (!id) {
      if (fs.readdirSync(root).length >= maxSessions)
        return res
          .status(503)
          .json({
            error:
              "공용 서버의 작업 공간이 가득 찼습니다. 잠시 후 다시 방문해주세요.",
          });
      id = crypto.randomBytes(32).toString("hex");
    }
    res.cookie(COOKIE, signSession(id), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: retentionHours * 3600_000,
    });
    const workspace = createStore(path.join(root, id), { encryptionKey });
    fs.utimesSync(workspace.root, new Date(), new Date());
    context.run(workspace, next);
  };
  return { middleware, store };
}
