import path from "node:path";
import express from "express";
import { createApp } from "./app.mjs";

const { app } = createApp({
  dataDir: process.env.STOCK_DATA_DIR || path.resolve(".data"),
  publicMode: process.env.PUBLIC_MODE === "1",
});
if (process.argv.includes("--production")) {
  app.use(express.static(path.resolve("dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000);
const host = process.env.PUBLIC_MODE === "1" ? "0.0.0.0" : "127.0.0.1";
app.listen(port, host, () =>
  console.log(`Stock Studio listening on port ${port}`),
);
