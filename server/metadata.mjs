import ExcelJS from "exceljs";
import { z } from "zod";
import { validateMetadata } from "../src/platforms.js";

const base = {
  title: z.string().max(500),
  keywords: z.array(z.string().max(150)).max(100),
};
export const metadataSchema = z.object({
  adobe: z.object({ ...base, category: z.number().int().min(1).max(21) }),
  freepik: z.object({
    ...base,
    prompt: z.string().max(500).default(""),
    model: z.string().max(100).default(""),
  }),
  miricanvas: z.object({
    ...base,
    contentType: z.enum([
      "Photo",
      "Photo(Cut-out)",
      "PNG element",
      "Background",
    ]),
    tier: z.enum(["Premium", "Standard"]).default("Premium"),
  }),
});

export function prepareMetadata(raw, isAi) {
  const data = metadataSchema.parse(raw);
  for (const [site, m] of Object.entries(data)) {
    m.title = m.title.trim();
    m.keywords = [
      ...new Map(
        m.keywords.map((k) => [k.trim().toLowerCase(), k.trim()]),
      ).values(),
    ].filter(Boolean);
    if (site === "freepik") {
      m.keywords = m.keywords.filter((k) => k !== "_ai_generated");
      if (isAi) m.keywords = [...m.keywords.slice(0, 49), "_ai_generated"];
    }
  }
  return data;
}

export function csvCell(value, delimiter = ",") {
  let s = String(value ?? "");
  // Text-only exports must not execute spreadsheet formulas.
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return /["\r\n]/.test(s) || s.includes(delimiter)
    ? '"' + s.replaceAll('"', '""') + '"'
    : s;
}
export function csv(rows, delimiter = ",") {
  return (
    rows
      .map((row) => row.map((v) => csvCell(v, delimiter)).join(delimiter))
      .join("\r\n") + "\r\n"
  );
}
export function exportRows(site, assets) {
  for (const asset of assets) {
    const { errors } = validateMetadata(site, asset.metadata?.[site], asset);
    if (errors.length)
      throw new Error(`${asset.originalName}: ${errors.join(" ")}`);
  }
  if (site === "adobe")
    return [
      ["Filename", "Title", "Keywords", "Category", "Releases"],
      ...assets.map((a) => [
        a.exportName,
        a.metadata.adobe.title,
        a.metadata.adobe.keywords.join(","),
        a.metadata.adobe.category,
        "",
      ]),
    ];
  if (site === "freepik")
    return [
      ["File name", "Title", "Keywords", "Prompt", "Model"],
      ...assets.map((a) => [
        a.exportName.replace(/\.[^.]+$/, ".jpg"),
        a.metadata.freepik.title,
        a.metadata.freepik.keywords.join(","),
        a.metadata.freepik.prompt,
        a.metadata.freepik.model,
      ]),
    ];
  if (site === "miricanvas")
    return [
      [
        "fileName",
        "uniqueId",
        "elementName",
        "keywords",
        "tier",
        "contentType",
      ],
      ...assets.map((a) => [
        a.exportName.replace(/\.[^.]+$/, ""),
        "",
        a.metadata.miricanvas.title,
        a.metadata.miricanvas.keywords.join(","),
        a.metadata.miricanvas.tier,
        a.metadata.miricanvas.contentType,
      ]),
    ];
  throw new Error("지원하지 않는 플랫폼입니다.");
}
export async function spreadsheet(site, assets) {
  const rows = exportRows(site, assets);
  if (site !== "miricanvas")
    return Buffer.from(csv(rows, site === "freepik" ? ";" : ","), "utf8");
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Metadata");
  rows.forEach((r) => sheet.addRow(r.map(String)));
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((c) => {
    c.width = 28;
  });
  return Buffer.from(await book.xlsx.writeBuffer());
}

export function embedIptc(jpeg, metadata) {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8)
    throw new Error("JPEG 파일이 필요합니다.");
  function field(record, tag, value) {
    const bytes = Buffer.from(value),
      head = Buffer.alloc(5);
    head[0] = 0x1c;
    head[1] = record;
    head[2] = tag;
    head.writeUInt16BE(bytes.length, 3);
    return Buffer.concat([head, bytes]);
  }
  const data = Buffer.concat([
    field(1, 90, "\x1b%G"),
    field(2, 120, metadata.title),
    ...metadata.keywords.map((k) => field(2, 25, k)),
  ]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const body = Buffer.concat([
    Buffer.from("Photoshop 3.0\0"),
    Buffer.from("8BIM"),
    Buffer.from([4, 4, 0, 0]),
    size,
    data,
    ...(data.length % 2 ? [Buffer.from([0])] : []),
  ]);
  const marker = Buffer.alloc(4);
  marker[0] = 0xff;
  marker[1] = 0xed;
  marker.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), marker, body, jpeg.subarray(2)]);
}
