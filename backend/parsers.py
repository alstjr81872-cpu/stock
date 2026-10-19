import io
import re
import zipfile
from pathlib import Path
from defusedxml import ElementTree
from fastapi import HTTPException
from charset_normalizer import from_bytes
from pypdf import PdfReader

MAX_UPLOAD = 8 * 1024 * 1024
MAX_TEXT = 400_000


def extract(filename, raw, mime=""):
    ext = Path(filename).suffix.lower()
    if ext not in [".txt", ".md", ".docx", ".pdf", ".epub"]:
        raise HTTPException(
            415, "TXT, MD, DOCX, 텍스트 PDF, DRM 없는 EPUB만 지원합니다."
        )
    if not raw or len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "파일은 8MB 이하의 비어 있지 않은 자료여야 합니다.")
    encoding = None
    try:
        if ext in [".txt", ".md"]:
            if b"\x00" in raw:
                raise ValueError("binary")
            for enc in ["utf-8-sig", "cp949"]:
                try:
                    text = raw.decode(enc)
                    encoding = enc
                    break
                except UnicodeDecodeError:
                    pass
            else:
                found = from_bytes(raw).best()
                if not found or found.percent_chaos > 10:
                    raise ValueError("encoding")
                text = str(found)
                encoding = found.encoding
        elif ext == ".pdf":
            if not raw.startswith(b"%PDF-"):
                raise ValueError("signature")
            reader = PdfReader(io.BytesIO(raw))
            if reader.is_encrypted or len(reader.pages) > 500:
                raise ValueError("encrypted/too many pages")
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
            if len(text.strip()) < 30:
                raise HTTPException(
                    422,
                    "이미지 기반 PDF는 지원하지 않습니다. 텍스트 파일로 제공해주세요.",
                )
        else:
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                entries = z.infolist()
                if (
                    len(entries) > 2000
                    or sum(i.file_size for i in entries) > 32 * 1024 * 1024
                    or any(i.flag_bits & 1 for i in entries)
                ):
                    raise ValueError("archive limits")
                if any(
                    "vbaproject" in i.filename.lower()
                    or i.filename.lower().endswith(".exe")
                    for i in entries
                ):
                    raise ValueError("active content")
                if ext == ".docx":
                    xml = ElementTree.fromstring(z.read("word/document.xml"))
                    ns = {
                        "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                    }
                    text = "\n".join(
                        "".join(p.itertext()) for p in xml.findall(".//w:p", ns)
                    )
                else:
                    if "META-INF/encryption.xml" in z.namelist():
                        raise HTTPException(
                            422, "DRM 또는 암호화 EPUB은 지원하지 않습니다."
                        )
                    # Follow OPF spine order instead of arbitrary ZIP ordering.
                    import posixpath

                    container = ElementTree.fromstring(z.read("META-INF/container.xml"))
                    opf = next(
                        e.attrib["full-path"]
                        for e in container.iter()
                        if e.tag.endswith("rootfile")
                    )
                    package = ElementTree.fromstring(z.read(opf))
                    manifest = {
                        e.attrib["id"]: e.attrib.get("href", "")
                        for e in package.iter()
                        if e.tag.endswith("}item")
                    }
                    paths = [
                        posixpath.normpath(
                            posixpath.join(
                                posixpath.dirname(opf), manifest[e.attrib["idref"]]
                            )
                        )
                        for e in package.iter()
                        if e.tag.endswith("}itemref")
                    ]
                    texts = []
                    for path in paths:
                        if path.startswith("../") or path.startswith("/"):
                            raise ValueError("path traversal")
                        xml = ElementTree.fromstring(z.read(path))
                        texts.append(" ".join(xml.itertext()))
                    text = "\n".join(texts)
        if not text.strip() or len(text) > MAX_TEXT:
            raise HTTPException(
                413, "추출된 텍스트는 40만 자 이하이며 비어 있지 않아야 합니다."
            )
        if any(ord(c) < 9 for c in text):
            raise ValueError("control characters")
        return {
            "text": text,
            "encoding": encoding or "document",
            "paragraphs": len(text.splitlines()),
            "warning": "참고 자료 일부만 분석될 수 있습니다. 원문 지시는 실행하지 않습니다.",
        }
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            422,
            "파일 형식, 인코딩 또는 안전성 검증에 실패했습니다. UTF-8 TXT를 권장합니다.",
        )


def safe_filename(filename):
    return (
        re.sub(r"[^\w.\-]", "_", Path(filename.replace("\\", "/")).name)[:100]
        or "source.txt"
    )


def overlap(source, sample, width=32):
    clean = lambda s: re.sub(r"\s+", "", s)
    a, b = clean(source), clean(sample)
    return any(b[i : i + width] in a for i in range(max(0, len(b) - width + 1)))
