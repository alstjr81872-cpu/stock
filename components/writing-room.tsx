"use client";
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Cloud as CloudCheck,
  Download,
  Feather,
  History,
  Loader2,
  Save,
  ShieldCheck,
  Sparkles,
  Undo2,
} from "lucide-react";
import { api, send, date, statuses, download, ApiError } from "@/lib/api";
import { Badge, Empty, Modal, useActions } from "./workspace";
import { Button } from "./ui/button";
import Editor from "./editor";
export default function WritingRoom({
  project: p,
  reloadProject,
}: {
  project: any;
  reloadProject: () => Promise<void>;
}) {
  const { busy, run, askAI, notify, registerLeave } = useActions();
  const [ch, setCh] = useState<any>(null),
    [text, setText] = useState(""),
    [title, setTitle] = useState(""),
    [loading, setLoading] = useState(true),
    [saveState, setSaveState] = useState("서버에 저장 완료"),
    [conflict, setConflict] = useState<any>(null),
    [merged, setMerged] = useState(""),
    [versions, setVersions] = useState<any[] | null>(null),
    [version, setVersion] = useState<any>(null),
    [partial, setPartial] = useState(false),
    [passage, setPassage] = useState(""),
    [instruction, setInstruction] = useState(""),
    [proposal, setProposal] = useState<any>(null),
    [confirmed, setConfirmed] = useState(false),
    [fork, setFork] = useState(false);
  const chRef = useRef<any>(null),
    textRef = useRef(""),
    titleRef = useRef(""),
    saving = useRef<Promise<boolean> | null>(null),
    conflictRef = useRef(false),
    lastChange = useRef(0);
  const base = "/projects/" + p.id;
  function adopt(data: any) {
    chRef.current = data;
    textRef.current = data.content;
    titleRef.current = data.title;
    setCh(data);
    setText(data.content);
    setTitle(data.title);
    setSaveState("서버에 저장 완료");
  }
  useEffect(() => {
    let live = true;
    api(base + "/chapter")
      .then((d) => {
        if (live) adopt(d);
      })
      .catch((e) => {
        if (e.status !== 404) setSaveState("불러오기 실패: " + e.message);
      })
      .finally(() => setLoading(false));
    return () => {
      live = false;
    };
  }, [p.id]);
  const dirty = !!ch && (text !== ch.content || title !== ch.title);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (
        chRef.current &&
        (textRef.current !== chRef.current.content ||
          titleRef.current !== chRef.current.title)
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  async function saveNow(): Promise<boolean> {
    if (saving.current) return saving.current;
    if (!chRef.current || conflictRef.current) return !conflictRef.current;
    if (
      textRef.current === chRef.current.content &&
      titleRef.current === chRef.current.title
    )
      return true;
    const content = textRef.current,
      chapterTitle = titleRef.current,
      rev = chRef.current.revision;
    setSaveState("계정 저장 중…");
    const operation = (async () => {
      try {
        const result = await send(
          base + "/chapter",
          { revision: rev, content, title: chapterTitle },
          "PUT",
        );
        chRef.current = result;
        setCh(result);
        setSaveState("서버에 저장 완료");
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          const current = await api(base + "/chapter");
          conflictRef.current = true;
          setConflict(current);
          setMerged(textRef.current);
          setSaveState("충돌 감지 · 자동 저장 중지");
        } else setSaveState("저장 실패 · " + (e as Error).message);
        return false;
      } finally {
        saving.current = null;
      }
    })();
    saving.current = operation;
    return operation;
  }
  useEffect(() => {
    if (!dirty || conflict) return;
    setSaveState("계정 저장 대기…");
    const timer = setTimeout(() => {
      saveNow();
    }, 1500);
    return () => clearTimeout(timer);
  }, [text, title, ch?.revision, conflict]);
  function edit(value: string) {
    lastChange.current = Date.now();
    textRef.current = value;
    setText(value);
  }
  async function flush() {
    for (let i = 0; i < 4; i++) {
      if (!(await saveNow())) return false;
      if (
        !chRef.current ||
        (textRef.current === chRef.current.content &&
          titleRef.current === chRef.current.title)
      )
        return true;
    }
    return false;
  }
  useEffect(() => registerLeave(flush), []);
  async function aiAction(path: string, scope: string) {
    if (!(await flush())) return;
    const max = await askAI(scope);
    if (max === null) return;
    const result = await send(base + path, {
      revision: chRef.current.revision,
      consent: true,
      maxCostUsd: max,
    });
    adopt(result);
    notify("검토 결과를 저장했습니다.");
  }
  const complete = p.plot?.status === "APPROVED" && p.status === "ACTIVE";
  const next = p.plot?.scenes.find(
    (s: any) => !ch?.writtenScenes?.includes(s.id),
  );
  const count = [...text].length,
    nonspace = [...text.replace(/\s/g, "")].length;
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>
            <Feather size={21} />
            집필실
          </h2>
          <p className="muted">문장을 다듬는 동안, 이야기는 계정에 남습니다.</p>
        </div>
        <span
          className={
            "save-indicator " +
            (saveState.includes("실패") || conflict ? "failed" : "")
          }
          role="status"
        >
          <CloudCheck size={15} />
          {saveState}
        </span>
      </div>
      {!complete && (
        <div className="info-note">
          <ShieldCheck size={17} />
          최신 기획서와 현재 구간 플롯을 승인해야 AI 집필을 시작할 수 있습니다.
        </div>
      )}
      {loading ? (
        <div className="loading-page">
          <Loader2 className="spin" />
        </div>
      ) : !ch ? (
        <Empty
          title="첫 문장을 기다리고 있습니다"
          description="플롯에서 승인한 첫 장면부터 차례대로 작성합니다. 초안은 확정 원고와 구분해 보관합니다."
        >
          <Button
            disabled={!complete || busy}
            onClick={() =>
              run(async () => {
                const max = await askAI(
                  "첫 장면의 승인된 플롯·문체·기획과 공통 집필 규칙을 전송해 원고 초안을 생성합니다.",
                );
                if (max === null) return;
                const data = await send(
                  base + "/scenes/" + p.plot.scenes[0].id + "/write",
                  { revision: p.revision, consent: true, maxCostUsd: max },
                );
                adopt(data);
                notify("첫 장면을 저장했습니다.");
              })
            }
          >
            <Sparkles size={16} />첫 장면 집필하기
          </Button>
        </Empty>
      ) : (
        <div className="writing-layout">
          <section>
            <div className="manuscript-heading">
              <Badge tone={ch.status === "APPROVED" ? "green" : "purple"}>
                {statuses[ch.status] || ch.status}
              </Badge>
              <span>제1화 · r{ch.revision}</span>
              <span>
                문체 v{ch.styleVersion} · 캐논 v{ch.canonVersion}
              </span>
            </div>
            <input
              className="chapter-title"
              aria-label="회차 제목"
              value={title}
              disabled={ch.status === "APPROVED" && !fork}
              onChange={(e) => {
                setTitle(e.target.value);
                titleRef.current = e.target.value;
              }}
            />
            {ch.status === "APPROVED" && !fork && (
              <div className="info-note">
                <ShieldCheck size={17} />
                확정 원고입니다.
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setFork(true)}
                >
                  새 초안으로 편집
                </Button>
              </div>
            )}
            <Editor
              value={text}
              onChange={edit}
              disabled={
                !!conflict || busy || (ch.status === "APPROVED" && !fork)
              }
            />
            <div className="editor-bottom">
              <span>
                공백 포함 <b>{count.toLocaleString()}</b>자
              </span>
              <span>
                공백 제외 <b>{nonspace.toLocaleString()}</b>자
              </span>
              <span>
                {new TextEncoder().encode(text).length.toLocaleString()} bytes
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={!dirty || !!conflict}
                onClick={() => saveNow()}
              >
                <Save size={14} />
                지금 저장
              </Button>
            </div>
            {nonspace < 3000 && (
              <div className="length-note">
                PLUS/공모전 게시 프로필 기준 공백 제외 3,000자 미만입니다. 게시
                시 최신 플랫폼 규정을 확인하세요.
              </div>
            )}
            <div className="button-row writing-actions">
              {next && (
                <Button
                  disabled={!complete || busy || !!conflict}
                  onClick={() =>
                    run(async () => {
                      if (!(await flush())) return;
                      const max = await askAI(
                        `다음 장면 「${next.title}」을 작성합니다. 승인 설정과 직전 장면 원고 일부를 전송합니다.`,
                      );
                      if (max === null) return;
                      const data = await send(
                        base + "/scenes/" + next.id + "/write",
                        {
                          revision: p.revision,
                          consent: true,
                          maxCostUsd: max,
                        },
                      );
                      adopt(data);
                      notify("다음 장면을 저장했습니다.");
                    })
                  }
                >
                  <Sparkles size={16} />
                  다음 장면 집필
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={busy || ch.status === "APPROVED"}
                onClick={() =>
                  run(() =>
                    aiAction(
                      "/chapter/review",
                      "현재 원고와 승인 기획·문체·플롯을 독립 검토 역할 모델에 전송합니다.",
                    ),
                  )
                }
              >
                <ShieldCheck size={16} />
                독립 검토
              </Button>
              <Button
                variant="secondary"
                disabled={busy || ch.status === "APPROVED"}
                onClick={() => {
                  setPassage("");
                  setInstruction("");
                  setPartial(true);
                }}
              >
                <Feather size={16} />
                부분 수정 제안
              </Button>
            </div>
          </section>
          <aside className="writing-rail">
            <div className="panel">
              <h3>원고 버전</h3>
              <p className="muted">
                의미 있는 시점만 기록합니다. 자동 저장마다 버전을 만들지
                않습니다.
              </p>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    if (!(await flush())) return;
                    await send(base + "/chapter/snapshot", {
                      revision: chRef.current.revision,
                    });
                    notify("불변 원고 스냅샷을 저장했습니다.");
                  })
                }
              >
                <Save size={14} />
                현재 버전 기록
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  run(async () =>
                    setVersions(await api(base + "/chapter/versions")),
                  )
                }
              >
                <History size={14} />
                이전 버전 · 복구
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  download(
                    new Blob([text], { type: "text/plain;charset=utf-8" }),
                    "제1화.txt",
                  )
                }
              >
                <Download size={14} />
                TXT 내려받기
              </Button>
            </div>
            <div className="panel review-panel">
              <h3>검토 노트</h3>
              {ch.review ? (
                <>
                  <Badge tone={ch.review.requiresHuman ? "amber" : "green"}>
                    {ch.review.requiresHuman ? "사람의 판단 필요" : "검토 완료"}
                  </Badge>
                  <p>{ch.review.summary}</p>
                  {ch.review.findings.map((f: any) => (
                    <div className={"finding " + f.severity} key={f.id}>
                      <Badge tone="amber">{f.severity}</Badge>
                      <blockquote>{f.quote}</blockquote>
                      <p>{f.rationale}</p>
                      <small>
                        근거: {f.evidence}
                        <br />
                        위치 {f.start}–{f.end} · 확신{" "}
                        {Math.round(f.confidence * 100)}%
                      </small>
                      <p className="muted">{f.fixHint}</p>
                    </div>
                  ))}
                </>
              ) : (
                <p className="muted">
                  원고 작성 후 독립 검토를 실행하세요. AI 평가는 최종 승인을
                  대신하지 않습니다.
                </p>
              )}
            </div>
            <div className="panel">
              <h3>회차 확정</h3>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                원고와 검토 근거를 직접 확인했고 이 버전을 확정합니다.
              </label>
              <Button
                disabled={!confirmed || busy || ch.status === "APPROVED"}
                onClick={() =>
                  run(async () => {
                    if (!(await flush())) return;
                    const result = await send(base + "/chapter/approve", {
                      revision: chRef.current.revision,
                      confirmed: true,
                      reviewed: true,
                    });
                    adopt(result);
                    setFork(false);
                    await reloadProject();
                    notify("회차 확정과 캐논 버전 갱신을 완료했습니다.");
                  })
                }
              >
                <Check size={16} />
                회차 확정
              </Button>
            </div>
          </aside>
        </div>
      )}
      {versions && (
        <Modal
          title="원고 버전 이력"
          wide
          onClose={() => {
            setVersions(null);
            setVersion(null);
          }}
        >
          <div className="modal-body">
            {!versions.length ? (
              <p className="muted">아직 기록한 버전이 없습니다.</p>
            ) : (
              <div className="version-list">
                {versions.map((v) => (
                  <button
                    key={v.id}
                    className={version?.id === v.id ? "selected" : ""}
                    onClick={() =>
                      run(async () =>
                        setVersion(
                          await api(base + "/chapter/versions/" + v.id),
                        ),
                      )
                    }
                  >
                    <History size={16} />
                    <span>
                      r{v.revision || "?"} · {date(v.createdAt)}
                    </span>
                    <small>{v.byteLength.toLocaleString()} bytes</small>
                  </button>
                ))}
              </div>
            )}
            {version && (
              <>
                <div className="diff-grid">
                  <div>
                    <h4>선택한 이전 버전</h4>
                    <pre>{version.content}</pre>
                  </div>
                  <div>
                    <h4>현재 편집본</h4>
                    <pre>{text}</pre>
                  </div>
                </div>
                <p className="muted">
                  복원 전 현재 원고도 자동으로 버전 보관합니다. 복원본은 새
                  초안이며 재승인이 필요합니다.
                </p>
                <Button
                  onClick={() =>
                    run(async () => {
                      if (!(await flush())) return;
                      const data = await send(base + "/chapter/restore", {
                        revision: chRef.current.revision,
                        versionId: version.id,
                      });
                      adopt(data);
                      setVersions(null);
                      setVersion(null);
                      setFork(true);
                      await reloadProject();
                      notify("이전 버전을 새 초안으로 복원했습니다.");
                    })
                  }
                >
                  <Undo2 size={16} />
                  선택 버전 복원
                </Button>
              </>
            )}
          </div>
        </Modal>
      )}
      {conflict && (
        <Modal title="동시 편집 충돌 감지" wide onClose={() => {}}>
          <div className="modal-body">
            <div className="warning-box">
              다른 창에서 r{conflict.revision}이 저장되었습니다. 입력한 내용은
              아래에 유지되며 자동 덮어쓰기를 중지했습니다.
            </div>
            <div className="diff-grid">
              <div>
                <h4>서버 저장본 · r{conflict.revision}</h4>
                <pre>{conflict.content}</pre>
              </div>
              <div>
                <h4>내 편집본 · 직접 병합</h4>
                <textarea
                  rows={16}
                  value={merged}
                  onChange={(e) => setMerged(e.target.value)}
                />
              </div>
            </div>
            <div className="button-row">
              <Button
                variant="secondary"
                onClick={() => {
                  adopt(conflict);
                  conflictRef.current = false;
                  setConflict(null);
                }}
              >
                서버 저장본 사용
              </Button>
              <Button
                onClick={() =>
                  run(async () => {
                    const result = await send(
                      base + "/chapter",
                      { revision: conflict.revision, title, content: merged },
                      "PUT",
                    );
                    adopt(result);
                    conflictRef.current = false;
                    setConflict(null);
                    notify("비교한 편집본을 명시적으로 저장했습니다.");
                  })
                }
              >
                병합한 내용 저장
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {partial && (
        <Modal
          title="선택 구간 부분 수정"
          wide
          onClose={() => setPartial(false)}
        >
          <div className="modal-body">
            <p className="muted">
              원고에서 고칠 구간을 그대로 붙여 넣으세요. 제안만 생성하며 적용 전
              비교합니다.
            </p>
            <label>
              수정할 원문 구간
              <textarea
                rows={5}
                value={passage}
                onChange={(e) => setPassage(e.target.value)}
              />
            </label>
            <label>
              수정 목적
              <textarea
                rows={3}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="무엇을 고치고, 무엇을 유지해야 하나요?"
              />
            </label>
            <Button
              disabled={!passage || !instruction || !text.includes(passage)}
              onClick={() =>
                run(async () => {
                  if (!(await flush())) return;
                  const max = await askAI(
                    "선택한 원문 구간과 앞뒤 문맥 일부, 승인 문체를 전송해 최소 범위 수정안을 생성합니다.",
                  );
                  if (max === null) return;
                  const index = textRef.current.indexOf(passage);
                  if (index < 0)
                    throw new Error(
                      "저장된 원고에서 선택 구간을 찾을 수 없습니다.",
                    );
                  const start = Array.from(
                    textRef.current.slice(0, index),
                  ).length;
                  const result = await send(base + "/chapter/rewrite", {
                    revision: chRef.current.revision,
                    start,
                    end: start + Array.from(passage).length,
                    instruction,
                    consent: true,
                    maxCostUsd: max,
                  });
                  setProposal(result);
                  setPartial(false);
                })
              }
            >
              <Sparkles size={16} />
              수정안 만들기
            </Button>
          </div>
        </Modal>
      )}
      {proposal && (
        <Modal
          title="부분 수정 전후 비교"
          wide
          onClose={() => setProposal(null)}
        >
          <div className="modal-body">
            <div className="diff-grid">
              <div>
                <h4>기존 구간</h4>
                <pre>{proposal.original}</pre>
              </div>
              <div>
                <h4>수정 제안</h4>
                <pre>{proposal.replacement}</pre>
              </div>
            </div>
            <p>{proposal.reason}</p>
            {proposal.risks.map((r: string, i: number) => (
              <p className="muted" key={i}>
                {r}
              </p>
            ))}
            <p className="muted">
              적용 전 원고를 버전 보관합니다. 수정 후 독립 재검토가 필요합니다.
              무관 구간은 그대로 보존합니다.
            </p>
            <div className="button-row">
              <Button variant="secondary" onClick={() => setProposal(null)}>
                원본 유지
              </Button>
              <Button
                onClick={() =>
                  run(async () => {
                    if (!(await flush())) return;
                    adopt(
                      await send(base + "/chapter/rewrite/apply", {
                        revision: chRef.current.revision,
                        proposalId: proposal.id,
                      }),
                    );
                    setProposal(null);
                    notify("선택 구간만 변경했습니다. 다시 검토하세요.");
                  })
                }
              >
                이 수정안 적용
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
