import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.mjs";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stock-browser-"));
const { app } = createApp({ dataDir });
app.use(express.static(path.resolve("dist")));
const server = app.listen(3100, "127.0.0.1");
function stop() {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
