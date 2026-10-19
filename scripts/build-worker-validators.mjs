import Ajv from "ajv";
import standalone from "ajv/dist/standalone/index.js";
import { readFileSync, writeFileSync } from "node:fs";
const assets = JSON.parse(
  readFileSync(new URL("../worker/assets.json", import.meta.url), "utf8"),
);
const ajv = new Ajv({
  strict: false,
  useDefaults: true,
  code: { source: true, esm: true },
});
const names = {};
for (const [name, schema] of Object.entries(assets.schemas)) {
  ajv.addSchema(schema, name);
  names[name] = name;
}
// Ahead-of-time output: Workers forbids runtime eval/new Function.
writeFileSync(
  new URL("../worker/validators.js", import.meta.url),
  'import ucs2length from \"ajv/dist/runtime/ucs2length.js\";\n' +
    standalone(ajv, names).replaceAll(
      'require(\"ajv/dist/runtime/ucs2length\").default',
      "ucs2length",
    ),
);
