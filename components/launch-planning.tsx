"use client";
import { useState } from "react";
import { send } from "@/lib/api";
import { Button } from "./ui/button";
import { Modal, useActions } from "./workspace";
export default function LaunchPlanning({
  project: p,
  onUpdate,
  onContinue,
}: {
  project: any;
  onUpdate: (p: any) => Promise<void>;
  onContinue: () => void;
}) {
  const { run, busy, askAI, notify } = useActions();
  const [proposal, setProposal] = useState<any>(null),
    [draft, setDraft] = useState<any>(null),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState("");
  const base = "/projects/" + p.id;
  function edit(data: any) {
    setProposal(data);
    setDraft(structuredClone(data.plan));
    setConfirmed(false);
    setError("");
  }
  async function generate() {
    setError("");
    const path = base + "/launch/generate",
      data = { revision: p.revision };
    try {
      const max = await askAI(
        "업로드 파일을 분석하고, 독자가 읽을 이유·주인공과 인물·장르·문체·초반 사건을 간결한 기획안으로 다듬습니다. 긴 사전 세계관과 인터뷰 없이 시놉시스로 이어집니다.",
        { path, data },
      );
      if (max === null) return;
      edit(await send(path, { ...data, consent: true, maxCostUsd: max }));
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  }
  const plan = p.launchPlan;
  const labels: Record<string, string> = {
    title: "작품 제목",
    genre: "장르",
    logline: "한 줄 기획",
    readerPromise: "독자가 읽을 이유",
    opening: "초반에 터뜨릴 사건",
    storyEngine: "다음 회차를 부르는 재미",
    style: "문체와 목소리",
  };
  return (
    <section className="launch-planning">
      <div className="panel planning-start">
        <div>
          <span className="eyebrow">FILE → STORY</span>
          <h2>기획은 짧게, 이야기는 바로.</h2>
          <p>
            올린 파일에서 주인공과 인물, 장르와 문체를 뽑고 첫 10화를
            설계합니다. 세계관과 복선은 실제 전개에 맞춰 쌓습니다.
          </p>
        </div>
        <Button disabled={busy} onClick={() => run(generate)}>
          {plan ? "파일로 기획 다시 만들기" : "파일 분석 · 기획안 만들기"}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      <details className="panel">
        <summary>업로드 원문 확인</summary>
        <pre className="source-text">{p.brief.text}</pre>
      </details>
      {plan && (
        <>
          <div className="panel">
            <h2>{plan.title}</h2>
            <p>{plan.genre}</p>
            <p>{plan.logline}</p>
            <h3>독자가 읽을 이유</h3>
            <p>{plan.readerPromise}</p>
            <h3>첫 사건</h3>
            <p>{plan.opening}</p>
            <h3>문체</h3>
            <p>{plan.style}</p>
            <div className="button-row">
              <Button disabled={busy} onClick={onContinue}>
                10화 시놉시스로
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(async () =>
                    edit(
                      await send(base + "/launch/draft", {
                        revision: p.revision,
                      }),
                    ),
                  )
                }
              >
                기획안 직접 수정
              </Button>
            </div>
          </div>
          <div className="scene-grid">
            {plan.characters.map((c: any) => (
              <article className="panel" key={c.id}>
                <h3>
                  {c.name} {c.id === plan.protagonistId && "· 주인공"}
                </h3>
                <p>{c.role}</p>
                <p>{c.desire}</p>
                <p>{c.contradiction}</p>
                <p>{c.voice}</p>
              </article>
            ))}
          </div>
          <div className="panel">
            <h3>지금 필요한 세계관</h3>
            {plan.worldRules.map((r: string, i: number) => (
              <p key={i}>{r}</p>
            ))}
            <p className="muted">
              시놉시스를 기록할 때 필요한 설정과 복선이 추가됩니다.
            </p>
          </div>
        </>
      )}
      {proposal && draft && (
        <Modal
          title="파일에서 만든 기획안"
          wide
          onClose={() => !busy && setProposal(null)}
        >
          <div className="modal-body">
            <p className="muted">
              내용을 바로 고칠 수 있습니다. 확인하면 인물·장르·문체가 함께
              저장되고 10화 시놉시스로 이어집니다.
            </p>
            {Object.entries(labels).map(([key, label]) => (
              <label key={key}>
                {label}
                <textarea
                  aria-label={label}
                  rows={key === "title" || key === "genre" ? 1 : 3}
                  value={draft[key]}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: e.target.value })
                  }
                />
              </label>
            ))}
            <h3>주인공 · 등장인물</h3>
            {draft.characters.map((c: any, i: number) => (
              <details className="panel" key={c.id}>
                <summary>
                  {c.name} · {c.role}
                </summary>
                {Object.entries({
                  name: "이름",
                  role: "역할",
                  desire: "욕망",
                  contradiction: "모순과 약점",
                  voice: "말투",
                  background: "배경",
                }).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <textarea
                      aria-label={c.id + " " + label}
                      rows={2}
                      value={c[key]}
                      onChange={(e) => {
                        const chars = [...draft.characters];
                        chars[i] = { ...c, [key]: e.target.value };
                        setDraft({ ...draft, characters: chars });
                      }}
                    />
                  </label>
                ))}
              </details>
            ))}
            {draft.sourceConflicts.length > 0 && (
              <div className="warning-box">
                <strong>원문에서 함께 확인할 부분</strong>
                {draft.sourceConflicts.map((v: string, i: number) => (
                  <p key={i}>{v}</p>
                ))}
              </div>
            )}
            <p>
              새 기획을 적용하면 새 연재 버전으로 시작합니다. 기존
              원고·시놉시스는 보관되며 덮어쓰지 않습니다.
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              이 기획안으로 첫 10화를 설계하겠습니다.
            </label>
            {error && <p role="alert">{error}</p>}
            <div className="button-row">
              <Button
                disabled={
                  busy || !confirmed || proposal.inputRevision !== p.revision
                }
                onClick={() =>
                  run(async () => {
                    try {
                      await onUpdate(
                        await send(base + "/launch/apply", {
                          revision: p.revision,
                          proposalId: proposal.id,
                          plan: draft,
                          confirmed: true,
                        }),
                      );
                      setProposal(null);
                      notify(
                        "기획안을 저장했습니다. 첫 10화 시놉시스로 이어갑니다.",
                      );
                      onContinue();
                    } catch (e) {
                      setError((e as Error).message);
                      throw e;
                    }
                  })
                }
              >
                이 기획으로 10화 설계
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setProposal(null)}
              >
                취소
              </Button>
            </div>
            {proposal.inputRevision !== p.revision && (
              <p role="alert">
                자료가 바뀌었습니다. 닫은 뒤 최신 자료로 다시 기획해주세요.
              </p>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
