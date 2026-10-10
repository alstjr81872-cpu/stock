import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function createStore(root, { encryptionKey } = {}) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const files = path.join(root, "files");
  fs.mkdirSync(files, { recursive: true, mode: 0o700 });
  const read = (name, fallback) => {
    const file = path.join(root, name + ".json");
    if (!fs.existsSync(file)) return fallback;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (name !== "settings" || !encryptionKey) return data;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey,
      Buffer.from(data.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(data.tag, "base64"));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(data.encrypted, "base64")),
        decipher.final(),
      ]).toString("utf8"),
    );
  };
  const write = (name, value) => {
    const file = path.join(root, name + ".json");
    let stored = value;
    if (name === "settings" && encryptionKey) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(value), "utf8"),
        cipher.final(),
      ]);
      stored = {
        version: 1,
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        encrypted: encrypted.toString("base64"),
      };
    }
    fs.writeFileSync(file + ".tmp", JSON.stringify(stored, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(file + ".tmp", file);
  };
  const assets = () => read("assets", []);
  const update = (id, patch) => {
    const all = assets(),
      index = all.findIndex((a) => a.id === id);
    if (index < 0)
      throw Object.assign(new Error("이미지를 찾을 수 없습니다."), {
        status: 404,
      });
    all[index] = {
      ...all[index],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    write("assets", all);
    return all[index];
  };
  return { root, files, read, write, assets, update };
}
