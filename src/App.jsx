import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  ImagePlus,
  Images,
  Layers3,
  Loader2,
  Maximize2,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
  Zap,
  AlertCircle,
  ExternalLink,
  KeyRound,
  Copy,
} from "lucide-react";
import {
  platforms,
  categories,
  contentTypes,
  validateMetadata,
} from "./platforms";

async function api(url, body, method = "POST") {
  const response = await fetch(url, {
    method: body === undefined && method === "POST" ? "GET" : method,
    headers:
      body instanceof FormData
        ? { "X-Stock-Studio": "1" }
        : { "Content-Type": "application/json", "X-Stock-Studio": "1" },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}
const size = (bytes) =>
  bytes > 1e6
    ? `${(bytes / 1e6).toFixed(1)} MB`
    : `${Math.round(bytes / 1e3)} KB`;
const fileUrl = (a, query = "") =>
  `/api/assets/${a.id}/file?${query}&v=${encodeURIComponent(a.updatedAt || a.createdAt)}`;
const blankMetadata = (a) => ({
  adobe: { title: "", keywords: [], category: 8 },
  freepik: {
    title: "",
    keywords: a.isAi ? ["_ai_generated"] : [],
    prompt: "",
    model: "",
  },
  miricanvas: {
    title: "",
    keywords: [],
    tier: "Premium",
    contentType: a.hasAlpha ? "PNG element" : "Photo",
  },
});

function PlatformMark({ site }) {
  return (
    <span
      className={`platform-mark ${site}`}
      style={{ "--brand": platforms[site].color }}
    >
      {platforms[site].mark}
    </span>
  );
}
function Modal({ title, subtitle, children, onClose, wide }) {
  useEffect(() => {
    const key = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" aria-label="닫기" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState("library"),
    [assets, setAssets] = useState([]),
    [settings, setSettings] = useState(null),
    [selected, setSelected] = useState([]),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [toast, setToast] = useState(null),
    [busy, setBusy] = useState(null),
    [editing, setEditing] = useState(null),
    [exporting, setExporting] = useState(false),
    [compare, setCompare] = useState(null),
    [uploadAi, setUploadAi] = useState(true),
    [drag, setDrag] = useState(false),
    [scale, setScale] = useState(2);
  const input = useRef(),
    cancel = useRef(false),
    polling = useRef(false);
  const notify = (text, error = false) =>
    setToast({ text, error, id: Date.now() });
  const refresh = async () => {
    // Establish the anonymous workspace cookie before loading private assets.
    const s = await api("/api/settings");
    const a = await api("/api/assets");
    setAssets(a);
    setSettings(s);
  };
  useEffect(() => {
    refresh().catch((e) => notify(e.message, true));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(t);
  }, [toast]);
  const replace = (a) =>
    setAssets((previous) => previous.map((p) => (p.id === a.id ? a : p)));
  useEffect(() => {
    if (!assets.some((a) => a.upscale?.status === "processing")) return;
    const timer = setInterval(async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        for (const a of assets.filter(
          (a) => a.upscale?.status === "processing",
        )) {
          try {
            const next = await api(`/api/assets/${a.id}/upscale/poll`, {});
            replace(next);
            if (next.upscale.status === "failed")
              notify(next.upscale.error, true);
            if (next.upscale.status === "succeeded")
              notify(`${a.originalName} 업스케일링 완료`);
          } catch (e) {
            notify(e.message, true);
          }
        }
      } finally {
        polling.current = false;
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [assets]);
  const upload = async (files) => {
    if (!files?.length || busy) return;
    const data = new FormData();
    Array.from(files).forEach((f) => data.append("images", f));
    data.append("isAi", String(uploadAi));
    setBusy({ title: "이미지 업로드 중", done: 0, total: files.length });
    try {
      const result = await api("/api/assets", data);
      setAssets((a) => [...a, ...result.assets]);
      setSelected(result.assets.map((a) => a.id));
      notify(
        result.errors?.length
          ? `${result.assets.length}개 업로드 · ${result.errors.map((e) => `${e.name}: ${e.error}`).join(", ")}`
          : `${result.assets.length}개의 이미지를 가져왔습니다.`,
        !!result.errors?.length,
      );
    } catch (e) {
      notify(e.message, true);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };
  const work = async (type) => {
    if (!selected.length || busy) return;
    const configReady =
      settings &&
      (settings.provider === "openai"
        ? settings.openaiKeySet
        : settings.geminiKeySet);
    if (type === "generate" && !configReady) {
      setPage("settings");
      notify("이미지를 분석할 AI API 키를 먼저 연결해주세요.");
      return;
    }
    if (
      type === "upscale" &&
      settings?.upscaler === "replicate" &&
      !settings?.replicateKeySet
    ) {
      setPage("settings");
      notify("Real-ESRGAN 실행용 Replicate API 토큰을 연결해주세요.");
      return;
    }
    if (
      type === "upscale" &&
      settings?.upscaler === "replicate" &&
      !window.confirm(
        `선택한 ${selected.length}개 이미지를 Replicate의 Real-ESRGAN 모델로 전송합니다. 유료 API 사용량이 발생하며 복원된 디테일이 원본과 달라질 수 있습니다. 계속할까요?`,
      )
    )
      return;
    cancel.current = false;
    let done = 0,
      failed = 0;
    for (const id of selected) {
      if (cancel.current) break;
      setBusy({
        title:
          type === "generate"
            ? "이미지 분석 · 메타데이터 생성"
            : settings?.upscaler === "local"
              ? "로컬 FSRCNN 복원 중"
              : "Real-ESRGAN 작업 요청",
        done,
        total: selected.length,
      });
      try {
        replace(
          await api(
            `/api/assets/${id}/${type}`,
            type === "upscale" ? { scale } : {},
          ),
        );
      } catch (e) {
        failed++;
        notify(e.message, true);
      }
      done++;
    }
    setBusy(null);
    if (!failed)
      notify(
        type === "generate"
          ? `${done}개 이미지의 메타데이터를 생성했습니다.`
          : settings?.upscaler === "local"
            ? `${done}개 이미지의 로컬 AI 복원을 완료했습니다.`
            : `${done}개 업스케일링 작업을 요청했습니다. 완료까지 잠시 기다려주세요.`,
      );
  };
  const deleteAsset = async (a) => {
    if (!window.confirm(`${a.originalName}과 생성된 결과를 삭제할까요?`))
      return;
    try {
      await api(`/api/assets/${a.id}`, undefined, "DELETE");
      setAssets((list) => list.filter((x) => x.id !== a.id));
      setSelected((list) => list.filter((id) => id !== a.id));
    } catch (e) {
      notify(e.message, true);
    }
  };
  const chosen = assets.filter((a) => selected.includes(a.id));
  const visible = assets.filter(
    (a) =>
      a.originalName.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "ready" && a.metadata) ||
        (filter === "pending" && !a.metadata)),
  );
  const countReady = assets.filter((a) => a.metadata).length;
  const navigation = [
    { id: "library", label: "이미지 라이브러리", icon: Images },
    { id: "metadata", label: "메타데이터", icon: FileText },
    { id: "upscale", label: "AI 업스케일링", icon: Maximize2 },
    { id: "transfer", label: "플랫폼 내보내기", icon: Send },
  ];
  const titles = {
    library: [
      "이미지 라이브러리",
      "아이디어를 담은 이미지, 다음은 판매 준비입니다.",
    ],
    metadata: [
      "메타데이터 스튜디오",
      "이미지를 이해하고, 각 플랫폼의 언어로 정리합니다.",
    ],
    upscale: [
      "작은 디테일까지, 더 선명하게.",
      "학습된 초해상도 모델로 복원하고 원본과 직접 비교하세요.",
    ],
    transfer: [
      "한 번의 준비, 세 개의 플랫폼.",
      "플랫폼별 양식과 파일을 함께 준비하세요.",
    ],
    settings: [
      "나에게 맞는 작업 환경",
      "이미지 분석 AI와 업스케일링, 전송 계정을 연결하세요.",
    ],
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="wordmark"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("library");
          }}
        >
          <span className="logo-glyph">
            <Layers3 size={22} />
          </span>
          stock<span className="wordmark-light">studio</span>
          <span className="beta">BETA</span>
        </a>
        <div className="workspace-label">
          <span className="avatar">W</span>
          <div>
            My workspace<small>개인 크리에이터 공간</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          {navigation.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "active" : ""}
              onClick={() => setPage(n.id)}
            >
              <n.icon size={18} />
              {n.label}
              {n.id === "library" && (
                <span className="nav-count">{assets.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="workflow-note">
            <span className="tiny-spark">
              <Sparkles size={17} />
            </span>
            <strong>창작에 더 집중하세요.</strong>
            <p>
              반복되는 메타데이터 작업은
              <br />
              스튜디오에 맡겨두세요.
            </p>
            <div>
              <i /> YOUR CREATIVE WORKFLOW
            </div>
          </div>
          <button
            className={`settings-nav ${page === "settings" ? "active" : ""}`}
            onClick={() => setPage("settings")}
          >
            <Settings2 size={18} />
            설정 및 API 연결
          </button>
          <div className="local-label">
            <ShieldCheck size={14} />{" "}
            {settings?.publicMode
              ? "브라우저별 개인 작업 공간"
              : "개인용 · 로컬 저장"}
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            Workspace <span>/</span>{" "}
            {page === "settings"
              ? "설정"
              : navigation.find((n) => n.id === page)?.label}
          </div>
          <button
            className="provider-status"
            onClick={() => setPage("settings")}
          >
            <i
              className={
                settings &&
                (settings.provider === "gemini"
                  ? settings.geminiKeySet
                  : settings.openaiKeySet)
                  ? "connected"
                  : ""
              }
            />
            {settings?.provider === "openai" ? "OpenAI" : "Gemini"}{" "}
            {settings &&
            (settings.provider === "gemini"
              ? settings.geminiKeySet
              : settings.openaiKeySet)
              ? "키 저장됨"
              : "키 설정 필요"}
            <Settings2 size={13} />
          </button>
        </header>
        <div className="page">
          <div className="page-heading">
            <div>
              <div className="eyebrow">CREATE. REFINE. SHARE.</div>
              <h1>{titles[page][0]}</h1>
              <p>{titles[page][1]}</p>
            </div>
            {page !== "settings" && (
              <button
                className="button primary"
                onClick={() => input.current.click()}
                disabled={!!busy}
              >
                <Plus size={18} />
                이미지 추가
              </button>
            )}
          </div>
          {settings?.publicMode && (
            <div className="info-bar">
              <ShieldCheck size={17} />
              <span>
                로그인 없이 이용하는 임시 개인 작업 공간입니다. 다른 방문자에게
                이미지가 공개되지 않습니다. 24시간 미사용 또는 서버 재시작 시
                파일·설정이 삭제될 수 있으니 결과를 내려받으세요. AI 분석은
                본인의 API 키를 사용합니다.
              </span>
            </div>
          )}
          <input
            aria-label="이미지 파일 업로드"
            ref={input}
            hidden
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => upload(e.target.files)}
          />
          {page === "settings" ? (
            <Settings
              settings={settings}
              onSave={async (values) => {
                const s = await api("/api/settings", values, "PUT");
                setSettings(s);
                notify("설정을 저장했습니다.");
              }}
              notify={notify}
            />
          ) : (
            <>
              {(page === "library" || page === "metadata") && (
                <div className="stats-row">
                  <Stat
                    label="전체 이미지"
                    value={assets.length.toString().padStart(2, "0")}
                    icon={Images}
                    note="나의 크리에이티브 에셋"
                  />
                  <Stat
                    label="메타데이터 생성"
                    value={countReady.toString().padStart(2, "0")}
                    icon={Sparkles}
                    note="플랫폼별 검토 준비"
                  />
                  <Stat
                    label="연결된 작업 양식"
                    value="03"
                    icon={Layers3}
                    note="Adobe · Freepik · 미리캔버스"
                  />
                </div>
              )}
              {page === "library" && (
                <div
                  className={`dropzone ${drag ? "drag" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDrag(true);
                  }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDrag(false);
                    upload(e.dataTransfer.files);
                  }}
                >
                  <div className="upload-illustration">
                    <div className="mini-photo back" />
                    <div className="mini-photo front">
                      <ImagePlus size={24} />
                    </div>
                    <span>
                      <Plus size={13} />
                    </span>
                  </div>
                  <div>
                    <h3>여기에 이미지를 놓아주세요</h3>
                    <p>
                      또는{" "}
                      <button
                        className="text-link"
                        onClick={() => input.current.click()}
                      >
                        파일 선택
                      </button>
                      으로 시작하세요. JPG, PNG, WebP ·{" "}
                      {settings?.publicMode
                        ? "파일당 10MB · 한 번에 5개 · 입력 6MP 이하"
                        : "파일당 최대 25MB"}
                    </p>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={uploadAi}
                        onChange={(e) => setUploadAi(e.target.checked)}
                      />{" "}
                      새 이미지를 AI 생성 콘텐츠로 표시
                    </label>
                  </div>
                  <span className="drop-tag">
                    BATCH UPLOAD <ArrowRight size={14} />
                  </span>
                </div>
              )}
              {page === "upscale" && (
                <div className="feature-banner">
                  <div className="feature-icon">
                    <Maximize2 size={32} />
                  </div>
                  <div>
                    <span className="eyebrow">
                      {settings?.upscaler === "local"
                        ? "LOCAL FSRCNN · AI SUPER RESOLUTION"
                        : "REAL-ESRGAN · AI SUPER RESOLUTION"}
                    </span>
                    <h2>픽셀 크기를 넘어, 디테일을 복원하세요.</h2>
                    <p>
                      2× · 4× AI 복원, 투명 채널 유지, 원본 보관.
                      <br />
                      {settings?.upscaler === "local"
                        ? "무료 로컬 FSRCNN 모델을 사용합니다. 이미지가 외부로 전송되지 않습니다."
                        : "Replicate의 유료 모델을 사용합니다."}{" "}
                      결과는 원본과 비교해 최종 선택하세요.
                    </p>
                  </div>
                  <div className="scale-selector">
                    {[2, 4].map((s) => (
                      <button
                        className={scale === s ? "active" : ""}
                        onClick={() => setScale(s)}
                        key={s}
                      >
                        {s}×
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {page === "transfer" && (
                <div className="platform-grid">
                  {Object.keys(platforms).map((site) => (
                    <div className="platform-card" key={site}>
                      <PlatformMark site={site} />
                      <h3>{platforms[site].name}</h3>
                      <p>{platforms[site].description}</p>
                      <span className="format-pill">
                        {platforms[site].export}
                      </span>
                      <div className="platform-status">
                        <i className={site === "freepik" ? "connected" : ""} />
                        {site === "freepik"
                          ? "FTPS 파일 전송 · 계정 검증 필요"
                          : "파일·양식 내보내기 지원"}
                      </div>
                      <a
                        href={platforms[site].source}
                        target="_blank"
                        rel="noreferrer"
                      >
                        공식 양식 안내
                        <ArrowUpRight size={14} />
                      </a>
                    </div>
                  ))}
                </div>
              )}
              {page === "transfer" && (
                <div className="info-bar">
                  <AlertCircle size={18} />
                  <span>
                    파일 전송과 심사 제출은 별도입니다. AI 표시·권리 정보 확인과
                    최종 제출은 각 기여자 포털에서 진행하세요.
                  </span>
                </div>
              )}
              <section className="library-section">
                <div className="section-heading">
                  <div>
                    <h2>
                      {page === "upscale"
                        ? "업스케일링할 이미지"
                        : page === "metadata"
                          ? "이미지별 메타데이터"
                          : "내 이미지"}{" "}
                      <span>{assets.length}</span>
                    </h2>
                    <div className="filter-tabs">
                      {[
                        ["all", "전체"],
                        ["ready", "메타데이터 있음"],
                        ["pending", "생성 대기"],
                      ].map(([id, text]) => (
                        <button
                          key={id}
                          className={filter === id ? "active" : ""}
                          onClick={() => setFilter(id)}
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="search">
                    <Search size={16} />
                    <input
                      aria-label="이미지 검색"
                      placeholder="파일명 검색"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                </div>
                <div className="selection-bar">
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={
                        visible.length > 0 &&
                        visible.every((a) => selected.includes(a.id))
                      }
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [
                                ...new Set([
                                  ...selected,
                                  ...visible.map((a) => a.id),
                                ]),
                              ]
                            : selected.filter(
                                (id) => !visible.some((a) => a.id === id),
                              ),
                        )
                      }
                    />
                    {selected.length
                      ? `${selected.length}개 선택됨`
                      : "전체 선택"}
                  </label>
                  <div className="batch-actions">
                    {page === "upscale" ? (
                      <button
                        className="button primary small"
                        disabled={!selected.length || !!busy}
                        onClick={() => work("upscale")}
                      >
                        <Maximize2 size={15} />
                        {scale}× AI 업스케일
                      </button>
                    ) : (
                      <button
                        className="button dark small"
                        disabled={!selected.length || !!busy}
                        onClick={() => work("generate")}
                      >
                        <Sparkles size={15} />
                        메타데이터 생성
                      </button>
                    )}
                    <button
                      className="button small"
                      disabled={!selected.length || !!busy}
                      onClick={() => setExporting(true)}
                    >
                      <Download size={15} />
                      내보내기
                    </button>
                  </div>
                </div>
                {visible.length ? (
                  <div className="image-grid">
                    {visible.map((a) => (
                      <article
                        key={a.id}
                        className={`image-card ${selected.includes(a.id) ? "selected" : ""}`}
                      >
                        <div
                          className="image-stage"
                          onClick={() =>
                            page === "upscale" ? setCompare(a) : setEditing(a)
                          }
                        >
                          <img
                            src={fileUrl(a, "thumb=1")}
                            alt={a.originalName}
                          />
                          <label
                            className="card-checkbox"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              aria-label={`${a.originalName} 선택`}
                              type="checkbox"
                              checked={selected.includes(a.id)}
                              onChange={(e) =>
                                setSelected((p) =>
                                  e.target.checked
                                    ? [...p, a.id]
                                    : p.filter((id) => id !== a.id),
                                )
                              }
                            />
                          </label>
                          {a.isAi && (
                            <span className="ai-badge">
                              <Sparkles size={10} /> AI
                            </span>
                          )}
                          <button
                            className="image-open"
                            aria-label="이미지 비교"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCompare(a);
                            }}
                          >
                            <Maximize2 size={14} />
                          </button>
                          {a.upscale?.status === "processing" && (
                            <div className="processing-overlay">
                              <Loader2 className="spin" />
                              AI 복원 중
                            </div>
                          )}
                        </div>
                        <div className="image-card-body">
                          <h3 title={a.originalName}>{a.originalName}</h3>
                          <p>
                            {a.width} × {a.height}
                            <span>·</span>
                            {size(a.bytes)}
                            {a.hasAlpha && (
                              <span className="alpha-tag">투명</span>
                            )}
                          </p>
                          <div className="card-bottom">
                            <button
                              className={`status-chip ${a.metadata ? "ready" : ""}`}
                              onClick={() => setEditing(a)}
                            >
                              {a.metadata ? (
                                <CheckCircle2 size={12} />
                              ) : (
                                <span className="status-dot" />
                              )}
                              {a.metadata ? "메타데이터 검토" : "생성 대기"}
                            </button>
                            <button
                              className="icon-btn delete"
                              aria-label={`${a.originalName} 삭제`}
                              onClick={() => deleteAsset(a)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          {a.upscale?.status === "succeeded" && (
                            <span className="upscale-note">
                              ↗ {a.upscale.engine || "Real-ESRGAN"}{" "}
                              {a.upscale.scale}× 복원 완료
                            </span>
                          )}
                          {a.upscale?.status === "failed" && (
                            <span className="error-text">
                              업스케일 실패 · 다시 시도 가능
                            </span>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <div className="empty-icon">
                      <Images size={30} />
                    </div>
                    <h3>
                      {assets.length
                        ? "검색 결과가 없습니다"
                        : "첫 번째 이미지를 기다리고 있어요"}
                    </h3>
                    <p>
                      {assets.length
                        ? "검색어나 필터를 변경해주세요."
                        : "이미지를 추가하면 AI가 분석하고, 세 플랫폼에 맞는 메타데이터를 만듭니다."}
                    </p>
                    {!assets.length && (
                      <button
                        className="button"
                        onClick={() => input.current.click()}
                      >
                        <Plus size={16} />
                        이미지 가져오기
                      </button>
                    )}
                  </div>
                )}
              </section>
              <footer className="page-footer">
                <span>
                  <ShieldCheck size={14} /> 원본은 보관하고, 결과는 따로
                  저장합니다.
                </span>
                <span>
                  STOCK STUDIO <span className="footer-dot">·</span> MADE FOR
                  CREATORS
                </span>
              </footer>
            </>
          )}
        </div>
      </main>
      {busy && (
        <div className="progress-float">
          <Loader2 className="spin" size={19} />
          <div>
            <strong>{busy.title}</strong>
            <span>
              {busy.done} / {busy.total} 완료
            </span>
            <div className="progress-track">
              <i
                style={{
                  width: `${busy.total ? (busy.done / busy.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
          <button
            className="text-link"
            onClick={() => {
              cancel.current = true;
              notify("현재 요청 완료 후 멈춥니다.");
            }}
          >
            중지
          </button>
        </div>
      )}
      {toast && (
        <div role="status" className={`toast ${toast.error ? "error" : ""}`}>
          {toast.error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.text}</span>
          <button
            className="icon-btn"
            aria-label="알림 닫기"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {editing && (
        <MetadataEditor
          asset={assets.find((a) => a.id === editing.id) || editing}
          onClose={() => setEditing(null)}
          onSave={async (a, metadata) => {
            const next = await api(
              `/api/assets/${a.id}`,
              { metadata },
              "PATCH",
            );
            replace(next);
            notify("메타데이터를 저장했습니다.");
          }}
          onAiChange={async (a, isAi) => {
            replace(await api(`/api/assets/${a.id}`, { isAi }, "PATCH"));
          }}
          notify={notify}
        />
      )}
      {exporting && (
        <ExportDialog
          assets={chosen}
          settings={settings}
          onClose={() => setExporting(false)}
          notify={notify}
          onTransferred={refresh}
        />
      )}
      {compare && (
        <Compare
          asset={assets.find((a) => a.id === compare.id) || compare}
          onClose={() => setCompare(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, value, icon: Icon, note }) {
  return (
    <div className="stat">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
      <span className="stat-icon">
        <Icon size={19} />
      </span>
    </div>
  );
}

function Settings({ settings, onSave, notify }) {
  const [values, setValues] = useState(null),
    [secrets, setSecrets] = useState({}),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    if (settings)
      setValues({
        provider: settings.provider,
        upscaler: settings.upscaler,
        openaiModel: settings.openaiModel,
        geminiModel: settings.geminiModel,
        ftpHost: settings.ftpHost,
        ftpUser: settings.ftpUser,
        ftpPort: settings.ftpPort,
        ftpMode: settings.ftpMode,
        ftpDirectory: settings.ftpDirectory,
      });
  }, [settings]);
  if (!values)
    return (
      <div className="empty-state">
        <Loader2 className="spin" />
      </div>
    );
  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }));
  const keyField = (name, label, link) => (
    <label className="field">
      {label}
      <div className="key-input">
        <KeyRound size={16} />
        <input
          type="password"
          autoComplete="new-password"
          value={secrets[name] ?? ""}
          placeholder={
            settings[name + "Set"]
              ? "저장됨 · 변경하려면 새 키 입력"
              : "API 키 입력"
          }
          onChange={(e) =>
            setSecrets((v) => ({ ...v, [name]: e.target.value }))
          }
        />
        {settings[name + "Set"] && <CheckCircle2 size={16} />}
      </div>
      <span className="field-help">
        <a href={link} target="_blank" rel="noreferrer">
          키 발급 페이지 ↗
        </a>
        {settings[name + "Set"] && (
          <button
            type="button"
            onClick={() => setSecrets((v) => ({ ...v, [name]: "" }))}
          >
            저장된 키 삭제 예약
          </button>
        )}
        {secrets[name] === "" && <b>저장 시 로컬 키 삭제</b>}
      </span>
    </label>
  );
  return (
    <form
      className="settings-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
          await onSave({ ...values, ...secrets });
          setSecrets({});
        } catch (err) {
          notify(err.message, true);
        } finally {
          setSaving(false);
        }
      }}
    >
      <section className="settings-section">
        <div className="settings-intro">
          <span className="section-number">01</span>
          <h2>이미지 분석 AI</h2>
          <p>
            실제 이미지를 선택한 AI에 전달해
            <br />
            제목과 키워드를 생성합니다.
          </p>
        </div>
        <div className="settings-fields">
          <div className="provider-cards">
            {[
              ["gemini", "Gemini", "Google", Sparkles],
              ["openai", "GPT", "OpenAI", Zap],
            ].map(([id, name, sub, Icon]) => (
              <button
                type="button"
                key={id}
                className={values.provider === id ? "active" : ""}
                onClick={() => set("provider", id)}
              >
                <Icon size={22} />
                <div>
                  <strong>{name}</strong>
                  <small>{sub}</small>
                </div>
                <span className="radio-dot">
                  {values.provider === id && <i />}
                </span>
              </button>
            ))}
          </div>
          <div className="two-fields">
            {keyField(
              "geminiKey",
              "Gemini API 키",
              "https://aistudio.google.com/apikey",
            )}
            <label className="field">
              Gemini 모델
              <input
                value={values.geminiModel}
                onChange={(e) => set("geminiModel", e.target.value)}
                required
              />
              <span className="field-help">
                이미지 입력과 JSON 출력을 지원하는 모델
              </span>
            </label>
            {keyField(
              "openaiKey",
              "OpenAI API 키",
              "https://platform.openai.com/api-keys",
            )}
            <label className="field">
              GPT 모델
              <input
                value={values.openaiModel}
                onChange={(e) => set("openaiModel", e.target.value)}
                required
              />
              <span className="field-help">
                Chat Completions 이미지 입력 지원 모델
              </span>
            </label>
          </div>
          <div className="info-bar">
            <ShieldCheck size={16} />
            <span>
              {settings?.publicMode
                ? "키는 본인 작업 공간에 암호화 저장되며 다른 방문자와 공유되지 않습니다."
                : "키는 서버의 개인 데이터 폴더에 저장되며 브라우저에는 다시 전달하지 않습니다."}{" "}
              모델 사용료는 각 API 계정에 청구됩니다.
            </span>
          </div>
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-intro">
          <span className="section-number">02</span>
          <h2>AI 업스케일링</h2>
          <p>
            학습된 초해상도 모델로
            <br />
            이미지의 디테일을 복원합니다.
          </p>
        </div>
        <div className="settings-fields">
          <label className="field">
            업스케일링 엔진
            <select
              value={values.upscaler}
              onChange={(e) => set("upscaler", e.target.value)}
            >
              <option value="local">로컬 FSRCNN · 무료 · 외부 전송 없음</option>
              <option value="replicate">
                Real-ESRGAN · Replicate 유료 API
              </option>
            </select>
            <span className="field-help">
              로컬 모델:{" "}
              {settings.localUpscaleReady
                ? "설치 완료"
                : "설치 필요 · README 참고"}
            </span>
          </label>
          <div className="model-label">
            <span className="model-symbol">
              <Maximize2 size={20} />
            </span>
            <div>
              <strong>
                {values.upscaler === "local" ? "FSRCNN" : "Real-ESRGAN"}
              </strong>
              <p>
                {values.upscaler === "local"
                  ? "로컬 CPU · 무료"
                  : "Replicate · 유료"}{" "}
                · 2× / 4× · 원본 별도 보관
              </p>
            </div>
            <span className="format-pill">AI MODEL</span>
          </div>
          {keyField(
            "replicateKey",
            "Replicate API 토큰",
            "https://replicate.com/account/api-tokens",
          )}
          <p className="muted small-text">
            두 엔진 모두 학습된 신경망 모델입니다. 투명 채널은 원본에서 고품질
            보간 후 재결합합니다. AI가 복원한 디테일은 원본과 다를 수 있으므로
            비교 화면에서 확인하세요.
          </p>
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-intro">
          <span className="section-number">03</span>
          <h2>프리픽 파일 전송</h2>
          <p>
            프리픽 기여자 계정에서 발급받은
            <br />
            FTP 접속 정보를 입력하세요.
          </p>
        </div>
        <div className="settings-fields">
          <div className="info-bar">
            <AlertCircle size={17} />
            <span>
              공식 FTP 파일 전송을 연결합니다. 이 앱은 TLS가 가능한 FTPS만
              사용하며 계정의 지원 여부를 확인해야 합니다. 최종 심사 제출은
              포털에서 진행하세요.
            </span>
          </div>
          <div className="two-fields">
            <label className="field">
              FTP 호스트
              <input
                value={values.ftpHost}
                onChange={(e) => set("ftpHost", e.target.value)}
                placeholder="기여자 포털에서 제공하는 호스트"
              />
            </label>
            <label className="field">
              사용자 이름
              <input
                autoComplete="off"
                value={values.ftpUser}
                onChange={(e) => set("ftpUser", e.target.value)}
              />
            </label>
            <label className="field">
              FTP 비밀번호
              <input
                type="password"
                autoComplete="new-password"
                value={secrets.ftpPassword ?? ""}
                placeholder={
                  settings.ftpPasswordSet ? "저장됨 · 변경 시 입력" : "비밀번호"
                }
                onChange={(e) =>
                  setSecrets((v) => ({ ...v, ftpPassword: e.target.value }))
                }
              />
            </label>
            <label className="field">
              대상 디렉터리
              <input
                value={values.ftpDirectory}
                onChange={(e) => set("ftpDirectory", e.target.value)}
              />
            </label>
            <label className="field">
              TLS 방식
              <select
                value={values.ftpMode}
                onChange={(e) => set("ftpMode", e.target.value)}
              >
                <option value="explicit">명시적 TLS (FTPS)</option>
                <option value="implicit">암시적 TLS (FTPS)</option>
              </select>
            </label>
            <label className="field">
              포트
              <input
                type="number"
                min="1"
                max="65535"
                value={values.ftpPort}
                onChange={(e) => set("ftpPort", Number(e.target.value))}
              />
            </label>
          </div>
        </div>
      </section>
      <div className="save-settings">
        <span className="muted">
          {settings?.publicMode
            ? "이 브라우저의 쿠키로 작업 공간에 접근합니다. 공용 PC에서는 키를 지우고 쿠키를 삭제해주세요."
            : "개인용 로컬 모드입니다. Render 배포 안내는 docs/render.md를 참고해주세요."}
        </span>
        <button className="button primary" disabled={saving}>
          {saving ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <Check size={16} />
          )}
          설정 저장
        </button>
      </div>
    </form>
  );
}

function MetadataEditor({ asset, onClose, onSave, onAiChange, notify }) {
  const [site, setSite] = useState("adobe"),
    [data, setData] = useState(() =>
      structuredClone(asset.metadata || blankMetadata(asset)),
    ),
    [saving, setSaving] = useState(false),
    [keywordText, setKeywordText] = useState(null);
  const m = data[site],
    p = platforms[site],
    check = validateMetadata(site, m, asset);
  const patch = (values) =>
    setData((d) => ({ ...d, [site]: { ...d[site], ...values } }));
  const changeSite = (id) => {
    setSite(id);
    setKeywordText(null);
  };
  return (
    <Modal
      wide
      title="메타데이터 편집"
      subtitle="플랫폼마다 필요한 정보를 검토하고 다듬으세요."
      onClose={onClose}
    >
      <div className="editor-layout">
        <aside className="editor-image">
          <div className="checker">
            <img src={fileUrl(asset)} alt={asset.originalName} />
          </div>
          <strong>{asset.originalName}</strong>
          <p>
            {asset.width} × {asset.height} · {size(asset.bytes)}
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={asset.isAi}
              onChange={async (e) => {
                const v = e.target.checked;
                try {
                  await onAiChange(asset, v);
                  setData((d) => ({
                    ...d,
                    freepik: {
                      ...d.freepik,
                      keywords: [
                        ...d.freepik.keywords.filter(
                          (k) => k !== "_ai_generated",
                        ),
                        ...(v ? ["_ai_generated"] : []),
                      ],
                    },
                  }));
                } catch (err) {
                  notify(err.message, true);
                }
              }}
            />
            AI 생성 콘텐츠
          </label>
          <small>
            이미지 분석 모델은 제작에 사용한 AI 모델을 알 수 없습니다.
          </small>
          {asset.generatedBy && (
            <div className="generation-source">
              <Sparkles size={13} />
              {asset.generatedBy.model}로 분석
            </div>
          )}
        </aside>
        <div className="editor-form">
          <div className="platform-tabs">
            {Object.keys(platforms).map((id) => (
              <button
                key={id}
                className={site === id ? "active" : ""}
                onClick={() => changeSite(id)}
              >
                <PlatformMark site={id} />
                {platforms[id].name}
              </button>
            ))}
          </div>
          <label className="field">
            {site === "miricanvas" ? "요소 이름" : "제목"}
            <span className="field-counter">
              {m.title.length} / {p.titleMax}
            </span>
            <textarea
              rows="2"
              value={m.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </label>
          <label className="field">
            키워드
            <span className="field-counter">
              {m.keywords.length} / {p.keywordMax}
            </span>
            <textarea
              rows="4"
              value={keywordText ?? m.keywords.join(", ")}
              onChange={(e) => {
                setKeywordText(e.target.value);
                patch({
                  keywords: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                });
              }}
              placeholder="쉼표로 구분해서 입력하세요"
            />
          </label>
          <div className="keyword-chips">
            {m.keywords.slice(0, 12).map((k, i) => (
              <span key={i}>{k}</span>
            ))}
            {m.keywords.length > 12 && <span>+{m.keywords.length - 12}</span>}
          </div>
          {site === "adobe" && (
            <label className="field">
              카테고리
              <select
                value={m.category}
                onChange={(e) => patch({ category: Number(e.target.value) })}
              >
                {categories.map((c, i) => (
                  <option key={c} value={i + 1}>
                    {i + 1}. {c}
                  </option>
                ))}
              </select>
            </label>
          )}
          {site === "freepik" && (
            <div className="two-fields">
              <label className="field">
                실제 제작 모델 (선택)
                <input
                  value={m.model}
                  onChange={(e) => patch({ model: e.target.value })}
                  placeholder="기여자 목록과 동일한 모델명"
                />
              </label>
              <label className="field">
                실제 제작 프롬프트 (선택)
                <textarea
                  value={m.prompt}
                  onChange={(e) => patch({ prompt: e.target.value })}
                  placeholder="원본 프롬프트만 입력 · 추정하지 않음"
                />
              </label>
            </div>
          )}
          {site === "miricanvas" && (
            <div className="two-fields">
              <label className="field">
                콘텐츠 타입
                <select
                  value={m.contentType}
                  onChange={(e) => patch({ contentType: e.target.value })}
                >
                  {contentTypes.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                라이선스
                <select
                  value={m.tier}
                  onChange={(e) => patch({ tier: e.target.value })}
                >
                  <option value="Premium">Premium · 유료</option>
                  <option value="Standard">Standard · 무료</option>
                </select>
              </label>
            </div>
          )}
          <div className="validation">
            {check.errors.map((e) => (
              <p className="error-text" key={e}>
                <AlertCircle size={13} />
                {e}
              </p>
            ))}
            {check.warnings.map((w) => (
              <p key={w}>
                <AlertCircle size={13} />
                {w}
              </p>
            ))}
            {!check.errors.length && (
              <p className="success-text">
                <CheckCircle2 size={13} />
                필수 메타데이터 형식을 충족합니다.
              </p>
            )}
          </div>
          <a
            className="source-link"
            href={p.source}
            target="_blank"
            rel="noreferrer"
          >
            공식 메타데이터 작성 가이드 <ExternalLink size={12} />
          </a>
          <div className="editor-footer">
            <button
              className="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    `${m.title}\n${m.keywords.join(", ")}`,
                  );
                  notify("제목과 키워드를 복사했습니다.");
                } catch {
                  notify("브라우저에서 클립보드 접근을 허용해주세요.", true);
                }
              }}
            >
              <Copy size={15} />
              복사
            </button>
            <button
              className="button primary"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await onSave(asset, data);
                } catch (e) {
                  notify(e.message, true);
                } finally {
                  setSaving(false);
                }
              }}
            >
              <Check size={16} />
              변경 저장
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ExportDialog({ assets, settings, onClose, notify, onTransferred }) {
  const [site, setSite] = useState("adobe"),
    [includeImages, setIncludeImages] = useState(true),
    [working, setWorking] = useState(false),
    [ack, setAck] = useState(false);
  const issues = assets.flatMap((a) =>
    validateMetadata(site, a.metadata?.[site], a).errors.map(
      (e) => `${a.originalName}: ${e}`,
    ),
  );
  const download = async () => {
    setWorking(true);
    try {
      const r = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Stock-Studio": "1" },
        body: JSON.stringify({
          site,
          ids: assets.map((a) => a.id),
          includeImages,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      const url = URL.createObjectURL(await r.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = `${site}-${includeImages ? "package.zip" : site === "miricanvas" ? "metadata.xlsx" : "metadata.csv"}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      notify("내보내기를 완료했습니다.");
    } catch (e) {
      notify(e.message, true);
    } finally {
      setWorking(false);
    }
  };
  const transfer = async () => {
    setWorking(true);
    try {
      const r = await api("/api/transfer/freepik", {
        ids: assets.map((a) => a.id),
      });
      notify(
        r.results.some((x) => x.status === "failed")
          ? "일부 파일 전송이 실패했습니다. 포털과 전송 설정을 확인해주세요."
          : r.message,
        r.results.some((x) => x.status === "failed"),
      );
      await onTransferred();
    } catch (e) {
      notify(e.message, true);
      await onTransferred();
    } finally {
      setWorking(false);
    }
  };
  return (
    <Modal
      title="플랫폼으로 내보내기"
      subtitle={`${assets.length}개 이미지 · 사이트별 파일명과 메타데이터를 함께 준비합니다.`}
      onClose={onClose}
    >
      <div className="export-body">
        <div className="platform-tabs">
          {Object.keys(platforms).map((id) => (
            <button
              key={id}
              className={site === id ? "active" : ""}
              onClick={() => {
                setSite(id);
                setAck(false);
              }}
            >
              <PlatformMark site={id} />
              {platforms[id].name}
            </button>
          ))}
        </div>
        <div className="export-summary">
          <FileText size={28} />
          <div>
            <strong>
              {site === "miricanvas"
                ? "한국어 XLSX 스프레드시트"
                : site === "freepik"
                  ? "세미콜론 CSV + IPTC 메타데이터"
                  : "Adobe Stock CSV"}
            </strong>
            <p>
              {site === "miricanvas"
                ? "fileName · uniqueId · elementName · keywords · tier · contentType"
                : site === "freepik"
                  ? "File name · Title · Keywords · Prompt · Model"
                  : "Filename · Title · Keywords · Category · Releases"}
            </p>
          </div>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={includeImages}
            onChange={(e) => setIncludeImages(e.target.checked)}
          />
          이미지와 메타데이터를 ZIP 패키지로 내보내기
        </label>
        <p className="muted small-text">
          파일명 매칭을 위해 패키지 안의 이미지 이름을 그대로 사용하세요.{" "}
          {site === "freepik" &&
            "이미지는 JPEG로 변환되며 투명 배경은 흰색으로 채워집니다."}
          {site === "miricanvas" &&
            "uniqueId 없이 고유 파일명으로 연결합니다. 일반 화면 입력은 1~8개, CSV는 최대 25개 키워드 안내를 따릅니다."}
        </p>
        {issues.length > 0 && (
          <div className="export-issues">
            {issues.slice(0, 6).map((e, i) => (
              <p key={i}>
                <AlertCircle size={14} />
                {e}
              </p>
            ))}
            {issues.length > 6 && (
              <p>외 {issues.length - 6}개 항목 · 메타데이터를 수정해주세요.</p>
            )}
          </div>
        )}
        <div className="info-bar">
          <AlertCircle size={16} />
          <span>
            AI 생성 표시와 최종 승인 요청은 포털에서 확인해야 합니다. 내보내기는
            심사 제출을 완료하지 않습니다.
          </span>
        </div>
        <button
          className="button primary full-width"
          disabled={working || !!issues.length}
          onClick={download}
        >
          {working ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <Download size={16} />
          )}
          내보내기
        </button>
        {site === "freepik" && (
          <div className="ftp-export">
            <h3>
              <Send size={16} />
              프리픽으로 파일 전송
            </h3>
            <p>
              공식 FTP 방식으로 JPEG와 CSV를 전송합니다. 실제 계정 검증이 필요한
              연동이며 TLS 미지원 서버는 연결되지 않습니다.
            </p>
            <label className="check-label">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              프리픽 계정으로 실제 파일을 전송합니다. 최종 제출은 직접
              진행합니다.
            </label>
            <button
              className="button full-width"
              disabled={
                !settings?.ftpPasswordSet ||
                !settings?.ftpHost ||
                !ack ||
                working ||
                !!issues.length
              }
              onClick={transfer}
            >
              <UploadCloud size={16} />
              FTPS 전송 시작
            </button>
            {!settings?.ftpPasswordSet && (
              <small>설정에서 FTP 계정을 먼저 연결해주세요.</small>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Compare({ asset, onClose }) {
  const [position, setPosition] = useState(50),
    [zoom, setZoom] = useState(false);
  return (
    <Modal
      wide
      title="원본과 결과 비교"
      subtitle="슬라이더를 움직여 디테일을 확인하세요. 확대하면 실제 픽셀 크기로 볼 수 있습니다."
      onClose={onClose}
    >
      <div className="compare-body">
        <div className="compare-controls">
          <span>
            원본 {asset.originalWidth} × {asset.originalHeight}
          </span>
          <button className="button small" onClick={() => setZoom(!zoom)}>
            <Maximize2 size={14} />
            {zoom ? "화면에 맞추기" : "100% 픽셀 보기"}
          </button>
          <span>
            현재 {asset.width} × {asset.height}
          </span>
        </div>
        <div className={`compare-scroll ${zoom ? "zoom" : ""}`}>
          <div
            className="compare-stage checker"
            style={
              zoom
                ? { width: asset.width, height: asset.height }
                : { aspectRatio: `${asset.width}/${asset.height}` }
            }
          >
            <img src={fileUrl(asset)} alt="처리 결과" />
            <img
              className="compare-original"
              src={fileUrl(asset, "original=1")}
              alt="보관된 원본"
              style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
            />
            <div className="compare-divider" style={{ left: `${position}%` }}>
              <span>↔</span>
            </div>
            <span className="before-label">원본</span>
            <span className="after-label">
              {asset.upscale?.status === "succeeded"
                ? "AI 복원 결과"
                : "현재 이미지"}
            </span>
          </div>
        </div>
        <input
          className="compare-range"
          aria-label="원본 결과 비교 위치"
          type="range"
          min="0"
          max="100"
          value={position}
          onChange={(e) => setPosition(Number(e.target.value))}
        />
        <div className="compare-footer">
          <span>
            {asset.upscale?.status === "succeeded"
              ? "색상·윤곽·텍스트·투명 경계를 확인하세요. AI 복원이 품질 향상을 보장하지는 않습니다."
              : "아직 AI 업스케일링을 실행하지 않은 이미지입니다."}
          </span>
          <a className="button" href={fileUrl(asset, "download=source")}>
            <Download size={14} />
            업로드 원본
          </a>
          <a className="button primary" href={fileUrl(asset, "download=1")}>
            <Download size={14} />
            현재 이미지
          </a>
        </div>
      </div>
    </Modal>
  );
}
