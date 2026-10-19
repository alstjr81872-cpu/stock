"use client";
import { useEffect, useState, useRef, createContext, useContext } from "react";
import {
  BookOpen,
  Feather,
  LayoutDashboard,
  Library,
  Settings2,
  ChevronRight,
  Plus,
  ArrowUpRight,
  Cloud as CloudCheck,
  LogOut,
  Sparkles,
  Command,
  Menu,
  X,
  Loader2,
  ShieldCheck,
  Check,
  AlertCircle,
  Coins,
  History,
  Trash2,
  ArrowLeft,
  FolderOpen,
  PenLine,
  Activity,
} from "lucide-react";
import {
  currentUser,
  watchAuth,
  login,
  logout,
  developmentLogin,
  emulator,
  type User,
} from "@/lib/auth";
import { api, send, date, statuses, download } from "@/lib/api";
import { Button } from "./ui/button";
import ProjectView from "./project-view";
import StyleLibrary from "./style-library";
import SettingsView from "./settings-view";

type Context = {
  mode?: string;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  askAI: (
    scope: string,
    request?: { path: string; data: Record<string, unknown> },
  ) => Promise<number | null>;
  notify: (s: string) => void;
  refresh: () => Promise<void>;
  canLeave: () => Promise<boolean>;
  registerLeave: (fn: () => Promise<boolean>) => () => void;
};
const Actions = createContext<Context>(null!);
export const useActions = () => useContext(Actions);
export function Badge({
  children,
  tone = "",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Feather size={28} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className={"modal " + (wide ? "modal-wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="닫기">
            <X size={19} />
          </Button>
        </header>
        {children}
      </section>
    </div>
  );
}

export default function Workspace() {
  const [user, setUser] = useState<User | null>(null),
    [initializing, setInitializing] = useState(true),
    [tab, setTab] = useState("home"),
    [projects, setProjects] = useState<any[]>([]),
    [styles, setStyles] = useState<any[]>([]),
    [me, setMe] = useState<any>(null),
    [selected, setSelected] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [creating, setCreating] = useState(false),
    [mobile, setMobile] = useState(false);
  const [aiDialog, setAiDialog] = useState<{
      scope: string;
      quote?: any;
      resolve: (v: number | null) => void;
    } | null>(null),
    [cost, setCost] = useState("0.15"),
    [agree, setAgree] = useState(false);
  const authUid = useRef<string | null>(null);
  const mounted = useRef(true);
  const running = useRef(false);
  const leaveGuard = useRef<(() => Promise<boolean>) | null>(null);
  async function canLeave() {
    return leaveGuard.current ? await leaveGuard.current() : true;
  }
  function registerLeave(fn: () => Promise<boolean>) {
    leaveGuard.current = fn;
    return () => {
      if (leaveGuard.current === fn) leaveGuard.current = null;
    };
  }
  useEffect(() => {
    mounted.current = true;
    let stop = () => {};
    try {
      stop = watchAuth((u) => {
        if (authUid.current !== (u?.uid || null)) {
          setProjects([]);
          setStyles([]);
          setMe(null);
          setSelected(null);
          setCreating(false);
          setTab("home");
          leaveGuard.current = null;
        }
        authUid.current = u?.uid || null;
        setUser(u);
        setInitializing(false);
      }, setError);
    } catch {
      setError("로그인 연결 설정이 필요합니다. 배포 안내를 확인하세요.");
      setInitializing(false);
    }
    return () => {
      mounted.current = false;
      stop();
    };
  }, []);
  useEffect(() => {
    const closeMenu = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobile(false);
    };
    window.addEventListener("keydown", closeMenu);
    return () => window.removeEventListener("keydown", closeMenu);
  }, []);
  async function refresh() {
    const requestedUid = currentUser()?.uid;
    const [p, s, m] = await Promise.all([
      api("/projects"),
      api("/styles"),
      api("/me"),
    ]);
    if (mounted.current && requestedUid === currentUser()?.uid) {
      setProjects(p);
      setStyles(s);
      setMe(m);
    }
  }
  useEffect(() => {
    if (user) refresh().catch((e) => setError(e.message));
  }, [user]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const off = () =>
      setError("오프라인입니다. 서버에 저장되지 않은 편집을 확인하세요.");
    window.addEventListener("offline", off);
    return () => window.removeEventListener("offline", off);
  }, []);
  async function run(fn: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청에 실패했습니다.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function askAI(
    scope: string,
    request?: { path: string; data: Record<string, unknown> },
  ) {
    setAgree(false);
    let quote: any;
    if (me?.mode === "supabase" && request) {
      quote = await api(request.path, {
        method: "POST",
        headers: { "X-NF-Preflight": "1" },
        body: JSON.stringify({
          ...request.data,
          consent: false,
          maxCostUsd: 5,
        }),
      });
      if (!quote.estimateOnly)
        throw new Error("작업 비용 사전 계산에 실패했습니다.");
    }
    setCost(quote ? String(quote.suggestedMaxCostUsd) : "0.15");
    return new Promise<number | null>((resolve) =>
      setAiDialog({ scope, quote, resolve }),
    );
  }
  function aiClose(value: number | null) {
    aiDialog?.resolve(value);
    setAiDialog(null);
  }
  async function navigate(t: string) {
    if (!(await canLeave())) return;
    setTab(t);
    setSelected(null);
    setMobile(false);
  }
  async function openProject(id: string) {
    if (!(await canLeave())) return;
    setSelected(id);
    setTab("projects");
  }
  const nav = [
    { id: "home", label: "홈", icon: LayoutDashboard },
    { id: "projects", label: "내 작품", icon: BookOpen },
    { id: "styles", label: "문체 라이브러리", icon: Feather },
    { id: "jobs", label: "작업 기록", icon: Activity },
  ];
  if (initializing)
    return (
      <div className="loading-page">
        <Loader2 className="spin" /> 작업 공간을 준비하고 있습니다.
      </div>
    );
  if (!user)
    return (
      <div className="landing">
        <div className="landing-glow" />
        <div className="landing-nav">
          <Brand />
          <a href="#home-features" className="landing-explore">
            기능 살펴보기 <ArrowUpRight size={16} />
          </a>
        </div>
        <main>
          <Badge tone="purple">
            <Sparkles size={13} /> 당신의 이야기를 위한 창작 워크스페이스
          </Badge>
          <h1>
            마음속의 이야기를,
            <br />
            <em>한 편의 작품으로.</em>
          </h1>
          <p>
            기획과 문체, 인물의 기억부터 마지막 문장까지.
            <br />
            작가의 선택을 존중하는 AI와 함께 써 내려가세요.
          </p>
          <Button onClick={() => run(login)} disabled={busy}>
            <GoogleIcon /> Google 계정으로 시작하기 <ArrowUpRight size={18} />
          </Button>
          {emulator && (
            <Button
              variant="secondary"
              onClick={() => run(developmentLogin)}
              disabled={busy}
            >
              로컬 개발 계정으로 둘러보기
            </Button>
          )}
          <small>
            작품은 로그인 계정의 서비스 저장소에 보관됩니다.
            <br />
            Google Drive나 기기 폴더에 자동 저장하지 않습니다.
          </small>
          {emulator && (
            <div className="dev-notice">
              로컬 Emulator · 개발용 AI 응답 · 실제 Google/AI 연결 아님
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          <div className="landing-features">
            <span>
              <BookOpen />
              깊이 있는 작품 기획
            </span>
            <span>
              <Feather />
              나만의 문체 라이브러리
            </span>
            <span>
              <ShieldCheck />
              단계별 승인과 버전 복구
            </span>
          </div>
        </main>
        <section
          id="home-features"
          className="landing-programs"
          aria-labelledby="landing-programs-title"
        >
          <div className="section-heading">
            <div>
              <div className="eyebrow">
                ONE SPACE. EVERY PART OF YOUR STORY.
              </div>
              <h2 id="landing-programs-title">창작에 필요한 도구를, 한곳에.</h2>
              <p className="muted">
                떠오른 생각을 다듬는 순간부터 마지막 문장을 고치는 순간까지.
              </p>
            </div>
          </div>
          <ToolCards preview onSelect={() => run(login)} />
          <div className="landing-process">
            <span>
              01 <b>아이디어와 기획</b>
            </span>
            <ChevronRight size={17} />
            <span>
              02 <b>문체와 플롯</b>
            </span>
            <ChevronRight size={17} />
            <span>
              03 <b>집필과 검토</b>
            </span>
            <ChevronRight size={17} />
            <span>
              04 <b>저장과 복구</b>
            </span>
          </div>
        </section>
        <footer>
          NovelForge AI <span>당신의 세계, 당신의 문장.</span>
        </footer>
      </div>
    );
  return (
    <Actions.Provider
      value={{
        busy,
        run,
        mode: me?.mode,
        askAI,
        notify: setToast,
        refresh,
        canLeave,
        registerLeave,
      }}
    >
      <div className="app-shell">
        {mobile && (
          <button
            className="sidebar-scrim"
            aria-label="메뉴 닫기"
            onClick={() => setMobile(false)}
          />
        )}
        <aside className={"sidebar " + (mobile ? "sidebar-open" : "")}>
          <button
            className="sidebar-close"
            aria-label="사이드 메뉴 닫기"
            onClick={() => setMobile(false)}
          >
            <X size={18} />
          </button>
          <Brand />
          <div className="workspace-label">PERSONAL WORKSPACE</div>
          <nav>
            {nav.map((n) => (
              <button
                key={n.id}
                className={tab === n.id ? "nav-item active" : "nav-item"}
                onClick={() => navigate(n.id)}
              >
                <n.icon size={19} />
                {n.label}
                {n.id === "projects" && (
                  <small>{projects.filter((p) => !p.deletedAt).length}</small>
                )}
              </button>
            ))}
          </nav>
          <div className="sidebar-projects">
            <p>
              작업 중인 작품{" "}
              <button aria-label="새 작품" onClick={() => setCreating(true)}>
                <Plus size={16} />
              </button>
            </p>
            {projects
              .filter((p) => !p.deletedAt)
              .slice(0, 5)
              .map((p) => (
                <button
                  key={p.id}
                  className="mini-project"
                  onClick={() => openProject(p.id)}
                >
                  <span className="project-dot" />
                  {p.title}
                </button>
              ))}
            {!projects.filter((p) => !p.deletedAt).length && (
              <span className="sidebar-hint">첫 이야기를 시작해보세요.</span>
            )}
          </div>
          <div className="sidebar-bottom">
            <div className="quiet-card">
              <Sparkles size={18} />
              <p>
                좋은 이야기는
                <br />
                <strong>당신의 선택에서 시작됩니다.</strong>
              </p>
            </div>
            <button
              className={"nav-item " + (tab === "settings" ? "active" : "")}
              onClick={() => navigate("settings")}
            >
              <Settings2 size={19} />
              모델 · 사용량 설정
            </button>
            <div className="user-block">
              <div className="avatar">
                {(user.displayName || user.email || "N")[0].toUpperCase()}
              </div>
              <div>
                <strong>{user.displayName || "나의 작업실"}</strong>
                <small>{user.email}</small>
              </div>
              <button
                aria-label="로그아웃"
                onClick={() =>
                  run(async () => {
                    if (!(await canLeave())) return;
                    if (
                      !window.confirm(
                        "로그아웃할까요? 이 브라우저의 로그인 상태를 지웁니다.",
                      )
                    )
                      return;
                    await logout();
                  })
                }
              >
                <LogOut size={17} />
              </button>
            </div>
          </div>
        </aside>
        <div className="main-wrap">
          <header className="topbar">
            <div>
              <button
                className="mobile-toggle"
                aria-label="메뉴"
                onClick={() => setMobile(!mobile)}
              >
                <Menu />
              </button>
              <span>내 작업 공간</span>
              <ChevronRight size={14} />
              <strong>
                {selected
                  ? "작품 워크스페이스"
                  : tab === "settings"
                    ? "모델 · 사용량 설정"
                    : nav.find((n) => n.id === tab)?.label}
              </strong>
            </div>
            <div className="topbar-right">
              <span className="sync-status">
                <CloudCheck size={16} />
                {busy ? "작업 중…" : "계정 연결됨"}
              </span>
              <span className="profile-dot">
                {(user.displayName || "N")[0]}
              </span>
            </div>
          </header>
          {me && ["emulator", "test-adapter"].includes(me.mode) && (
            <div className="emulator-bar">
              <span />
              {me.mode === "test-adapter"
                ? "자동 테스트 · 메모리 저장소"
                : "로컬 개발 환경"}{" "}
              <b>Firebase Emulator</b>
              <span className="bar-divider" />
              AI 응답:{" "}
              {me.aiMode === "mock"
                ? "개발용 응답 · 실제 생성 아님"
                : "OpenRouter 실제 호출"}
            </div>
          )}
          {error && (
            <div className="error-banner global-error" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button aria-label="오류 닫기" onClick={() => setError("")}>
                <X size={18} />
              </button>
            </div>
          )}
          <main className="content">
            {tab === "home" &&
              (me ? (
                <Dashboard
                  projects={projects}
                  styles={styles}
                  onCreate={() => setCreating(true)}
                  onOpen={openProject}
                  onStyles={() => navigate("styles")}
                  onProjects={() => navigate("projects")}
                  onSettings={() => navigate("settings")}
                  onJobs={() => navigate("jobs")}
                />
              ) : (
                <div className="loading-page" role="status">
                  <Loader2 className="spin" />
                  나의 작업 공간을 불러오고 있어요.
                </div>
              ))}
            {tab === "projects" &&
              (selected ? (
                <ProjectView
                  id={selected}
                  styles={styles}
                  back={() => {
                    setSelected(null);
                    refresh();
                  }}
                />
              ) : (
                <ProjectList
                  projects={projects}
                  onOpen={openProject}
                  onCreate={() => setCreating(true)}
                />
              ))}
            {tab === "styles" && <StyleLibrary styles={styles} />}
            {tab === "settings" && <SettingsView me={me} />}
            {tab === "jobs" && <JobHistory />}
          </main>
          <footer className="app-footer">
            <span>NovelForge AI</span>
            <span>당신의 세계, 당신의 문장.</span>
            <span>
              <ShieldCheck size={12} />
              계정별 독립 저장
            </span>
          </footer>
        </div>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
      {busy && (
        <div className="working-indicator" role="status">
          <Loader2 className="spin" size={17} />
          작업을 처리하고 있습니다. AI 요청 중에는 페이지를 유지해주세요.
        </div>
      )}
      {creating && (
        <CreateProject
          close={() => setCreating(false)}
          done={(p) => {
            setCreating(false);
            refresh();
            openProject(p.id);
          }}
        />
      )}
      {aiDialog && (
        <Modal title="AI 작업 실행 확인" onClose={() => aiClose(null)}>
          <div className="modal-body">
            <Badge tone="purple">
              <Sparkles size={13} />
              {me?.aiMode === "mock"
                ? "개발용 응답 · 비용 없음"
                : "OpenRouter 실제 요청"}
            </Badge>
            <p className="consent-scope">{aiDialog.scope}</p>
            <p className="muted">
              관련 기획·원문·문체·원고 일부가 선택 모델에 전달됩니다. 제공자별
              보관 정책이 다를 수 있습니다. 요청당 최대 추정 비용을 예약하며,
              응답이 불명확하면 자동 재요청하지 않습니다.
            </p>
            <label>
              {aiDialog.quote
                ? "이번 작업 비용 상한 · 자동 계산 (USD)"
                : "요청 1회당 최대 비용 (USD)"}
              <input
                type="number"
                min="0.001"
                max="5"
                step="0.000001"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </label>
            {aiDialog.quote && (
              <p className="field-hint">
                {aiDialog.quote.model} · 남은 앱 월 예산 $
                {aiDialog.quote.remainingMonthlyUsd.toFixed(4)}. 실제 비용은
                사용량에 따라 정산하며, 사전 계산에는 유료 생성 요청이 없습니다.
              </p>
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
              />
              전송 범위와 실행 한도를 확인했습니다.
            </label>
            <Button
              disabled={!agree || Number(cost) <= 0 || Number(cost) > 5}
              onClick={() => aiClose(Number(cost))}
            >
              <Sparkles size={16} />
              확인하고 실행
            </Button>
            <small className="muted">
              이미 제출된 외부 요청은 취소·환불을 보장하지 않습니다.
            </small>
          </div>
        </Modal>
      )}
    </Actions.Provider>
  );
}
function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <Feather size={22} />
      </div>
      <span>
        NovelForge<span className="brand-ai">AI</span>
      </span>
    </div>
  );
}
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.6 12.2c0-.7-.1-1.5-.2-2.2H12v4.2h5.4a4.6 4.6 0 0 1-2 3V20h3.2c1.9-1.8 3-4.4 3-7.8M12 22c2.7 0 5-1 6.6-2.8l-3.2-2.5c-.9.6-2 1-3.4 1a6 6 0 0 1-5.7-4.2H3v2.6A10 10 0 0 0 12 22M6.3 13.5A6 6 0 0 1 6 12c0-.5.1-1 .3-1.5V7.9H3A10 10 0 0 0 2 12c0 1.6.4 3 1 4.1M12 6.3c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.5 9.5 0 0 0 12 2a10 10 0 0 0-9 5.9l3.3 2.6A6 6 0 0 1 12 6.3"
      />
    </svg>
  );
}
const homeTools = [
  {
    id: "planning",
    title: "새 작품 기획",
    subtitle: "흩어진 생각을 하나의 세계로",
    description:
      "아이디어를 올리고, 질문에 답하며 작품의 뼈대를 단단하게 만들어보세요.",
    icon: Sparkles,
    tone: "violet",
    action: "새 기획 시작",
    number: "01",
  },
  {
    id: "styles",
    title: "문체 라이브러리",
    subtitle: "나만의 목소리를 발견하는 곳",
    description:
      "문장의 호흡과 감정의 거리를 정리하고, 나에게 맞는 문체를 보관하세요.",
    icon: Feather,
    tone: "mint",
    action: "문체 살펴보기",
    number: "02",
  },
  {
    id: "writing",
    title: "내 작품 · 집필실",
    subtitle: "다음 문장을 써 내려갈 시간",
    description:
      "기획부터 원고까지 한곳에서 이어 쓰고, 저장한 이전 버전도 다시 만나보세요.",
    icon: BookOpen,
    tone: "peach",
    action: "작업 공간 열기",
    number: "03",
  },
  {
    id: "settings",
    title: "모델 · 예산 설정",
    subtitle: "나의 작업에 맞는 AI 선택",
    description:
      "역할에 맞는 모델을 고르고, 사용량과 실행 예산을 편하게 관리하세요.",
    icon: Settings2,
    tone: "blue",
    action: "설정 살펴보기",
    number: "04",
  },
];

function ToolCards({
  onSelect,
  preview = false,
}: {
  onSelect: (id: string) => void;
  preview?: boolean;
}) {
  return (
    <div className="tool-grid">
      {homeTools.map((tool) => (
        <button
          key={tool.id}
          className={"tool-card tool-" + tool.tone}
          aria-label={tool.title + " 열기"}
          onClick={() => onSelect(tool.id)}
        >
          <div className="tool-card-top">
            <span className="tool-icon">
              <tool.icon size={25} strokeWidth={1.7} />
            </span>
            <span className="tool-number">{tool.number}</span>
          </div>
          <h3>{tool.title}</h3>
          <span className="tool-subtitle">{tool.subtitle}</span>
          <p>{tool.description}</p>
          <div className="tool-card-footer">
            <span>{preview ? "로그인하고 시작하기" : tool.action}</span>
            <ArrowUpRight size={19} />
          </div>
        </button>
      ))}
    </div>
  );
}

function Dashboard({
  projects,
  styles,
  onCreate,
  onOpen,
  onStyles,
  onProjects,
  onSettings,
  onJobs,
}: any) {
  const active = projects.filter((p: any) => !p.deletedAt);
  const handlers: Record<string, () => void> = {
    planning: onCreate,
    styles: onStyles,
    writing: onProjects,
    settings: onSettings,
  };
  return (
    <div className="home-dashboard">
      <div className="page-heading home-heading">
        <div>
          <div className="eyebrow">
            <span className="welcome-line" />
            YOUR CREATIVE SPACE
          </div>
          <h1>
            이야기를 이어갈 시간이에요<span className="title-dot">.</span>
          </h1>
          <p>
            오늘은 어떤 세계를 만들어볼까요? 당신의 다음 문장을 기다리고 있어요.
          </p>
        </div>
        <span className="today">
          {new Date().toLocaleDateString("ko-KR", {
            month: "long",
            day: "numeric",
            weekday: "long",
            timeZone: "Asia/Seoul",
          })}
        </span>
      </div>
      <section className="hero-card home-hero">
        <div className="hero-content">
          <Badge>
            <span className="tiny-star">✧</span> A LITTLE IDEA. AN ENTIRE WORLD.
          </Badge>
          <h2>
            한 줄의 상상에서,
            <br />
            <span>당신만의 세계로.</span>
          </h2>
          <p>
            기획하고, 문체를 찾고, 한 장면씩 써 내려가세요.
            <br className="desktop-only" />
            이야기의 모든 순간에 작가의 선택이 중심이 됩니다.
          </p>
          <div className="hero-buttons">
            <Button onClick={onCreate}>
              <Plus size={19} />새 작품 기획하기
              <ArrowUpRight size={18} />
            </Button>
            <Button variant="ghost" onClick={onProjects}>
              내 작품 이어 쓰기
              <ChevronRight size={17} />
            </Button>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <span className="orbit orbit-1" />
          <span className="orbit orbit-2" />
          <div className="floating-note note-1">
            <span />
            <span />
            <span />
          </div>
          <div className="art-book">
            <div className="book-spine" />
            <Feather size={57} strokeWidth={1} />
            <span>
              NOVEL
              <br />
              FORGE
            </span>
            <small>YOUR STORY BEGINS HERE</small>
          </div>
          <span className="art-spark s1">✦</span>
          <span className="art-spark s2">✧</span>
          <div className="floating-note note-2">
            <Feather size={19} />
            <span />
            <span />
          </div>
          <span className="hero-art-caption">THE NEXT CHAPTER IS YOURS</span>
        </div>
      </section>
      <section className="home-tools" aria-labelledby="tools-title">
        <div className="section-heading">
          <div>
            <div className="eyebrow">MADE FOR YOUR NEXT CHAPTER</div>
            <h2 id="tools-title">무엇부터 시작할까요?</h2>
          </div>
          <span className="section-note">아이디어부터 마지막 문장까지</span>
        </div>
        <ToolCards onSelect={(id) => handlers[id]()} />
      </section>
      <section className="home-projects" aria-labelledby="stories-title">
        <div className="section-heading">
          <div>
            <div className="eyebrow">YOUR STORIES</div>
            <h2 id="stories-title">
              나의 이야기 <span>{active.length}</span>
            </h2>
          </div>
          <Button variant="ghost" onClick={onProjects}>
            전체 작품 보기
            <ArrowUpRight size={17} />
          </Button>
        </div>
        {active.length ? (
          <div className="project-grid">
            {active.slice(0, 3).map((p: any, i: number) => (
              <ProjectCard
                key={p.id}
                project={p}
                index={i}
                onOpen={() => onOpen(p.id)}
              />
            ))}
            <button className="new-project-card" onClick={onCreate}>
              <span>
                <Plus size={25} />
              </span>
              <strong>새로운 세계 만들기</strong>
              <small>다음 이야기는 여기서 시작됩니다</small>
            </button>
          </div>
        ) : (
          <Empty
            title="첫 번째 이야기의 자리를 비워두었어요"
            description="짧은 TXT 아이디어 하나면 충분해요. 기획부터 차근차근 함께 시작합니다."
          >
            <Button variant="secondary" onClick={onCreate}>
              <Plus size={18} />첫 작품 만들기
            </Button>
          </Empty>
        )}
      </section>
      <section className="home-summary" aria-label="작업 공간 현황">
        <div className="summary-heading">
          <span className="tool-icon">
            <Library size={21} />
          </span>
          <div>
            <h3>조금씩 쌓이는 나의 세계</h3>
            <p>계정에 저장된 작업 공간 현황이에요.</p>
          </div>
        </div>
        <div className="summary-counts">
          <div>
            <strong>{active.length}</strong>
            <span>전체 작품</span>
          </div>
          <div>
            <strong>
              {active.filter((p: any) => p.status !== "ACTIVE").length}
            </strong>
            <span>기획 중</span>
          </div>
          <div>
            <strong>
              {styles.filter((s: any) => s.status === "approved").length}
            </strong>
            <span>승인된 문체</span>
          </div>
        </div>
        <Button variant="ghost" onClick={onJobs}>
          작업 기록
          <History size={18} />
        </Button>
      </section>
      <div className="home-note">
        <ShieldCheck size={17} />
        <p>
          이야기의 결정권은 언제나 작가에게. 기획과 플롯을 승인한 뒤에만 AI
          집필이 시작됩니다.
        </p>
      </div>
    </div>
  );
}

function ProjectCard({ project: p, index, onOpen }: any) {
  return (
    <button className="project-card" onClick={onOpen}>
      <div className={"project-cover cover-" + (index % 4)}>
        <div className="cover-grid" />
        <BookOpen size={36} strokeWidth={1} />
        <span>{p.genre || "새로운 세계"}</span>
      </div>
      <div className="project-card-body">
        <Badge tone={p.status === "ACTIVE" ? "green" : "purple"}>
          {statuses[p.status] || p.status}
        </Badge>
        <h3>{p.title}</h3>
        <p>
          {p.genre || "장르 미정"}
          <span>·</span>캐논 v{p.canonVersion || 0}
        </p>
        <footer>
          <span>{date(p.updatedAt)}</span>
          <ChevronRight size={17} />
        </footer>
      </div>
    </button>
  );
}
function ProjectList({ projects, onOpen, onCreate }: any) {
  const [trash, setTrash] = useState(false);
  const list = projects.filter((p: any) => Boolean(p.deletedAt) === trash);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MY STORIES</div>
          <h1>내 작품</h1>
          <p>작은 아이디어와 완성될 세계를 한곳에서.</p>
        </div>
        <Button onClick={onCreate}>
          <Plus size={17} />새 작품
        </Button>
      </div>
      <div className="tabs">
        <button
          className={!trash ? "active" : ""}
          onClick={() => setTrash(false)}
        >
          전체 작품
        </button>
        <button
          className={trash ? "active" : ""}
          onClick={() => setTrash(true)}
        >
          <Trash2 size={15} />
          휴지통
        </button>
      </div>
      {list.length ? (
        <div className="project-grid">
          {list.map((p: any, i: number) => (
            <ProjectCard
              key={p.id}
              project={p}
              index={i}
              onOpen={() => onOpen(p.id)}
            />
          ))}
        </div>
      ) : (
        <Empty
          title={
            trash ? "휴지통이 비어 있습니다" : "아직 등록된 이야기가 없어요"
          }
          description={
            trash
              ? "휴지통의 작품은 자동으로 영구 삭제하지 않습니다."
              : "TXT 기획 파일로 첫 작품을 만들어보세요."
          }
        >
          {!trash && <Button onClick={onCreate}>새 작품 만들기</Button>}
        </Empty>
      )}
    </>
  );
}
function CreateProject({
  close,
  done,
}: {
  close: () => void;
  done: (p: any) => void;
}) {
  const { run, busy, notify } = useActions();
  const [title, setTitle] = useState(""),
    [genre, setGenre] = useState("현대 판타지"),
    [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  return (
    <Modal title="새로운 이야기의 시작" onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            if (!file) return;
            const form = new FormData();
            form.set("title", title);
            form.set("genre", genre);
            form.set("file", file);
            const p = await api("/projects", { method: "POST", body: form });
            notify("원문을 보존하고 새 기획을 만들었습니다.");
            done(p);
          });
        }}
      >
        <div className="modal-body">
          <p className="muted">
            장르, 콘셉트, 주요 스토리, 원하는 화수를 TXT에 담아주세요. 원문은
            수정하지 않고 보존합니다.
          </p>
          <label>
            작품 가제
            <input
              required
              maxLength={100}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="어떤 이야기인가요?"
            />
          </label>
          <label>
            장르
            <select value={genre} onChange={(e) => setGenre(e.target.value)}>
              {[
                "현대 판타지",
                "아카데미",
                "무협",
                "로맨스",
                "러브 코미디",
                "미스터리",
                "SF",
                "기타 · 미정",
              ].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label
            className={"dropzone " + (drag ? "dragover" : "")}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              setFile(e.dataTransfer.files[0] || null);
            }}
          >
            <BookOpen size={28} />
            <strong>{file ? file.name : "아이디어 TXT를 놓아주세요"}</strong>
            <span>또는 클릭해서 파일 선택 · UTF-8 / CP949 · 최대 4만 자</span>
            <input
              type="file"
              accept=".txt,text/plain"
              aria-label="아이디어 TXT 파일"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          <div className="info-note">
            <ShieldCheck size={17} />
            <span>
              생성된 기획서는 초안입니다. 승인 전에는 작품이 등록되거나 원고가
              작성되지 않습니다.
            </span>
          </div>
          <Button type="submit" disabled={!title.trim() || !file || busy}>
            <Plus size={17} />
            기획 초안 만들기
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function JobHistory() {
  const { run } = useActions();
  const [jobs, setJobs] = useState<any[]>([]),
    [detail, setDetail] = useState<any>(null);
  useEffect(() => {
    run(async () => setJobs(await api("/jobs")));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ACTIVITY</div>
          <h1>작업 기록</h1>
          <p>완료된 응답과 미확정 요청을 구분해 확인합니다.</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => run(async () => setJobs(await api("/jobs")))}
        >
          새로고침
        </Button>
      </div>
      {!jobs.length ? (
        <Empty
          title="아직 AI 작업이 없습니다"
          description="기획·문체·집필 작업을 시작하면 기록이 쌓입니다."
        />
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>작업</th>
                <th>모델</th>
                <th>상태</th>
                <th>실행 시각</th>
                <th>응답</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>{j.task}</td>
                  <td>{j.model}</td>
                  <td>
                    <Badge tone={j.status === "COMPLETED" ? "green" : "amber"}>
                      {j.status}
                    </Badge>
                  </td>
                  <td>{date(j.createdAt)}</td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        run(async () => setDetail(await api("/jobs/" + j.id)))
                      }
                    >
                      상세보기
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detail && (
        <Modal title="작업 체크포인트" wide onClose={() => setDetail(null)}>
          <div className="modal-body">
            <p>작업 ID: {detail.id}</p>
            <p className="muted">
              저장된 응답을 확인할 수 있습니다. 실패한 작업을 자동 재요청하지
              않습니다.
            </p>
            <pre>{JSON.stringify(detail, null, 2)}</pre>
          </div>
        </Modal>
      )}
    </>
  );
}
