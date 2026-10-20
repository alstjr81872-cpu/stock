"use client";
import { useEffect, useRef, useState } from "react";
import {
  MessageCircle,
  Send,
  Sparkles,
  Paperclip,
  BookOpen,
  Check,
  Loader2,
} from "lucide-react";
import { api, send } from "@/lib/api";
import { useActions, Modal } from "./workspace";
import { Button } from "./ui/button";
const kinds: Record<string, string> = {
  character: "인물",
  world: "세계관",
  plot: "서사",
  style: "문체",
  genre: "장르",
  rating: "표현 범위",
};
export default function StoryAssistant({
  project: p,
  onUpdate,
  onContinue,
  writing = false,
  prepare,
  onManuscript,
}: {
  project: any;
  onUpdate: (p: any) => Promise<void>;
  onContinue?: () => void;
  writing?: boolean;
  prepare?: () => Promise<{ chapterRevision: number | null } | null>;
  onManuscript?: (chapter: any) => void;
}) {
  const { busy, run, askAI, notify } = useActions();
  const [turns, setTurns] = useState<any[]>([]),
    [cursor, setCursor] = useState<number | null>(null),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [autoSend, setAutoSend] = useState(false),
    [cap, setCap] = useState("0.15"),
    [fileKind, setFileKind] = useState("idea"),
    [edit, setEdit] = useState<any>(null),
    [proposal, setProposal] = useState<any>(null);
  const end = useRef<HTMLDivElement>(null);
  const base = `/projects/${p.id}/assistant`;
  useEffect(() => {
    let live = true;
    api(base + "/history")
      .then((data) => {
        if (!live) return;
        setTurns(data.turns);
        setCursor(data.nextBefore);
        if (!data.turns.length && !writing) setMessage(p.chatSeed ?? "");
      })
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [p.id]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [turns.at(-1)?.id]);
  async function submit() {
    if (!message.trim()) return;
    setError("");
    try {
      const ready =
        writing && prepare ? await prepare() : { chapterRevision: null };
      if (!ready) return;
      const data = {
        revision: p.revision,
        message,
        mode: writing ? "writing" : "planning",
        storyRevision: p.storyRevision ?? 0,
        episode: p.currentEpisode ?? 1,
        chapterRevision: ready.chapterRevision,
      };
      let max: number | null;
      if (autoSend) {
        const ceiling = Number(cap);
        if (!Number.isFinite(ceiling) || ceiling <= 0 || ceiling > 5)
          throw new Error("응답당 한도는 $0 초과~$5로 입력해주세요.");
        const quote = await api(base + "/message", {
          method: "POST",
          headers: { "X-NF-Preflight": "1" },
          body: JSON.stringify({
            ...data,
            consent: false,
            maxCostUsd: ceiling,
          }),
        });
        if (!quote.estimateOnly || quote.suggestedMaxCostUsd > ceiling)
          throw new Error(
            "자동 전송 한도를 넘습니다. 한도를 조정하거나 개별 비용 확인으로 전환해주세요.",
          );
        max = ceiling;
      } else
        max = await askAI(
          "최근 대화, 저장된 설정집, 첨부 자료 일부와 현재 기획을 전송합니다." +
            (writing
              ? " 저장된 현재 회차 원고도 함께 읽고 수정안을 제안합니다."
              : " AI와 질문·제안을 주고받으며 기획합니다."),
          { path: base + "/message", data },
        );
      if (max === null) return;
      const result = await send(base + "/message", {
        ...data,
        consent: true,
        maxCostUsd: max,
      });
      setTurns((old) => [...old, result.turn]);
      setMessage("");
      await onUpdate(result.project);
      if (result.turn.savedCanon.length)
        notify(
          `${result.turn.savedCanon.length}개 설정을 설정집에 저장했습니다.`,
        );
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  }
  async function attach(file: File) {
    setError("");
    const data = new FormData();
    data.set("file", file);
    data.set("kind", fileKind);
    data.set("revision", String(p.revision));
    try {
      const result = await api(base + "/file", { method: "POST", body: data });
      await onUpdate(result);
      setMessage((old) =>
        old.trim()
          ? old
          : fileKind === "style"
            ? "첨부한 원고의 문체를 분석하고 이 작품의 문체로 적용해줘. 고유 문장과 사건은 복제하지 말아줘."
            : "첨부한 파일을 읽고 내 아이디어를 함께 구체화해줘.",
      );
      notify("파일을 저장했습니다. 메시지를 보내면 AI가 자료를 읽습니다.");
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  }
  const canon = (p.conversationCanon ?? []).filter((c: any) => !c.archived);
  const plan = p.chatPlan ?? p.launchPlan;
  return (
    <section
      className={"story-assistant " + (writing ? "assistant-compact" : "")}
      aria-label={writing ? "집필 AI 어시스턴트" : "기획 AI 채팅"}
    >
      <div className="assistant-heading">
        <div>
          <span className="eyebrow">YOUR WRITING PARTNER</span>
          <h2>
            <MessageCircle size={21} />{" "}
            {writing ? "집필 어시스턴트" : "대화로 만드는 이야기"}
          </h2>
          <p>
            {writing
              ? "어디가 늘어지는지, 어떻게 바꿀지 함께 고칩니다."
              : "장르 한 줄에서 시작해도 됩니다. 결정이 막히면 ‘알아서 해줘’라고 말하세요."}
          </p>
        </div>
      </div>
      <div className="assistant-layout">
        <div className="panel chat-panel">
          <div
            className="chat-history"
            role="log"
            aria-label="작품 대화 기록"
            aria-live="polite"
          >
            {cursor && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const data = await api(base + "/history?before=" + cursor);
                    setTurns((old) => [...data.turns, ...old]);
                    setCursor(data.nextBefore);
                  })
                }
              >
                이전 대화 더 보기
              </Button>
            )}
            {loading ? (
              <p>
                <Loader2 className="spin" size={18} /> 대화를 불러오는 중…
              </p>
            ) : (
              !turns.length && (
                <article className="chat-bubble assistant">
                  <strong>NovelForge</strong>
                  <p>
                    {writing
                      ? "현재 원고를 읽고 같이 다듬을게요. ‘도입을 더 날카롭게 고쳐줘’, ‘독백을 더 뻔뻔하게’처럼 요청해주세요."
                      : "어떤 이야기를 쓰고 싶으세요? 장르, 좋아하는 캐릭터, 보고 싶은 장면 중 하나만 알려주세요. 파일을 첨부해 함께 기획해도 좋습니다."}
                  </p>
                </article>
              )
            )}
            {turns.map((t) => (
              <div className="chat-turn" key={t.id}>
                <article className="chat-bubble user">
                  <strong>나</strong>
                  <p>{t.message}</p>
                </article>
                <article className="chat-bubble assistant">
                  <strong>
                    NovelForge{" "}
                    <small>
                      · {t.mode === "writing" ? `${t.episode}화 집필` : "기획"}
                    </small>
                  </strong>
                  <p>{t.reply}</p>
                  {!!t.questions?.length && (
                    <div className="chat-questions">
                      {t.questions.map((q: string, i: number) => (
                        <p key={i}>
                          {i + 1}. {q}
                        </p>
                      ))}
                    </div>
                  )}
                  {!!t.savedCanon?.length && (
                    <div className="chat-saved">
                      <Check size={15} /> 설정집에 저장:{" "}
                      {t.savedCanon.map((c: any) => c.title).join(" · ")}
                    </div>
                  )}
                  {t.editProposal && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || t.editProposal.status !== "PROPOSED"}
                      onClick={() => setProposal(t)}
                    >
                      {t.editProposal.status === "APPLIED"
                        ? "원고 반영 완료"
                        : "원고 수정안 비교"}
                    </Button>
                  )}
                </article>
              </div>
            ))}
            <div ref={end} />
          </div>
          {busy && (
            <div role="status" className="chat-working">
              <Loader2 size={16} className="spin" /> 요청 처리 중 · 대화를
              저장하고 있습니다
            </div>
          )}
          <div className="chat-shortcuts">
            {(writing
              ? [
                  "늘어진 도입을 실제 수정안으로 고쳐줘",
                  "주인공 독백과 대사를 더 개성 있게 바꿔줘",
                ]
              : ["핵심 질문부터 해줘", "지금까지 이야기로 알아서 기획해줘"]
            ).map((q) => (
              <button
                type="button"
                key={q}
                disabled={busy}
                onClick={() => setMessage(q)}
              >
                {q}
              </button>
            ))}
          </div>
          <form
            className="chat-composer"
            onSubmit={(e) => {
              e.preventDefault();
              run(submit);
            }}
          >
            <label
              className="sr-only"
              htmlFor={writing ? "writing-chat" : "planning-chat"}
            >
              AI에게 보낼 메시지
            </label>
            <textarea
              id={writing ? "writing-chat" : "planning-chat"}
              aria-label="AI에게 보낼 메시지"
              rows={4}
              maxLength={12000}
              value={message}
              disabled={busy || loading}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                writing
                  ? "이 부분이 루즈해. 대사와 내면을 더 날카롭게 고쳐줘."
                  : "아카데미물에 능글맞은 주인공을 쓰고 싶어…"
              }
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  if (!busy && message.trim()) run(submit);
                }
              }}
            />
            <div className="chat-composer-actions">
              <div className="chat-attachment">
                <select
                  aria-label="첨부 자료 종류"
                  value={fileKind}
                  onChange={(e) => setFileKind(e.target.value)}
                >
                  <option value="idea">기획 자료</option>
                  <option value="style">문체 참고 원고</option>
                </select>
                <label className="chat-file-button">
                  <Paperclip size={17} /> 파일
                  <input
                    type="file"
                    aria-label="대화에 파일 첨부"
                    accept=".txt,.md,.docx,.pdf"
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) run(() => attach(file));
                    }}
                  />
                </label>
              </div>
              <Button
                type="submit"
                disabled={busy || loading || !message.trim()}
              >
                <Send size={16} /> 보내기
              </Button>
            </div>
            <details className="chat-consent">
              <summary>대화 비용 · 전송 설정</summary>
              <p>
                대화와 설정, 첨부 자료 일부{writing ? ", 저장된 원고" : ""}를
                OpenRouter에 전송합니다. 기본은 매번 비용 확인입니다. 자동
                전송은 이 화면을 여는 동안만 적용됩니다.
              </p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={autoSend}
                  onChange={(e) => setAutoSend(e.target.checked)}
                  disabled={busy}
                />
                응답당 아래 한도 내 유료 전송에 동의합니다
              </label>
              <label>
                응답당 최대 비용 (USD)
                <input
                  aria-label="대화 응답당 비용 한도"
                  type="number"
                  min="0.001"
                  max="5"
                  step="any"
                  value={cap}
                  onChange={(e) => setCap(e.target.value)}
                  disabled={busy}
                />
              </label>
            </details>
            {error && (
              <p className="chat-error" role="alert">
                {error} 자동 재요청하지 않습니다.
              </p>
            )}
          </form>
        </div>
        <aside className="assistant-notebook">
          <details className="panel" open={!writing}>
            <summary>
              <BookOpen size={18} /> 함께 쌓은 설정집 · {canon.length}
            </summary>
            <p className="muted">
              채택·직접 지정·위임한 설정이 저장됩니다. 최신 설정은 이후 생성과
              수정에 반영하며 기존 원고는 직접 적용할 때 바뀝니다.
            </p>
            {!canon.length && (
              <p className="muted">
                ‘이 설정 마음에 든다’라고 말하면 여기에 쌓입니다.
              </p>
            )}
            {canon.map((c: any) => (
              <article className="canon-card" key={c.id}>
                <small>{kinds[c.kind]}</small>
                <h3>{c.title}</h3>
                <p>{c.content}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setEdit(structuredClone(c))}
                >
                  수정 · 보관
                </Button>
              </article>
            ))}
          </details>
          {!writing && (
            <div className="panel chat-plan-card">
              <h3>
                <Sparkles size={18} /> 대화에서 정리한 기획
              </h3>
              {plan ? (
                <>
                  <h3>{plan.title}</h3>
                  <p>{plan.genre}</p>
                  <p>{plan.logline}</p>
                  <details>
                    <summary>기획 내용 펼치기</summary>
                    <p>{plan.readerPromise}</p>
                    <p>{plan.opening}</p>
                    <p>{plan.style}</p>
                    {plan.characters.map((c: any) => (
                      <p key={c.id}>
                        <b>{c.name}</b> · {c.role}
                        <br />
                        {c.desire}
                      </p>
                    ))}
                  </details>
                  {p.status === "ACTIVE" ? (
                    <Button disabled={busy} onClick={onContinue}>
                      시놉시스로 이어가기
                    </Button>
                  ) : (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await onUpdate(
                            await send(base + "/activate", {
                              revision: p.revision,
                              confirmed: true,
                            }),
                          );
                          onContinue?.();
                        })
                      }
                    >
                      이 기획으로 시놉시스 만들기
                    </Button>
                  )}
                </>
              ) : (
                <p>
                  대화가 모이면 기획으로 정리합니다. ‘알아서 기획해줘’라고
                  요청해도 됩니다.
                </p>
              )}
            </div>
          )}
          {!!p.assistantAttachments?.length && (
            <details className="panel">
              <summary>첨부 자료 · {p.assistantAttachments.length}</summary>
              {p.assistantAttachments.map((a: any) => (
                <p key={a.id}>
                  {a.name} · {a.kind === "style" ? "문체" : "기획"}
                </p>
              ))}
              <p className="muted">
                최근 3개 파일에서 각각 앞 12,000자를 대화에 전달합니다. 원본은
                보존합니다.
              </p>
            </details>
          )}
        </aside>
      </div>
      {edit && (
        <Modal title="설정집 수정" onClose={() => !busy && setEdit(null)}>
          <div className="modal-body">
            <label>
              제목
              <input
                value={edit.title}
                onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              />
            </label>
            <label>
              종류
              <select
                value={edit.kind}
                onChange={(e) => setEdit({ ...edit, kind: e.target.value })}
              >
                {Object.entries(kinds).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              설정 내용
              <textarea
                rows={7}
                maxLength={2000}
                value={edit.content}
                onChange={(e) => setEdit({ ...edit, content: e.target.value })}
              />
            </label>
            <div className="button-row">
              <Button
                disabled={busy || !edit.content.trim() || !edit.title.trim()}
                onClick={() =>
                  run(async () => {
                    await onUpdate(
                      await send(base + "/canon", {
                        revision: p.revision,
                        id: edit.id,
                        kind: edit.kind,
                        title: edit.title,
                        content: edit.content,
                        archived: false,
                      }),
                    );
                    setEdit(null);
                  })
                }
              >
                설정 저장
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await onUpdate(
                      await send(base + "/canon", {
                        revision: p.revision,
                        id: edit.id,
                        kind: edit.kind,
                        title: edit.title,
                        content: edit.content,
                        archived: true,
                      }),
                    );
                    setEdit(null);
                  })
                }
              >
                설정 보관 · 이후 입력에서 제외
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {proposal && (
        <Modal
          title="대화로 만든 원고 수정안"
          wide
          onClose={() => !busy && setProposal(null)}
        >
          <div className="modal-body">
            {proposal.editProposal.edits.map((e: any, i: number) => (
              <div key={i}>
                <p>{e.reason}</p>
                <div className="chat-edit-compare">
                  <div>
                    <h3>현재 원고</h3>
                    <pre>{e.original}</pre>
                  </div>
                  <div>
                    <h3>수정 제안</h3>
                    <pre>{e.replacement}</pre>
                  </div>
                </div>
              </div>
            ))}
            <p className="muted">
              적용 전 원고 버전을 보관하고 독립 검토를 다시 받습니다. 원고나
              설정이 바뀌면 오래된 제안은 차단합니다.
            </p>
            <Button
              disabled={busy || !writing}
              onClick={() =>
                run(async () => {
                  const ready = prepare ? await prepare() : null;
                  if (!ready?.chapterRevision) return;
                  const chapter = await send(base + "/edits/apply", {
                    revision: p.revision,
                    chapterRevision: ready.chapterRevision,
                    turnId: proposal.id,
                    confirmed: true,
                    storyRevision: p.storyRevision ?? 0,
                    episode: p.currentEpisode ?? 1,
                  });
                  onManuscript?.(chapter);
                  setTurns((old) =>
                    old.map((t) =>
                      t.id === proposal.id
                        ? {
                            ...t,
                            editProposal: {
                              ...t.editProposal,
                              status: "APPLIED",
                            },
                          }
                        : t,
                    ),
                  );
                  setProposal(null);
                  notify("대화의 수정안을 원고에 반영했습니다.");
                })
              }
            >
              수정안을 원고에 적용
            </Button>
            {!writing && <p>집필실에서 수정안을 적용할 수 있습니다.</p>}
          </div>
        </Modal>
      )}
    </section>
  );
}
