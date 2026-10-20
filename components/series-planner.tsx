"use client";
import { useEffect, useRef, useState } from "react";
import { api, send } from "@/lib/api";
import { Button } from "./ui/button";
import { Modal, useActions } from "./workspace";
export default function SeriesPlanner({
  project: p,
  onUpdate,
  onSelected,
  beforeSelect,
}: {
  project: any;
  onUpdate: (p: any) => Promise<void>;
  onSelected: () => void;
  beforeSelect: () => Promise<boolean>;
}) {
  const { busy, run, askAI, notify } = useActions();
  const [state, setState] = useState<any>(null),
    [proposal, setProposal] = useState<any>(null),
    [showRecords, setShowRecords] = useState(false),
    [question, setQuestion] = useState(false),
    [target, setTarget] = useState(5000),
    [error, setError] = useState("");
  const prompted = useRef(new Set<number>()),
    base = "/projects/" + p.id;
  useEffect(() => {
    let active = true;
    setTarget(p.targetChars ?? 5000);
    api(base + "/synopsis")
      .then((data) => {
        if (!active) return;
        setState(data);
        setError("");
        if (
          data.nextStart > 1 &&
          data.canExtend &&
          (p.currentEpisode ?? 1) >= data.nextStart - 1 &&
          !prompted.current.has(data.nextStart)
        ) {
          prompted.current.add(data.nextStart);
          setQuestion(true);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [p.id, p.revision]);
  async function generate() {
    setError("");
    const path = base + "/synopsis/generate",
      data = { revision: p.revision };
    const max = await askAI(
      `${state.nextStart}~${state.nextStart + 9}화의 시놉시스를 설계합니다. 승인 기획과 이전 시놉시스·확정 원고의 요약을 바탕으로 이어가며, 확인 후 기록합니다.`,
      { path, data },
    );
    if (max === null) return;
    try {
      setProposal(
        await send(path, { ...data, consent: true, maxCostUsd: max }),
      );
      setQuestion(false);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  }
  async function select(number: number) {
    if (!(await beforeSelect())) return;
    await onUpdate(
      await send(base + "/episodes/select", { revision: p.revision, number }),
    );
    onSelected();
  }
  const episodes = state?.batches.flatMap((b: any) => b.result.episodes) ?? [];
  return (
    <section className="panel series-planner">
      <div className="panel-heading">
        <div>
          <h2>10화씩 이어가는 시놉시스</h2>
          <p className="muted">
            시놉시스 → 회차 장면 설계 → 원고 집필 순서로 진행합니다.
          </p>
        </div>
        {state && (
          <span>
            {state.batches.length
              ? `1~${state.nextStart - 1}화 기록됨`
              : "첫 10화를 설계하세요"}
          </span>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="button-row">
        <label>
          집필할 회차{" "}
          <select
            aria-label="집필할 회차"
            disabled={busy || !episodes.length}
            value={p.currentEpisode ?? 1}
            onChange={(event) => run(() => select(Number(event.target.value)))}
          >
            {!episodes.length && <option value={1}>제1화</option>}
            {episodes.map((e: any) => (
              <option value={e.number} key={e.number}>
                {e.number}화 · {e.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          회차당 목표 분량 · 공백 제외{" "}
          <input
            aria-label="원고 목표 글자 수"
            type="number"
            min={2000}
            max={20000}
            step={500}
            value={target}
            onChange={(event) => setTarget(Number(event.target.value))}
          />
        </label>
        <Button
          variant="secondary"
          disabled={
            busy || target < 2000 || target > 20000 || target === p.targetChars
          }
          onClick={() =>
            run(async () => {
              await onUpdate(
                await send(
                  base + "/writing-settings",
                  { revision: p.revision, targetChars: target },
                  "PUT",
                ),
              );
              notify(
                "목표 분량을 저장했습니다. 기존 플롯은 분량을 확인하고 다시 승인해주세요.",
              );
            })
          }
        >
          분량 저장
        </Button>
        {state?.canExtend && (
          <Button disabled={busy} onClick={() => run(generate)}>
            {state.nextStart}~{state.nextStart + 9}화 시놉시스 설계
          </Button>
        )}
        {!!episodes.length && (
          <Button
            variant="secondary"
            onClick={() => setShowRecords(!showRecords)}
          >
            {showRecords ? "시놉시스 접기" : "시놉시스 기록 보기"}
          </Button>
        )}
      </div>
      <p className="muted">
        목표 분량은 회차 전체 기준 2,000~20,000자입니다. AI 작성 분량에는 오차가
        생길 수 있으며 실제 글자 수는 집필실에서 확인합니다.
      </p>
      {p.episodeSynopsis && (
        <details>
          <summary>
            제{p.currentEpisode ?? 1}화 · {p.episodeSynopsis.title} 시놉시스
          </summary>
          <p>{p.episodeSynopsis.synopsis}</p>
          <p>변화: {p.episodeSynopsis.characterChange}</p>
          <p>다음 연결: {p.episodeSynopsis.endingHook}</p>
        </details>
      )}
      {showRecords && (
        <div className="scene-grid">
          {episodes.map((e: any) => (
            <article className="panel" key={e.number}>
              <h3>
                {e.number}화 · {e.title}
              </h3>
              <p>{e.synopsis}</p>
              <p>{e.characterChange}</p>
              <p>{e.endingHook}</p>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => run(() => select(e.number))}
              >
                이 회차 설계
              </Button>
            </article>
          ))}
        </div>
      )}
      {question && state && (
        <Modal
          title="다음 10화 시놉시스"
          onClose={() => !busy && setQuestion(false)}
        >
          <div className="modal-body">
            <h3>
              {state.nextStart}화부터 {state.nextStart + 9}화까지 시놉시스를
              만들까요?
            </h3>
            <p>확정한 이전 원고와 기획을 이어서 다음 구간을 설계합니다.</p>
            {error && <p role="alert">{error}</p>}
            <div className="button-row">
              <Button disabled={busy} onClick={() => run(generate)}>
                만들기
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setQuestion(false)}
              >
                나중에
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {proposal && (
        <Modal
          title={`${proposal.start}~${proposal.end}화 시놉시스 제안`}
          wide
          onClose={() => !busy && setProposal(null)}
        >
          <div className="modal-body">
            <p>{proposal.result.summary}</p>
            {proposal.result.episodes.map((e: any) => (
              <div className="panel" key={e.number}>
                <h3>
                  {e.number}화 · {e.title}
                </h3>
                <p>{e.synopsis}</p>
                <p>{e.characterChange}</p>
                <p>{e.endingHook}</p>
              </div>
            ))}
            <div className="button-row">
              <Button
                disabled={busy || proposal.inputRevision !== p.revision}
                onClick={() =>
                  run(async () => {
                    await onUpdate(
                      await send(base + "/synopsis/apply", {
                        revision: p.revision,
                        proposalId: proposal.id,
                        confirmed: true,
                      }),
                    );
                    setProposal(null);
                    setShowRecords(true);
                    notify("10화 시놉시스를 기록했습니다.");
                  })
                }
              >
                이 구간 기록
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
                기획이 변경됐습니다. 최신 기획에서 다시 설계해주세요.
              </p>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
