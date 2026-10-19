import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { requireThat, HttpError, length } from "./shared";
const xml = new XMLParser({
  ignoreAttributes: false,
  processEntities: false,
  parseTagValue: false,
  trimValues: false,
});
function parse(s: string) {
  requireThat(!/<!DOCTYPE|<!ENTITY/i.test(s), "안전하지 않은 문서입니다.", 422);
  return xml.parse(s);
}
function nodes(v: any, key: string): any[] {
  if (!v || typeof v !== "object") return [];
  return Object.entries(v).flatMap(([k, x]) => [
    ...(k === key ? (Array.isArray(x) ? x : [x]) : []),
    ...nodes(x, key),
  ]);
}
function text(v: any): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(text).join(" ");
  if (v && typeof v === "object")
    return Object.entries(v)
      .filter(([k]) => !k.startsWith("@_"))
      .map(([, x]) => text(x))
      .join(" ");
  return "";
}
export const filename = (s: string) =>
  s
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)!
    .replace(/[^\p{L}\p{N}_.-]/gu, "_")
    .slice(0, 100) || "source.txt";
export async function extract(name: string, raw: Uint8Array) {
  requireThat(
    raw.length > 0 && raw.length <= 8 * 1024 * 1024,
    "자료는 비어 있지 않은 8MB 이하 파일이어야 합니다.",
    413,
  );
  const ext = name.toLowerCase().split(".").at(-1);
  let result = "",
    encoding = "document";
  try {
    if (ext === "txt" || ext === "md") {
      requireThat(
        !raw.includes(0),
        "텍스트 파일에 바이너리 내용이 있습니다.",
        422,
      );
      try {
        result = new TextDecoder("utf-8", { fatal: true }).decode(raw);
        encoding = "utf-8";
      } catch {
        result = new TextDecoder("euc-kr", { fatal: true }).decode(raw);
        encoding = "cp949";
      }
    } else if (ext === "docx" || ext === "epub") {
      let count = 0,
        total = 0;
      const archive = unzipSync(raw, {
        filter: (info) => {
          count++;
          total += info.originalSize;
          requireThat(
            count <= 2000 && total <= 32 * 1024 * 1024,
            "압축 문서가 너무 큽니다.",
            413,
          );
          requireThat(
            !/vbaproject|\.exe$/i.test(info.name),
            "실행 내용이 있는 파일입니다.",
            422,
          );
          return true;
        },
      });
      const read = (path: string) => {
        requireThat(
          !!archive[path] &&
            !path.startsWith("/") &&
            !path.split("/").includes(".."),
          "문서 구조가 잘못되었습니다.",
          422,
        );
        return parse(new TextDecoder().decode(archive[path]));
      };
      if (ext === "docx")
        result = nodes(read("word/document.xml"), "w:p")
          .map((p) => nodes(p, "w:t").map(text).join(""))
          .join("\n");
      else {
        requireThat(
          !archive["META-INF/encryption.xml"],
          "DRM EPUB은 지원하지 않습니다.",
          422,
        );
        const root = nodes(read("META-INF/container.xml"), "rootfile")[0];
        const opf = root?.["@_full-path"];
        requireThat(!!opf, "EPUB 목차를 찾을 수 없습니다.", 422);
        const pack = read(opf);
        const items = nodes(pack, "item");
        const base = opf.includes("/")
          ? opf.slice(0, opf.lastIndexOf("/") + 1)
          : "";
        result = nodes(pack, "itemref")
          .map((ref) => {
            const item = items.find((x) => x["@_id"] === ref["@_idref"]);
            requireThat(item, "EPUB 순서가 잘못되었습니다.", 422);
            return text(read(base + decodeURIComponent(item["@_href"])));
          })
          .join("\n");
      }
    } else if (ext === "pdf") {
      requireThat(
        new TextDecoder().decode(raw.slice(0, 5)) === "%PDF-",
        "PDF 파일 형식을 확인하세요.",
        422,
      );
      const { getDocumentProxy, extractText } = await import("unpdf");
      const doc = await getDocumentProxy(raw.slice());
      requireThat(doc.numPages <= 500, "PDF는 500쪽 이하여야 합니다.", 413);
      const extracted = await extractText(doc, { mergePages: true });
      result = extracted.text;
      requireThat(
        result.trim().length >= 30,
        "이미지 PDF는 지원하지 않습니다. TXT로 제공해주세요.",
        422,
      );
    } else
      throw new HttpError(
        415,
        "TXT, MD, DOCX, 텍스트 PDF, DRM 없는 EPUB을 지원합니다.",
      );
    requireThat(
      result.trim() && length(result) <= 400000 && !/[\x00-\x08]/.test(result),
      "텍스트는 비어 있지 않은 40만 자 이하이어야 합니다.",
      413,
    );
    return { text: result, encoding };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(
      422,
      "파일 추출에 실패했습니다. UTF-8 TXT를 권장합니다.",
    );
  }
}
export function overlap(source: string, sample: string) {
  const a = Array.from(source.replace(/\s/g, "")),
    b = Array.from(sample.replace(/\s/g, ""));
  const joined = a.join("");
  for (let i = 0; i <= b.length - 32; i++)
    if (joined.includes(b.slice(i, i + 32).join(""))) return true;
  return false;
}
