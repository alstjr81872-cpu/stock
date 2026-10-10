export const platforms = {
  adobe: {
    name: "Adobe Stock",
    mark: "A",
    color: "#ef645c",
    titleMax: 70,
    keywordMin: 5,
    keywordMax: 50,
    language: "English",
    export: "CSV",
    description: "영문 제목 · 중요도순 키워드 · 카테고리",
    source:
      "https://helpx.adobe.com/stock/contributor/manage-your-portfolio/csv-requirements-content.html",
  },
  freepik: {
    name: "Freepik",
    mark: "F",
    color: "#6589ff",
    titleMax: 100,
    keywordMin: 5,
    keywordMax: 50,
    language: "English",
    export: "CSV + JPEG",
    description: "세미콜론 CSV · AI 태그 · 모델·프롬프트",
    source: "https://www.magnific.com/ai/contributors/how-to-create-a-csv-file",
  },
  miricanvas: {
    name: "미리캔버스",
    mark: "M",
    color: "#3ec3ac",
    titleMax: 100,
    keywordMin: 1,
    keywordMax: 25,
    language: "한국어",
    export: "XLSX",
    description: "요소 이름 · 키워드 · 라이선스 · 콘텐츠 타입",
    source:
      "https://miricanvas-designhub.zendesk.com/hc/ko/articles/20894820587417",
  },
};
export const categories = [
  "Animals",
  "Buildings and Architecture",
  "Business",
  "Drinks",
  "The Environment",
  "States of Mind",
  "Food",
  "Graphic Resources",
  "Hobbies and Leisure",
  "Industry",
  "Landscapes",
  "Lifestyle",
  "People",
  "Plants and Flowers",
  "Culture and Religion",
  "Science",
  "Social Issues",
  "Sports",
  "Technology",
  "Transport",
  "Travel",
];
export const contentTypes = [
  "Photo",
  "Photo(Cut-out)",
  "PNG element",
  "Background",
];

export function validateMetadata(site, m, asset) {
  const p = platforms[site],
    errors = [],
    warnings = [];
  if (!m || !p)
    return { errors: ["메타데이터를 먼저 생성하거나 입력해주세요."], warnings };
  if (!m.title?.trim()) errors.push("제목이 필요합니다.");
  if ((m.title || "").length > p.titleMax)
    errors.push(`제목은 ${p.titleMax}자 이하여야 합니다.`);
  if (site === "freepik" && (m.title || "").length < 5)
    errors.push("프리픽 제목은 5자 이상이어야 합니다.");
  const keys = Array.isArray(m.keywords) ? m.keywords : [];
  if (keys.length < p.keywordMin || keys.length > p.keywordMax)
    errors.push(`키워드는 ${p.keywordMin}~${p.keywordMax}개가 필요합니다.`);
  if (keys.some((k) => !k.trim() || /[,;\r\n]/.test(k)))
    errors.push("개별 키워드에는 쉼표·세미콜론·줄바꿈을 넣을 수 없습니다.");
  if (new Set(keys.map((k) => k.toLowerCase())).size !== keys.length)
    errors.push("중복 키워드를 제거해주세요.");
  if (site === "adobe") {
    if (!Number.isInteger(m.category) || m.category < 1 || m.category > 21)
      errors.push("카테고리를 선택해주세요.");
    if (asset && asset.width * asset.height < 4_000_000)
      warnings.push(
        "4MP 미만입니다. 사진 제출 시 업스케일링이 필요할 수 있습니다.",
      );
    if (asset?.isAi)
      warnings.push(
        "어도비 포털에서 AI 생성 체크박스를 별도로 선택해야 합니다.",
      );
  }
  if (site === "freepik") {
    if (asset?.isAi && !keys.includes("_ai_generated"))
      errors.push("AI 콘텐츠는 _ai_generated 키워드가 필요합니다.");
    if (asset?.hasAlpha)
      warnings.push(
        "프리픽 JPEG 패키지·전송 시 투명 배경은 흰색으로 변환됩니다.",
      );
    if (!!m.prompt !== !!m.model)
      errors.push(
        "실제 제작 프롬프트와 모델을 함께 입력하거나 둘 다 비워주세요.",
      );
    if ((m.prompt || "").length > 500)
      errors.push("프롬프트는 500자 이하여야 합니다.");
    warnings.push(
      "제작 모델명은 기여자 포털 목록과 정확히 일치해야 합니다. 분석 AI 모델과는 다릅니다.",
    );
  }
  if (site === "miricanvas") {
    if (/[^a-zA-Z가-힣\s]/u.test(m.title || ""))
      errors.push("요소 이름에는 한글·영문·공백만 사용해주세요.");
    if (keys.some((k) => k.length > 50 || /[^\p{L}\p{N}\s-]/u.test(k)))
      errors.push("키워드는 50자 이하, 특수문자는 하이픈만 허용합니다.");
    if (!contentTypes.includes(m.contentType))
      errors.push("콘텐츠 타입을 선택해주세요.");
    if (!["Premium", "Standard"].includes(m.tier))
      errors.push("라이선스를 선택해주세요.");
    if (
      ["PNG element", "Photo(Cut-out)"].includes(m.contentType) &&
      asset &&
      !asset.hasAlpha
    )
      errors.push("배경이 제거된 투명 이미지가 필요합니다.");
    if (keys.length > 8)
      warnings.push(
        "CSV/XLSX는 최대 25개입니다. 일반 입력 화면 안내는 1~8개이므로 입력 방식에 유의해주세요.",
      );
    if (asset?.isAi)
      warnings.push(
        "디자인허브에서 생성형 AI 체크박스를 별도로 선택해야 합니다.",
      );
  }
  return { errors, warnings };
}
