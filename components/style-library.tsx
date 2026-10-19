"use client";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Copy,
  Feather,
  FileText,
  Library,
  MessageCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  Upload,
  Trash2,
  Download,
} from "lucide-react";
import { api, send, statuses, date, download } from "@/lib/api";
import { Badge, Empty, Modal, useActions } from "./workspace";
import { Button } from "./ui/button";
const names: Record<string, string> = {
  interview: "AI 인터뷰",
  guide: "집필 가이드",
  reference: "참고 작품",
};
const labels: Record<string, string> = {
  perspective: "서술 시점",
  narrative_distance: "서술 거리",
  sentence_rhythm: "문장 호흡",
  diction: "어휘",
  dialogue_rules: "대사 규칙",
  description_rules: "묘사 규칙",
  humor_engine: "유머",
  emotional_engine: "감정선",
  pacing: "전개 속도",
  action_choreography: "전투 · 행동",
  intimacy_policy: "관계 · 표현 경계",
  genre_expectations: "장르 보상",
  taboo_and_avoid: "금지 사항",
};
export default function StyleLibrary({ styles }: { styles: any[] }) {
  const { run, busy, askAI, notify, refresh } = useActions();
  const [creating, setCreating] = useState(false),
    [mode, setMode] = useState("interview"),
    [name, setName] = useState(""),
    [notes, setNotes] = useState(""),
    [selected, setSelected] = useState<any>(null),
    [variant, setVariant] = useState("A"),
    [agree, setAgree] = useState(false),
    [rights, setRights] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [edit, setEdit] = useState<string | null>(null),
    [answers, setAnswers] = useState<Record<string, string>>({});
  async function update(result: any) {
    setSelected(result);
    await refresh();
  }
  async function open(s: any) {
    setSelected(await api("/styles/" + s.id));
    setAnswers(s.interviewAnswers || {});
    setNotes(s.notes || "");
    setVariant(s.selectedVariant || "A");
    setAgree(false);
  }
  async function generate(path: string, scope: string) {
    const max = await askAI(scope);
    if (max === null) return;
    await update(
      await send("/styles/" + selected.id + path, {
        revision: selected.revision,
        consent: true,
        maxCostUsd: max,
      }),
    );
    notify("문체 작업 결과를 저장했습니다.");
  }
  if (selected)
    return (
      <>
        <button className="back-link" onClick={() => setSelected(null)}>
          <ArrowLeft size={15} />
          문체 라이브러리
        </button>
        <div className="page-heading compact">
          <div>
            <div className="eyebrow">
              STYLE WORKSPACE <span>/ {names[selected.sourceType]}</span>
            </div>
            <h1>{selected.name}</h1>
            <p>
              <Badge tone={selected.status === "approved" ? "green" : "purple"}>
                {statuses[selected.status]}
              </Badge>
              <span className="inline-meta">
                프로필 v{selected.profileVersion} · 문서 r{selected.revision}
              </span>
            </p>
          </div>
          <div className="button-row">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                run(async () => {
                  await api("/styles/" + selected.id + "/duplicate", {
                    method: "POST",
                    body: JSON.stringify({ revision: selected.revision }),
                  });
                  await refresh();
                  notify("새 초안으로 복제했습니다.");
                })
              }
            >
              <Copy size={15} />
              복제
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                download(
                  new Blob([JSON.stringify(selected, null, 2)], {
                    type: "application/json",
                  }),
                  selected.name + ".json",
                )
              }
            >
              <Download size={15} />
              내보내기
            </Button>
          </div>
        </div>
        <div className="workspace-columns style-columns">
          <section>
            <div className="panel">
              <div className="panel-heading">
                <h2>
                  {selected.sourceType === "interview"
                    ? "나의 문체 선호"
                    : "분석 자료 · 가이드"}
                </h2>
                <Badge>{names[selected.sourceType]}</Badge>
              </div>
              <label>
                시점, 리듬, 대사, 감정, 장르, 금지사항
                <textarea
                  rows={5}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="예: 가까운 3인칭 시점. 대사는 경쾌하게, 전투는 짧고 명확하게. 큰 감정 변화 뒤에 여운을 두고 번역투를 피하고 싶어요."
                />
              </label>
              <div className="button-row">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    run(async () => {
                      await update(
                        await send(
                          "/styles/" + selected.id + "/notes",
                          { revision: selected.revision, notes },
                          "PUT",
                        ),
                      );
                      notify("선호를 저장했습니다.");
                    })
                  }
                >
                  선호 저장
                </Button>
                {selected.sourceType === "interview" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      run(() =>
                        generate(
                          "/interview",
                          "문체 선호와 기존 답변을 바탕으로 다음 인터뷰 질문을 생성합니다.",
                        ),
                      )
                    }
                  >
                    <MessageCircle size={15} />
                    AI 인터뷰 시작
                  </Button>
                )}
              </div>
              {selected.interview && (
                <form
                  className="style-interview"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(async () => {
                      await update(
                        await send(
                          "/styles/" + selected.id + "/answers",
                          { revision: selected.revision, answers },
                          "PUT",
                        ),
                      );
                      notify("문체 인터뷰 답변을 저장했습니다.");
                    });
                  }}
                >
                  {selected.interview.questions.map((q: any) => (
                    <label key={q.id}>
                      {q.question}
                      <span className="field-hint">{q.rationale}</span>
                      <textarea
                        rows={2}
                        value={answers[q.id] || ""}
                        onChange={(e) =>
                          setAnswers({ ...answers, [q.id]: e.target.value })
                        }
                      />
                    </label>
                  ))}
                  <Button size="sm" type="submit">
                    인터뷰 답변 저장
                  </Button>
                </form>
              )}
              {selected.sourceType !== "interview" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(async () => {
                      if (!file) return;
                      const form = new FormData();
                      form.set("file", file);
                      form.set("rights", String(rights));
                      form.set("revision", selected.revision);
                      await update(
                        await api("/styles/" + selected.id + "/source", {
                          method: "POST",
                          body: form,
                        }),
                      );
                      setFile(null);
                      notify("원본 자료를 보존했습니다.");
                    });
                  }}
                >
                  <label className="dropzone small-dropzone">
                    <Upload size={22} />
                    <strong>{file?.name || "문체 자료를 선택하세요"}</strong>
                    <span>TXT · MD · DOCX · 텍스트 PDF · EPUB / 최대 8MB</span>
                    <input
                      type="file"
                      accept=".txt,.md,.docx,.pdf,.epub"
                      aria-label="문체 자료 파일"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={rights}
                      onChange={(e) => setRights(e.target.checked)}
                    />
                    본인 작성·허락받은 자료 등 사용 권한이 있으며, 분석 범위가
                    선택 모델에 전송될 수 있음을 확인했습니다.
                  </label>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!file || !rights || busy}
                    type="submit"
                  >
                    <Upload size={14} />
                    자료 업로드
                  </Button>
                </form>
              )}
              {selected.sources.map((src: any) => (
                <details className="source-preview" key={src.id}>
                  <summary>
                    {src.filename} · {src.totalChars.toLocaleString()}자
                  </summary>
                  <pre>{src.text.slice(0, 4000)}</pre>
                  <p className="muted">
                    문체 분석에는 자료당 앞부분 최대 6,000자를 사용합니다. 장르
                    편향과 샘플 대표성을 직접 확인하세요.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      run(async () => {
                        if (
                          !window.confirm("원본 자료와 파생 분석을 삭제할까요?")
                        )
                          return;
                        await update(
                          await send(
                            "/styles/" + selected.id + "/source/" + src.id,
                            { revision: selected.revision },
                            "DELETE",
                          ),
                        );
                        notify("자료를 삭제하고 파생 분석을 무효화했습니다.");
                      })
                    }
                  >
                    <Trash2 size={14} />
                    원본 · 파생 분석 삭제
                  </Button>
                </details>
              ))}
            </div>
            <div className="panel sample-panel">
              <div className="panel-heading">
                <h2>
                  <Sparkles size={18} />
                  독창적인 문체 A / B / C
                </h2>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      generate(
                        "/analyze",
                        "문체 선호·인터뷰 답변과 업로드 자료 일부를 분석해 같은 중립 사건의 독창적인 A/B/C 샘플과 규칙을 생성합니다.",
                      ),
                    )
                  }
                >
                  <Sparkles size={14} />
                  {selected.analysis ? "다시 분석" : "분석 · 샘플 생성"}
                </Button>
              </div>
              <p className="muted">
                같은 인물, 같은 사건, 같은 정보 공개 조건으로 문장 호흡을
                비교합니다. 관찰한 통계를 목표 비율로 강제하지 않습니다.
              </p>
              {selected.analysis ? (
                <>
                  <p>{selected.analysis.summary}</p>
                  <div className="tabs">
                    {selected.analysis.variants.map((v: any) => (
                      <button
                        className={variant === v.id ? "active" : ""}
                        key={v.id}
                        onClick={() => setVariant(v.id)}
                      >
                        {v.id} · {v.title}
                      </button>
                    ))}
                  </div>
                  {selected.analysis.variants
                    .filter((v: any) => v.id === variant)
                    .map((v: any) => (
                      <div key={v.id}>
                        <div className="style-sample">
                          <Badge tone="purple">독창적 긍정 예시 · {v.id}</Badge>
                          <p>{v.positive}</p>
                        </div>
                        <details className="negative-example">
                          <summary>피해야 할 예시와 이유</summary>
                          <p>{v.negative}</p>
                          <p className="muted">{v.why}</p>
                        </details>
                        <dl className="style-rules">
                          {Object.entries(v.rules).map(([key, value]) => (
                            <div key={key}>
                              <dt>{labels[key] || key}</dt>
                              <dd>{String(value)}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ))}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setEdit(JSON.stringify(selected.analysis, null, 2))
                    }
                  >
                    규칙 · 샘플 · 미정 직접 편집
                  </Button>
                </>
              ) : (
                <Empty
                  title="같은 장면, 세 가지 목소리"
                  description="자료를 분석하거나 인터뷰를 저장한 뒤 나에게 맞는 문장을 찾아보세요."
                />
              )}
            </div>
          </section>
          <aside>
            <div className="panel style-approval">
              <div className="callout-icon">
                <Feather size={25} />
              </div>
              <h3>문체도 작가의 자산이니까.</h3>
              <p className="muted">
                승인한 문체는 버전으로 고정됩니다. 작품에는 스냅샷으로 적용되어
                라이브러리 수정이 원고를 바꾸지 않습니다.
              </p>
              <div className="info-note">
                <ShieldCheck size={17} />
                <span>
                  참고 작품의 고유 문장과 캐릭터를 복제하지 않습니다. 중복
                  검사는 보조 수단이며 사용자의 검수가 필요합니다.
                </span>
              </div>
              {selected.analysis?.evidence.map((e: string, i: number) => (
                <p className="evidence" key={i}>
                  근거: {e}
                </p>
              ))}
              {selected.analysis &&
                [
                  ...selected.analysis.questions,
                  ...selected.analysis.conflicts,
                ].map((q: string, i: number) => (
                  <p className="warning-box" key={i}>
                    {q}
                  </p>
                ))}
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={agree}
                  onChange={(e) => setAgree(e.target.checked)}
                />
                A/B/C를 비교하고 규칙·출처·미정을 검수했습니다. 선택한 {variant}
                를 승인합니다.
              </label>
              <Button
                disabled={
                  !agree ||
                  !selected.analysis ||
                  busy ||
                  selected.status === "approved"
                }
                onClick={() =>
                  run(async () => {
                    await update(
                      await send("/styles/" + selected.id + "/approve", {
                        revision: selected.revision,
                        variant,
                        confirmed: true,
                      }),
                    );
                    notify(
                      "문체 승인 버전을 고정했습니다. 작품에서 선택할 수 있습니다.",
                    );
                  })
                }
              >
                <Check size={16} />
                {selected.status === "approved"
                  ? "승인된 버전"
                  : "문체 승인 · 버전 고정"}
              </Button>
            </div>
          </aside>
        </div>
        {edit !== null && (
          <Modal
            title="문체 규칙 · 샘플 직접 편집"
            wide
            onClose={() => setEdit(null)}
          >
            <div className="modal-body">
              <p className="muted">
                미정과 충돌은 직접 결정한 뒤 해결하고, 근거 없는 내용은 확정하지
                마세요. JSON 스키마를 검증합니다.
              </p>
              <textarea
                rows={24}
                className="code-input"
                value={edit}
                onChange={(e) => setEdit(e.target.value)}
              />
              <Button
                onClick={() =>
                  run(async () => {
                    await update(
                      await send(
                        "/styles/" + selected.id + "/analysis",
                        {
                          revision: selected.revision,
                          analysis: JSON.parse(edit),
                        },
                        "PUT",
                      ),
                    );
                    setEdit(null);
                    notify(
                      "문체 초안을 저장했습니다. 승인 전까지 적용되지 않습니다.",
                    );
                  })
                }
              >
                검수 내용 저장
              </Button>
            </div>
          </Modal>
        )}
      </>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR VOICE, YOUR STYLE</div>
          <h1>
            문체 라이브러리<span className="title-dot">.</span>
          </h1>
          <p>작품이 달라져도, 나만의 문장은 자산으로 남도록.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus size={17} />새 문체 만들기
        </Button>
      </div>
      <div className="style-intro">
        <div>
          <Feather size={30} />
          <h2>당신의 목소리를 발견하세요.</h2>
          <p>
            읽히는 호흡, 인물의 말투, 감정의 거리.
            <br />
            막연한 취향을 실제 집필 규칙으로 바꿉니다.
          </p>
        </div>
        <div className="style-creation-paths">
          {[
            {
              type: "interview",
              icon: MessageCircle,
              title: "질문으로 찾기",
              desc: "선호를 대화하며 발견해요.",
            },
            {
              type: "guide",
              icon: FileText,
              title: "가이드로 만들기",
              desc: "나의 집필 규칙을 구조화해요.",
            },
            {
              type: "reference",
              icon: Library,
              title: "참고 작품 분석",
              desc: "허가된 자료에서 특성을 추출해요.",
            },
          ].map((m) => (
            <button
              key={m.type}
              onClick={() => {
                setMode(m.type);
                setCreating(true);
              }}
            >
              <m.icon size={21} />
              <strong>{m.title}</strong>
              <small>{m.desc}</small>
              <ArrowUpRight size={16} />
            </button>
          ))}
        </div>
      </div>
      <div className="section-heading">
        <h2>
          나의 문체 <span>{styles.length}</span>
        </h2>
      </div>
      {styles.length ? (
        <div className="style-grid">
          {styles.map((s) => (
            <button
              key={s.id}
              className="style-card panel"
              onClick={() => run(() => open(s))}
            >
              <div>
                <span className="style-card-icon">
                  <Feather size={22} />
                </span>
                <Badge tone={s.status === "approved" ? "green" : "purple"}>
                  {statuses[s.status]}
                </Badge>
              </div>
              <h3>{s.name}</h3>
              <p>
                {s.analysis?.summary ||
                  s.notes ||
                  "아직 분석하지 않은 문체 초안입니다."}
              </p>
              <footer>
                <span>
                  {names[s.sourceType]} · v{s.profileVersion}
                </span>
                <ArrowUpRight size={18} />
              </footer>
            </button>
          ))}
        </div>
      ) : (
        <Empty
          title="아직 이름 붙이지 않은 나만의 문체"
          description="질문, 가이드, 참고 자료 중 편한 방식으로 시작해보세요."
        >
          <Button variant="secondary" onClick={() => setCreating(true)}>
            <Plus size={16} />첫 문체 만들기
          </Button>
        </Empty>
      )}
      {creating && (
        <Modal title="나만의 문체 만들기" onClose={() => setCreating(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const s = await send("/styles", {
                  name,
                  sourceType: mode,
                  notes,
                });
                await refresh();
                await open(s);
                setCreating(false);
              });
            }}
          >
            <div className="modal-body">
              <label>
                문체 이름
                <input
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="예: 담백한 시선, 따뜻한 여운"
                />
              </label>
              <label>
                만드는 방식
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  {Object.entries(names).map(([key, v]) => (
                    <option key={key} value={key}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                떠오르는 문체 선호
                <textarea
                  rows={5}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="시점, 문장 호흡, 대사, 감정, 장면 속도, 피하고 싶은 표현을 알려주세요."
                />
              </label>
              <Button type="submit" disabled={!name.trim() || busy}>
                <Plus size={15} />
                문체 초안 만들기
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
