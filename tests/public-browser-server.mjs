import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createApp } from "../server/app.mjs";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stock-public-browser-"));
const { app } = createApp({
  dataDir,
  publicMode: true,
  publicHost: "127.0.0.1:3102",
  sessionSecret: crypto.randomBytes(32).toString("hex"),
});
app.use(express.static(path.resolve("dist")));
const server = app.listen(3102, "127.0.0.1");
const stop = () => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
