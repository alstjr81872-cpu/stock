import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const defaults = Object.fromEntries(
  readFileSync(".env.cloud.example", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
const env = {
  ...defaults,
  ...process.env,
  NF_STATIC_EXPORT: "1",
  NEXT_PUBLIC_AUTH_PROVIDER: "supabase",
  NEXT_DIST_DIR: "out",
};
for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
])
  if (!env[key]) throw new Error(key + " is required");
for (const [command, args] of [
  [process.execPath, ["scripts/build-worker-validators.mjs"]],
  [process.execPath, ["node_modules/next/dist/bin/next", "build"]],
]) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
