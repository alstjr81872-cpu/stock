"use client";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Cloud as CloudCheck,
  Download,
  FileText,
  Feather,
  GitBranch,
  Info,
  Layers,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { api, send, modules, statuses, date, download } from "@/lib/api";
import { Badge, Empty, Modal, useActions } from "./workspace";
import { Button } from "./ui/button";
import WritingRoom from "./writing-room";
export default function ProjectView({
  id,
  styles,
  back,
}: {
  id: string;
  styles: any[];
  back: () => void;
}) {
  const { run, busy, askAI, notify, refresh, canLeave } = useActions();
  const [p, setP] = useState<any>(null),
    [tab, setTab] = useState("brief"),
    [section, setSection] = useState("concept"),
    [answers, setAnswers] = useState<Record<string, string>>({}),
    [confirm, setConfirm] = useState(false),
    [plotConfirm, setPlotConfirm] = useState(false),
    [jsonPlot, setJsonPlot] = useState<string | null>(null),
    [prompt, setPrompt] = useState<any>(null),
    [analysisEdit, setAnalysisEdit] = useState<string | null>(null);
  async function load() {
    const data = await api("/projects/" + id);
    setP(data);
    setAnswers(data.answers || {});
  }
  useEffect(() => {
    run(load);
  }, [id]);
  async function action(path: string, data: any, method = "POST") {
    const result = await send("/projects/" + id + path, data, method);
    setP(result);
    await refresh();
    return result;
  }
  async function generate(path: string, scope: string) {
    const max = await askAI(scope);
    if (max === null) return;
    await action(path, {
      revision: p.revision,
      consent: true,
      maxCostUsd: max,
    });
    notify("생성 결과를 서버에 저장했습니다. 직접 검수해주세요.");
  }
  if (!p)
    return (
      <div className="loading-page">
        <Loader2 className="spin" />
        작품을 불러오는 중…
      </div>
    );
  const steps = [
    { key: "brief", title: "아이디어 · 인터뷰", icon: FileText },
    { key: "bible", title: "작품 기획서", icon: BookOpen },
    { key: "plot", title: "스토리 설계", icon: GitBranch },
    { key: "writing", title: "집필실", icon: Feather },
  ];
  const doneSections = Object.keys(p.bible || {}).length;
  const mapped = new Set(
    Object.values(p.bible || {}).flatMap((s: any) => s.requirementIds),
  );
  return (
    <>
      <button
        className="back-link"
        onClick={async () => {
          if (await canLeave()) back();
        }}
      >
        <ArrowLeft size={15} />내 작품으로
      </button>
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">
            PROJECT WORKSPACE <span>/ {p.genre}</span>
          </div>
          <h1>{p.title}</h1>
          <p>
            <Badge tone={p.status === "ACTIVE" ? "green" : "purple"}>
              {statuses[p.status]}
            </Badge>
            <span className="inline-meta">
              캐논 v{p.canonVersion} · 문서 r{p.revision} · {date(p.updatedAt)}
            </span>
          </p>
        </div>
        <div className="button-row">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              run(async () => {
                const blob = await api<Blob>("/projects/" + id + "/export");
                download(blob, "novelforge-" + id + ".zip");
              })
            }
          >
            <Download size={15} />
            전체 내보내기
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="작품 새로고침"
            onClick={() => run(load)}
          >
            <Undo2 size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={p.deletedAt ? "작품 복원" : "휴지통으로 이동"}
            onClick={() =>
              run(async () => {
                if (
                  !window.confirm(
                    p.deletedAt
                      ? "작품을 복원할까요?"
                      : "작품을 휴지통으로 이동할까요? 영구 삭제하지 않습니다.",
                  )
                )
                  return;
                await action(p.deletedAt ? "/restore" : "/trash", {
                  revision: p.revision,
                });
                notify(
                  p.deletedAt
                    ? "작품을 복원했습니다."
                    : "작품을 휴지통으로 옮겼습니다.",
                );
              })
            }
          >
            {p.deletedAt ? <Undo2 size={16} /> : <Trash2 size={16} />}
          </Button>
        </div>
      </div>
      {p.deletedAt ? (
        <Empty
          title="휴지통에 보관된 작품입니다"
          description="위의 복원 버튼으로 작품과 원고를 되돌릴 수 있습니다. 자동 영구 삭제는 하지 않습니다."
        />
      ) : (
        <>
          <div className="workflow-steps">
            {steps.map((s, i) => (
              <button
                className={tab === s.key ? "selected" : ""}
                key={s.key}
                onClick={async () => {
                  if (await canLeave()) setTab(s.key);
                }}
              >
                <span className="step-icon">
                  <s.icon size={17} />
                </span>
                <span>
                  <small>STEP 0{i + 1}</small>
                  {s.title}
                </span>
                {i < 3 && <ChevronRight size={15} />}
              </button>
            ))}
          </div>
          {tab === "brief" && (
            <div className="workspace-columns">
              <section>
                <div className="panel">
                  <div className="panel-heading">
                    <h2>
                      <FileText size={18} />
                      원본 아이디어
                    </h2>
                    <Badge>{p.brief.encoding.toUpperCase()}</Badge>
                  </div>
                  <pre className="source-text">{p.brief.text}</pre>
                  <div className="source-footer">
                    <ShieldCheck size={14} />
                    원문 보존 · SHA-256 검증 · {p.requirements.length}개 원문
                    구간
                  </div>
                </div>
                <div className="panel">
                  <div className="panel-heading">
                    <h2>요구사항 추적표</h2>
                    <small>원문 줄 단위 · 삭제 불가</small>
                  </div>
                  <div className="trace-list">
                    {p.requirements.map((r: any) => (
                      <div key={r.id}>
                        <code>{r.id}</code>
                        <p>{r.text}</p>
                        <Badge tone={mapped.has(r.id) ? "green" : ""}>
                          {mapped.has(r.id) ? "기획 반영" : "반영 대기"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
              <section className="panel interview-panel">
                <div className="panel-heading">
                  <h2>
                    <Sparkles size={18} />
                    작품 인터뷰
                  </h2>
                  <Badge tone="purple">작가의 결정</Badge>
                </div>
                {!p.analysis ? (
                  <Empty
                    title="이야기에 꼭 필요한 질문부터"
                    description="원문을 분석해 중요한 미결정 사항을 묻습니다. 답변 전에는 핵심 설정을 확정하지 않습니다."
                  >
                    <Button
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          generate(
                            "/analyze",
                            "원문 TXT와 요구사항을 분석하고 5~8개의 핵심 질문을 생성합니다.",
                          ),
                        )
                      }
                    >
                      <Sparkles size={16} />
                      원문 분석 · 질문 만들기
                    </Button>
                  </Empty>
                ) : (
                  <>
                    <div className="analysis-summary">
                      <p>{p.analysis.summary}</p>
                      <h4>로그라인 제안</h4>
                      {p.analysis.loglines.map((l: string, i: number) => (
                        <p key={i} className="logline">
                          <span>0{i + 1}</span>
                          {l}
                        </p>
                      ))}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setAnalysisEdit(JSON.stringify(p.analysis, null, 2))
                        }
                      >
                        분석 · 미정 · 충돌 직접 편집
                      </Button>
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        run(async () => {
                          await action(
                            "/answers",
                            { revision: p.revision, answers },
                            "PUT",
                          );
                          notify("인터뷰 답변을 서버에 저장했습니다.");
                        });
                      }}
                    >
                      <div className="questions">
                        {p.analysis.questions.map((q: any, i: number) => (
                          <div className="question" key={q.id}>
                            <span className="question-index">
                              Q{String(i + 1).padStart(2, "0")}
                            </span>
                            <label>
                              {q.question}
                              {q.blocks_stage && <small>필수 결정</small>}
                              <span className="field-hint">{q.rationale}</span>
                              <div className="option-chips">
                                {q.options
                                  .filter((o: string) => o !== "직접 입력")
                                  .map((o: string) => (
                                    <button
                                      className={
                                        answers[q.id] === o ? "chosen" : ""
                                      }
                                      type="button"
                                      key={o}
                                      onClick={() =>
                                        setAnswers({ ...answers, [q.id]: o })
                                      }
                                    >
                                      {o}
                                    </button>
                                  ))}
                              </div>
                              <textarea
                                rows={2}
                                placeholder="선택하거나 직접 답변하세요. 보류하면 승인 전 해결해야 합니다."
                                value={answers[q.id] || ""}
                                onChange={(e) =>
                                  setAnswers({
                                    ...answers,
                                    [q.id]: e.target.value,
                                  })
                                }
                              />
                            </label>
                          </div>
                        ))}
                      </div>
                      <Button type="submit" disabled={busy}>
                        <CloudCheck size={16} />
                        답변 저장
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setTab("bible")}
                      >
                        기획서로
                        <ArrowRight size={15} />
                      </Button>
                    </form>
                  </>
                )}
              </section>
            </div>
          )}
          {tab === "bible" && (
            <>
              <div className="bible-top">
                <div>
                  <h2>한 세계의 설계도</h2>
                  <p className="muted">
                    각 모듈을 구체화하고 검수하세요. 미정과 충돌은 승인 전에
                    해결합니다.
                  </p>
                </div>
                <Badge tone="purple">{doneSections} / 11 모듈</Badge>
              </div>
              <div className="bible-layout">
                <aside className="bible-toc">
                  {Object.entries(modules).map(([key, label], i) => (
                    <button
                      className={section === key ? "active" : ""}
                      key={key}
                      onClick={() => setSection(key)}
                    >
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      {label}
                      {p.bible[key] ? (
                        p.bible[key].needsReview ? (
                          <TriangleAlert size={14} />
                        ) : (
                          <Check size={14} />
                        )
                      ) : (
                        <span className="toc-dot" />
                      )}
                    </button>
                  ))}
                </aside>
                <section className="panel bible-document">
                  <div className="panel-heading">
                    <h2>{modules[section]}</h2>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || !p.analysis}
                      onClick={() =>
                        run(() =>
                          generate(
                            "/sections/" + section + "/generate",
                            `${modules[section]} 모듈을 생성합니다. 원문 요구, 인터뷰 답변, 다른 모듈의 요약을 전송합니다.`,
                          ),
                        )
                      }
                    >
                      <Sparkles size={14} />
                      {p.bible[section] ? "다시 생성" : "모듈 생성"}
                    </Button>
                  </div>
                  {p.bible[section] ? (
                    <SectionForm
                      key={section + "-" + p.revision}
                      value={p.bible[section]}
                      requirements={p.requirements}
                      onSave={async (value) => {
                        await action(
                          "/sections/" + section,
                          { revision: p.revision, section: value },
                          "PUT",
                        );
                        notify(
                          "모듈을 저장했습니다. 다른 모듈에 미치는 영향을 검토하세요.",
                        );
                      }}
                      onReviewed={async () => {
                        await action("/sections/" + section + "/reviewed", {
                          revision: p.revision,
                          confirmed: true,
                        });
                        notify("변경 영향 검토를 기록했습니다.");
                      }}
                    />
                  ) : (
                    <Empty
                      title="아직 쓰이지 않은 설계도"
                      description="인터뷰 답변을 저장한 뒤 모듈을 생성하세요. 직접 검수하고 고칠 수 있습니다."
                    />
                  )}
                </section>
                <aside className="approval-rail">
                  <div className="panel">
                    <h3>
                      <Feather size={17} />
                      작품 문체
                    </h3>
                    <p className="muted">
                      승인된 라이브러리 버전을 복사해 고정합니다.
                    </p>
                    <select
                      aria-label="작품 문체 선택"
                      value={p.styleBinding?.styleId || ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value)
                          run(async () => {
                            await action("/style", {
                              revision: p.revision,
                              styleId: value,
                            });
                            notify("문체 버전을 고정했습니다.");
                          });
                      }}
                      disabled={busy}
                    >
                      <option value="">승인된 문체 선택</option>
                      {styles
                        .filter((s) => s.status === "approved")
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} · v{s.profileVersion}
                          </option>
                        ))}
                    </select>
                    {p.styleBinding && (
                      <p className="pinned-style">
                        <ShieldCheck size={14} />
                        {p.styleBinding.snapshot.name} v
                        {p.styleBinding.pinnedVersion}
                      </p>
                    )}
                  </div>
                  <div className="panel">
                    <h3>
                      <ShieldCheck size={17} />
                      독립 교차 검토
                    </h3>
                    <p className="muted">
                      인물·세계관·장기 서사·문체의 연결과 미정을 확인합니다.
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || doneSections !== 11}
                      onClick={() =>
                        run(() =>
                          generate(
                            "/bible/review",
                            "11개 기획 모듈과 원문 요구, 답변, 승인 문체를 독립 검토 역할에 전달해 설정 충돌과 장기 지속 가능성을 검사합니다.",
                          ),
                        )
                      }
                    >
                      <Sparkles size={14} />
                      최신 기획 교차 검토
                    </Button>
                    {p.bibleAudit && (
                      <div className="audit-result">
                        <p>{p.bibleAudit.summary}</p>
                        {p.bibleAudit.unresolvedDecisions.map(
                          (u: string, i: number) => (
                            <p className="warning-box" key={i}>
                              {u}
                            </p>
                          ),
                        )}
                        {p.bibleAudit.findings.map((f: any) => (
                          <div className="finding" key={f.id}>
                            <Badge tone="amber">
                              {f.severity} · {modules[f.section]}
                            </Badge>
                            <p>{f.rationale}</p>
                            <small>근거: {f.evidence}</small>
                            {f.resolution ? (
                              <p className="muted">해결: {f.resolution}</p>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  run(async () => {
                                    const resolution = window.prompt(
                                      "이 문제를 어떻게 검수·해결했는지 근거를 10자 이상 기록하세요. 실제 설정 변경이 필요하면 모듈을 수정하고 재검토하세요.",
                                    );
                                    if (!resolution) return;
                                    await action("/bible/review/resolve", {
                                      revision: p.revision,
                                      confirmed: true,
                                      findingId: f.id,
                                      resolution,
                                    });
                                  })
                                }
                              >
                                검수 · 결정 근거 기록
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="panel registration-panel">
                    <Badge tone="purple">REGISTRATION GATE</Badge>
                    <h3>
                      작품의 시작은
                      <br />
                      작가의 승인으로.
                    </h3>
                    <ul className="check-list">
                      <li className={doneSections === 11 ? "done" : ""}>
                        <CheckCircle2 size={15} />
                        11개 기획 모듈 작성
                      </li>
                      <li
                        className={
                          mapped.size === p.requirements.length ? "done" : ""
                        }
                      >
                        <CheckCircle2 size={15} />
                        원문 요구사항 모두 반영
                      </li>
                      <li className={p.styleBinding ? "done" : ""}>
                        <CheckCircle2 size={15} />
                        문체 버전 고정
                      </li>
                    </ul>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={confirm}
                        onChange={(e) => setConfirm(e.target.checked)}
                      />
                      원문·설정·미정 해결·게시 규정을 검수했습니다. 등록을
                      승인합니다.
                    </label>
                    <Button
                      disabled={!confirm || busy || p.status === "ACTIVE"}
                      onClick={() =>
                        run(async () => {
                          await action("/approve", {
                            revision: p.revision,
                            confirmed: true,
                          });
                          notify(
                            "작품 등록을 승인했습니다. 이제 플롯을 설계하세요.",
                          );
                          setTab("plot");
                        })
                      }
                    >
                      <ShieldCheck size={15} />
                      {p.status === "ACTIVE"
                        ? "등록된 작품"
                        : "기획 승인 · 작품 등록"}
                    </Button>
                    <small className="muted">
                      등록 후에도 기획서 수정이 가능합니다. 변경 시 플롯
                      재승인이 필요합니다.
                    </small>
                  </div>
                </aside>
              </div>
            </>
          )}
          {tab === "plot" && (
            <>
              <div className="section-heading">
                <div>
                  <h2>사건에서 선택으로, 선택에서 이야기로</h2>
                  <p className="muted">
                    장기 방향은 느슨하게, 첫 회차는 장면 단위로.
                  </p>
                </div>
                <Button
                  disabled={busy || p.status !== "ACTIVE"}
                  onClick={() =>
                    run(() =>
                      generate(
                        "/plot/generate",
                        "승인 기획서와 문체를 바탕으로 장기 방향과 1화의 2~6개 장면을 설계합니다.",
                      ),
                    )
                  }
                >
                  <Sparkles size={16} />
                  {p.plot ? "플롯 다시 설계" : "첫 회차 설계"}
                </Button>
              </div>
              {p.status !== "ACTIVE" && (
                <div className="info-note">
                  <Info size={18} />
                  먼저 작품 기획서와 문체를 승인해 작품을 등록하세요.
                </div>
              )}
              {!p.plot ? (
                <Empty
                  title="플롯이 집필의 나침반이 됩니다"
                  description="사건의 원인과 결과, 인물의 감정, 독자에게 줄 보상을 함께 설계합니다."
                />
              ) : (
                <>
                  <div className="panel plot-overview">
                    <div className="panel-heading">
                      <h2>장기 방향</h2>
                      <Badge
                        tone={p.plot.status === "APPROVED" ? "green" : "amber"}
                      >
                        {statuses[p.plot.status]}
                      </Badge>
                    </div>
                    <p>{p.plot.direction}</p>
                    <div className="arcs">
                      {p.plot.arcs.map((a: any, i: number) => (
                        <div key={i}>
                          <span>ARC {String(i + 1).padStart(2, "0")}</span>
                          <h3>{a.title}</h3>
                          {Object.entries(a)
                            .filter(([k]) => k !== "title")
                            .map(([k, v]) => (
                              <p key={k}>{String(v)}</p>
                            ))}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="section-heading">
                    <h2>제1화 · {p.plot.chapterTitle}</h2>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        const {
                          status,
                          version,
                          canonVersion,
                          run,
                          approvedAt,
                          approvedBy,
                          styleVersion,
                          ...draft
                        } = p.plot;
                        setJsonPlot(JSON.stringify(draft, null, 2));
                      }}
                    >
                      플롯 직접 편집
                    </Button>
                  </div>
                  <div className="scene-grid">
                    {p.plot.scenes.map((s: any, i: number) => (
                      <div className="panel scene-card" key={s.id}>
                        <span className="eyebrow">
                          SCENE {String(i + 1).padStart(2, "0")}
                        </span>
                        <h3>{s.title}</h3>
                        <Badge>{s.pov}</Badge>
                        <dl>
                          <dt>시작 상태</dt>
                          <dd>{s.startState}</dd>
                          <dt>목표 · 행동</dt>
                          <dd>
                            {s.goal}
                            <br />
                            {s.action}
                          </dd>
                          <dt>결과 · 인과 근거</dt>
                          <dd>
                            {s.endState}
                            <br />
                            {s.causalEvidence}
                          </dd>
                          <dt>독자 보상</dt>
                          <dd>{s.readerPayoff}</dd>
                          <dt>목표 분량</dt>
                          <dd>
                            공백 제외 약 {s.targetChars.toLocaleString()}자
                          </dd>
                        </dl>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={p.plot.status !== "APPROVED"}
                          onClick={() =>
                            run(async () =>
                              setPrompt(
                                await api(
                                  "/projects/" + id + "/prompt/" + s.id,
                                ),
                              ),
                            )
                          }
                        >
                          <Layers size={14} />
                          최종 프롬프트 미리보기
                        </Button>
                      </div>
                    ))}
                  </div>
                  {(p.plot.risks.length > 0 ||
                    p.plot.openQuestions.length > 0) && (
                    <div className="warning-box">
                      {[...p.plot.risks, ...p.plot.openQuestions].map(
                        (s: string, i: number) => (
                          <p key={i}>{s}</p>
                        ),
                      )}
                    </div>
                  )}
                  <div className="panel approve-plot">
                    <div>
                      <h3>이 플롯으로 집필할 준비가 되었나요?</h3>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={plotConfirm}
                          onChange={(e) => setPlotConfirm(e.target.checked)}
                        />
                        인과·관계 진전·미정과 위험을 검수하고 현재 플롯을
                        승인합니다.
                      </label>
                    </div>
                    <Button
                      disabled={
                        busy || !plotConfirm || p.plot.status === "APPROVED"
                      }
                      onClick={() =>
                        run(async () => {
                          await action("/plot/approve", {
                            revision: p.revision,
                            confirmed: true,
                          });
                          notify("상세 플롯을 승인했습니다.");
                          setTab("writing");
                        })
                      }
                    >
                      <Check size={16} />
                      {p.plot.status === "APPROVED"
                        ? "승인된 플롯"
                        : "플롯 승인 · 집필실로"}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
          {tab === "writing" && (
            <WritingRoom project={p} reloadProject={load} />
          )}
        </>
      )}
      {analysisEdit !== null && (
        <Modal
          title="원문 분석 검수"
          wide
          onClose={() => setAnalysisEdit(null)}
        >
          <div className="modal-body">
            <p className="muted">
              원문 추적표는 그대로 보존됩니다. 중요한 미결정 사항은 답변으로
              확정하고 충돌을 해소한 근거를 요약에 기록하세요.
            </p>
            <textarea
              rows={20}
              className="code-input"
              value={analysisEdit}
              onChange={(e) => setAnalysisEdit(e.target.value)}
            />
            <Button
              onClick={() =>
                run(async () => {
                  await action(
                    "/analysis",
                    {
                      revision: p.revision,
                      analysis: JSON.parse(analysisEdit),
                    },
                    "PUT",
                  );
                  setAnalysisEdit(null);
                  notify("분석을 저장했습니다. 변경 영향을 검토하세요.");
                })
              }
            >
              분석 검수 저장
            </Button>
          </div>
        </Modal>
      )}
      {jsonPlot !== null && (
        <Modal title="상세 플롯 편집" wide onClose={() => setJsonPlot(null)}>
          <div className="modal-body">
            <p className="muted">
              JSON 스키마를 서버에서 검증합니다. 수정 후 현재 구간을 다시
              승인해야 합니다.
            </p>
            <textarea
              className="code-input"
              rows={22}
              value={jsonPlot}
              onChange={(e) => setJsonPlot(e.target.value)}
            />
            <Button
              onClick={() =>
                run(async () => {
                  await action(
                    "/plot",
                    { revision: p.revision, plot: JSON.parse(jsonPlot) },
                    "PUT",
                  );
                  setJsonPlot(null);
                  notify("플롯을 저장했습니다. 다시 검수·승인하세요.");
                })
              }
            >
              플롯 저장
            </Button>
          </div>
        </Modal>
      )}
      {prompt && (
        <Modal title="최종 집필 프롬프트" wide onClose={() => setPrompt(null)}>
          <div className="modal-body">
            <p className="muted">
              공통 규칙 → 문체 → 캐논 → 플롯 → 직전 원고 → 현재 장면. 실제 호출
              전에 모델 문맥 한도를 검사합니다.
            </p>
            <pre>{JSON.stringify(prompt, null, 2)}</pre>
          </div>
        </Modal>
      )}
    </>
  );
}
const fieldLabels: Record<string, string> = {
  content: "상세 기획",
  rules_and_causes: "구체적 규칙 · 인과",
  scene_example: "실제 장면의 가능성",
  reader_payoff: "독자의 기대 · 보상",
  connections: "다른 모듈과 연결",
  risks: "예외 · 실패 위험",
};
function SectionForm({
  value,
  requirements,
  onSave,
  onReviewed,
}: {
  value: any;
  requirements: any[];
  onSave: (v: any) => Promise<void>;
  onReviewed: () => Promise<void>;
}) {
  const { busy, run } = useActions();
  const [draft, setDraft] = useState<any>(() =>
    Object.fromEntries(
      [
        ...Object.keys(fieldLabels),
        "requirementIds",
        "openQuestions",
        "conflicts",
      ].map((k) => [k, value[k]]),
    ),
  );
  return (
    <form
      className="section-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => onSave(draft));
      }}
    >
      {value.needsReview && (
        <div className="warning-box">
          <p>다른 설정이 변경되었습니다. 연결과 인과를 다시 검토하세요.</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => run(onReviewed)}
          >
            변경 영향 검토 완료
          </Button>
        </div>
      )}
      {Object.entries(fieldLabels).map(([k, label]) => (
        <label key={k}>
          {label}
          <textarea
            required
            minLength={k === "content" ? 60 : k === "risks" ? 5 : 10}
            rows={k === "content" ? 12 : 3}
            value={draft[k] || ""}
            onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
          />
        </label>
      ))}
      <fieldset className="requirement-field">
        <legend>반영한 원문 요구사항</legend>
        <div className="requirement-checks">
          {requirements.map((r) => (
            <label className="checkbox" key={r.id}>
              <input
                type="checkbox"
                checked={draft.requirementIds.includes(r.id)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    requirementIds: e.target.checked
                      ? [...draft.requirementIds, r.id]
                      : draft.requirementIds.filter(
                          (id: string) => id !== r.id,
                        ),
                  })
                }
              />
              <code>{r.id}</code>
              {r.text}
            </label>
          ))}
        </div>
      </fieldset>
      {[
        ["openQuestions", "미정 · 사용자 선택 필요"],
        ["conflicts", "설정 충돌"],
      ].map(([k, label]) => (
        <label key={k}>
          {label}
          <textarea
            rows={2}
            value={draft[k].join("\n")}
            placeholder="해결되지 않은 항목은 줄바꿈으로 기록합니다. 남아 있으면 승인이 차단됩니다."
            onChange={(e) =>
              setDraft({
                ...draft,
                [k]: e.target.value.split("\n").filter(Boolean),
              })
            }
          />
        </label>
      ))}
      <div className="button-row">
        <Button type="submit" disabled={busy}>
          <CloudCheck size={16} />이 모듈 저장
        </Button>
        <span className="muted">다른 섹션의 원문은 보존됩니다.</span>
      </div>
    </form>
  );
}
