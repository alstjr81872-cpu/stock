"use client";
import { useEffect, useState } from "react";
import {
  GitBranch,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Check,
  Users,
  AlertCircle,
  Link2,
  Save,
  History,
  BookOpen,
} from "lucide-react";
import { api, send, date } from "@/lib/api";
import {
  renderReferences,
  branchLabels,
  type TreeRecord,
} from "@/lib/planning-tree";
import { useActions, Modal, Badge } from "./workspace";
import { Button } from "./ui/button";
export default function PlanningTree({
  project,
  onUpdate,
  openDocuments,
  initialNode = "root",
}: {
  project: any;
  onUpdate: (p: any) => Promise<void>;
  openDocuments: () => void;
  initialNode?: string;
}) {
  const { run, busy, askAI, notify } = useActions();
  const [tree, setTree] = useState<any>(null),
    [loadError, setLoadError] = useState(""),
    [selected, setSelected] = useState(initialNode),
    [expanded, setExpanded] = useState<Set<string>>(new Set(["root"])),
    [proposal, setProposal] = useState<any>(null),
    [names, setNames] = useState<Record<string, string>>({}),
    [nameError, setNameError] = useState(""),
    [rename, setRename] = useState<{
      entityId: string;
      original: string;
      name: string;
      revision: number;
      reason?: string;
    } | null>(null),
    [history, setHistory] = useState<any[] | null>(null);
  const base = "/projects/" + project.id;
  useEffect(() => {
    let active = true;
    setNames({});
    api(base + "/tree")
      .then((t) => {
        if (active) setTree(t);
      })
      .catch((e) => setLoadError(e.message));
    return () => {
      active = false;
    };
  }, [project.id, project.revision]);
  useEffect(() => {
    setSelected(initialNode);
    setExpanded(new Set(["root", ...Object.keys(branchLabels)]));
  }, [initialNode]);
  async function update(p: any) {
    setTree(p.planningTree);
    await onUpdate(p);
  }
  function runRename(action: () => Promise<void>) {
    setNameError("");
    return run(async () => {
      try {
        await action();
      } catch (error) {
        setNameError(
          error instanceof Error
            ? error.message
            : "이름을 저장하지 못했습니다.",
        );
        throw error;
      }
    });
  }
  async function generate(
    nodeId: string,
    foundation = false,
    issueId?: string,
  ) {
    const path =
        base +
        (foundation ? "/tree/foundation" : "/tree/nodes/" + nodeId + "/expand"),
      data = { revision: project.revision, ...(issueId ? { issueId } : {}) };
    const max = await askAI(
      foundation
        ? "원문·인터뷰·기존 문서를 바탕으로 세계관·인물·스토리·문체의 공통 기획을 함께 잡습니다. 필요한 이름과 배경도 제안합니다."
        : "상위 기획과 연결된 인물·세계·사건을 참고해 선택한 가지를 구체화하고 관련 미정·충돌의 해결안을 만듭니다.",
      { path, data },
    );
    if (max === null) return;
    setProposal(await send(path, { ...data, consent: true, maxCostUsd: max }));
  }
  if (!tree)
    return (
      <div className="panel">
        <p>{loadError || "공통 기획 트리를 불러오고 있습니다."}</p>
        {loadError && (
          <Button
            onClick={() => run(async () => setTree(await api(base + "/tree")))}
          >
            다시 불러오기
          </Button>
        )}
      </div>
    );
  const node = tree.nodes.find((n: any) => n.id === selected) ?? tree.nodes[0];
  const entities: TreeRecord[] = tree.entities;
  const relatedEntities = entities.filter(
    (e) =>
      node.entityIds.includes(e.id) ||
      e.nodeIds.includes(node.id) ||
      node.content.includes("{{entity:" + e.id + "}}"),
  );
  const linked = tree.nodes.filter(
    (n: any) => node.dependsOn.includes(n.id) || n.dependsOn.includes(node.id),
  );
  const issues = tree.issues.filter((i: any) => i.status === "open");
  const nodeIssues = issues.filter(
    (i: any) =>
      i.nodeIds.includes(node.id) ||
      i.entityIds.some((e: string) => relatedEntities.some((n) => n.id === e)),
  );
  const breadcrumbs: any[] = [];
  let cursor = node;
  const seen = new Set();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    breadcrumbs.unshift(cursor);
    cursor = tree.nodes.find((n: any) => n.id === cursor.parentId);
  }
  function choose(id: string) {
    setSelected(id);
    const path: string[] = [];
    const seen = new Set<string>();
    let target = tree.nodes.find((n: any) => n.id === id);
    while (target && !seen.has(target.id)) {
      seen.add(target.id);
      path.push(target.id);
      target = tree.nodes.find((n: any) => n.id === target.parentId);
    }
    setExpanded((prev) => new Set([...prev, ...path, "root"]));
  }
  function renderNode(n: any, depth = 0): any {
    const children = tree.nodes.filter((c: any) => c.parentId === n.id),
      isOpen = expanded.has(n.id);
    return (
      <div key={n.id} className="planning-tree-row">
        <div
          className={
            "planning-tree-item " + (n.id === node.id ? "selected" : "")
          }
          style={{ paddingLeft: 12 + depth * 14 }}
        >
          <button
            type="button"
            aria-label={n.title + " 하위 가지"}
            aria-expanded={isOpen}
            disabled={!children.length}
            onClick={() =>
              setExpanded((prev) => {
                const s = new Set(prev);
                s.has(n.id) ? s.delete(n.id) : s.add(n.id);
                return s;
              })
            }
          >
            {children.length ? (
              isOpen ? (
                <ChevronDown size={15} />
              ) : (
                <ChevronRight size={15} />
              )
            ) : (
              <span className="tree-leaf-dot" />
            )}
          </button>
          <button
            type="button"
            className="tree-node-select"
            onClick={() => choose(n.id)}
          >
            {n.title}
            {n.status === "needsReview" && <AlertCircle size={13} />}
          </button>
        </div>
        {isOpen && children.map((c: any) => renderNode(c, depth + 1))}
      </div>
    );
  }
  return (
    <>
      <div className="planning-header">
        <div>
          <div className="eyebrow">CONNECTED STORY PLANNING</div>
          <h2>하나의 작품, 연결된 설계</h2>
          <p className="muted">
            큰 틀에서 시작해 가지를 펼치며 구체화합니다. 이름·설정·사건은 같은
            기획을 공유합니다.
          </p>
        </div>
        <Badge tone={tree.foundationReady ? "green" : "purple"}>
          {tree.foundationReady ? "공통 기획 연결됨" : "큰 틀부터 시작"}
        </Badge>
      </div>
      <div className="planning-stages">
        <div className={tree.foundationReady ? "complete" : "current"}>
          <strong>01 공통 기획</strong>
          <span>작품 · 세계 · 인물 · 이야기</span>
        </div>
        <div className={tree.foundationReady ? "current" : ""}>
          <strong>02 가지 구체화</strong>
          <span>이름 · 배경 · 관계 · 사건</span>
        </div>
        <div>
          <strong>03 연결 검수</strong>
          <span>미정 해결 · 상세 문서 · 승인</span>
        </div>
      </div>
      {!tree.foundationReady && (
        <div className="panel planning-start">
          <div>
            <h3>먼저 작품의 큰 틀을 함께 잡으세요</h3>
            <p>
              세계관의 제약, 인물의 목표, 이야기의 갈등을 한 번에 연결합니다.
              기존 {Object.keys(project.bible ?? {}).length}개 모듈과 원문은
              보존됩니다.
            </p>
          </div>
          <Button
            disabled={busy || !project.analysis}
            onClick={() => run(() => generate("root", true))}
          >
            <Sparkles size={17} />큰 틀 잡기
          </Button>
        </div>
      )}
      <div className="planning-grid">
        <aside className="panel planning-navigation">
          <div className="panel-heading">
            <h3>
              <GitBranch size={17} />
              기획 트리
            </h3>
            <small>{tree.nodes.length}개 가지</small>
          </div>
          <nav aria-label="작품 기획 트리">
            {tree.nodes
              .filter((n: any) => !n.parentId)
              .map((n: any) => renderNode(n))}
          </nav>
          <Button
            variant="ghost"
            onClick={() =>
              run(async () => setHistory(await api(base + "/tree/history")))
            }
          >
            <History size={15} />
            변경 이력
          </Button>
        </aside>
        <section className="panel planning-node-document">
          <div className="tree-breadcrumb">
            {breadcrumbs.map((n: any, i: number) => (
              <span key={n.id}>
                {i > 0 && " / "}
                <button onClick={() => choose(n.id)}>{n.title}</button>
              </span>
            ))}
          </div>
          <div className="panel-heading">
            <h2>{node.title}</h2>
            <Badge tone={node.status === "needsReview" ? "amber" : "purple"}>
              {node.status === "needsReview"
                ? "연결 검토 필요"
                : node.status === "ready"
                  ? "검토 완료"
                  : "기획 초안"}
            </Badge>
          </div>
          <div className="planning-node-text">
            {renderReferences(node.content, entities)}
          </div>
          {relatedEntities.length > 0 && (
            <div className="planning-entity-chips">
              {relatedEntities.map((e) => (
                <span className="badge" key={e.id}>
                  {e.name} · {e.role || e.kind}
                </span>
              ))}
            </div>
          )}
          <div className="button-row">
            <Button
              disabled={busy || !tree.foundationReady}
              onClick={() => run(() => generate(node.id))}
            >
              <Sparkles size={16} />
              {node.kind === "root" ? "중심 기획 다듬기" : "이 가지 구체화"}
            </Button>
            {tree.foundationReady && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await update(
                      await send(
                        base + "/tree/nodes/" + node.id + "/reviewed",
                        { revision: project.revision, confirmed: true },
                      ),
                    );
                    notify("선택한 가지의 연결 검토를 기록했습니다.");
                  })
                }
              >
                <Check size={15} />이 가지 검토 완료
              </Button>
            )}
          </div>
          <h3 className="tree-subheading">아래로 뻗어가는 기획</h3>
          <div className="planning-child-grid">
            {tree.nodes
              .filter((n: any) => n.parentId === node.id)
              .map((n: any) => (
                <button
                  className="planning-child"
                  key={n.id}
                  onClick={() => {
                    setSelected(n.id);
                    setExpanded(new Set([...expanded, node.id]));
                  }}
                >
                  <strong>{n.title}</strong>
                  <p>{renderReferences(n.content, entities).slice(0, 180)}</p>
                  <span>
                    펼쳐서 구체화 <ChevronRight size={14} />
                  </span>
                </button>
              ))}
          </div>
          {!tree.nodes.some((n: any) => n.parentId === node.id) && (
            <p className="muted">
              이 가지를 구체화하면 필요한 하위 설정과 연결이 생깁니다.
            </p>
          )}
          {node.requirementIds.length > 0 && (
            <details className="tree-evidence">
              <summary>원문 근거 {node.requirementIds.length}개</summary>
              {project.requirements
                .filter((r: any) => node.requirementIds.includes(r.id))
                .map((r: any) => (
                  <p key={r.id}>
                    <code>{r.id}</code> {r.text}
                  </p>
                ))}
            </details>
          )}
        </section>
        <aside className="planning-connections">
          <section className="panel">
            <h3>
              <Link2 size={17} />
              연결된 기획
            </h3>
            {linked.map((n: any) => (
              <button
                className="tree-link"
                key={n.id}
                onClick={() => choose(n.id)}
              >
                {n.title}
                <ChevronRight size={14} />
              </button>
            ))}
            {!linked.length && (
              <p className="muted">
                가지 구체화에서 인물·세계·사건의 연결을 만듭니다.
              </p>
            )}
          </section>
          <section className="panel">
            <h3>
              <AlertCircle size={17} />
              미정 · 충돌 <Badge tone="amber">{issues.length}</Badge>
            </h3>
            {(nodeIssues.length ? nodeIssues : issues)
              .slice(0, 12)
              .map((i: any) => (
                <div className="tree-issue" key={i.id}>
                  <small className="mono">{i.id}</small>
                  <strong>{renderReferences(i.title, entities)}</strong>
                  <p>{renderReferences(i.detail, entities)}</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || !tree.foundationReady}
                    onClick={() =>
                      run(() => generate(i.nodeIds[0], false, i.id))
                    }
                  >
                    <Sparkles size={14} />
                    연결해서 해결
                  </Button>
                </div>
              ))}
            {!issues.length && (
              <p className="muted">현재 기록된 미해결 항목이 없습니다.</p>
            )}
          </section>
        </aside>
      </div>
      <section className="panel planning-registry">
        <div className="panel-heading">
          <div>
            <h3>
              <Users size={18} />
              공통 인물 · 장소 · 세력
            </h3>
            <p className="muted">
              바꾸기를 누르면 기획 트리·인물 설명·상세 기획서의 이름을 함께
              갱신합니다.
            </p>
          </div>
          <Badge>{entities.length}개</Badge>
        </div>
        <div className="planning-registry-grid">
          {entities.map((e) => (
            <div className="planning-registry-card" key={e.id}>
              <small>
                {e.role || e.kind} · {e.id}
              </small>
              <strong>{e.name}</strong>
              <p>{renderReferences(e.description, entities)}</p>
              <div className="tree-name-edit">
                <input
                  aria-label={e.name + " 이름"}
                  value={names[e.id] ?? e.name}
                  onChange={(event) =>
                    setNames({ ...names, [e.id]: event.target.value })
                  }
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setNameError("");
                    setRename({
                      entityId: e.id,
                      original: e.name,
                      name: names[e.id] ?? e.name,
                      revision: project.revision,
                    });
                  }}
                >
                  <Save size={14} />
                  바꾸기
                </Button>
              </div>
            </div>
          ))}
        </div>
        {!entities.length && (
          <p className="muted">
            큰 틀 잡기에서 필요한 이름과 배경을 함께 기획합니다.
          </p>
        )}
      </section>
      <div className="panel planning-document-link">
        <div>
          <h3>분야별 상세 문서와 최종 검수</h3>
          <p className="muted">
            공통 기획을 바탕으로 11개 문서를 정리하고 문체·독립 검토·등록 승인을
            진행합니다.
          </p>
        </div>
        <Button variant="secondary" onClick={openDocuments}>
          <BookOpen size={16} />
          상세 모듈 보기
        </Button>
      </div>
      {rename && (
        <Modal title="이름 바꾸기" onClose={() => !busy && setRename(null)}>
          <div className="modal-body">
            <p>
              <strong>{rename.original}</strong>의 새 이름을 직접 입력하거나
              자동으로 제안받으세요.
            </p>
            <label className="field">
              새 이름
              <input
                aria-label="바꿀 새 이름"
                maxLength={100}
                value={rename.name}
                onChange={(event) =>
                  setRename({
                    ...rename,
                    name: event.target.value,
                    reason: undefined,
                  })
                }
              />
            </label>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                runRename(async () => {
                  const path =
                    base +
                    "/tree/entities/" +
                    rename.entityId +
                    "/suggest-name";
                  const data = { revision: rename.revision };
                  const max = await askAI(
                    "선택한 인물의 역할·배경과 작품 세계관에 맞는 새 이름 하나를 제안합니다. 확인 전에는 반영하지 않습니다.",
                    { path, data },
                  );
                  if (max === null) return;
                  const suggestion = await send(path, {
                    ...data,
                    consent: true,
                    maxCostUsd: max,
                  });
                  setRename({
                    ...rename,
                    name: suggestion.name,
                    reason: suggestion.reason,
                  });
                })
              }
            >
              <Sparkles size={15} /> 새 이름 자동 제안
            </Button>
            {rename.reason && <p>{rename.reason}</p>}
            {nameError && <p role="alert">{nameError}</p>}
            <p className="muted">
              기획 트리·등록부 설명·상세 기획서에서 같은 대상의 이름을 함께
              바꿉니다. 원문 자료와 이미 작성한 원고는 보존합니다. 동명이인처럼
              구분이 어려운 문장은 자동 치환하지 않습니다.
            </p>
            {rename.revision !== project.revision && (
              <p role="alert">
                기획이 변경되었습니다. 닫은 뒤 최신 이름으로 다시 시작해주세요.
              </p>
            )}
          </div>
          <footer className="modal-body button-row">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setRename(null)}
            >
              취소
            </Button>
            <Button
              disabled={
                busy ||
                !rename.name.trim() ||
                rename.name.trim() === rename.original ||
                rename.revision !== project.revision
              }
              onClick={() =>
                runRename(async () => {
                  const next = await send(
                    base + "/tree/entities/" + rename.entityId,
                    { revision: rename.revision, name: rename.name.trim() },
                    "PUT",
                  );
                  await update(next);
                  setNames((prev) => {
                    const n = { ...prev };
                    delete n[rename.entityId];
                    return n;
                  });
                  setRename(null);
                  notify("이름과 연결된 기획 문서를 함께 바꿨습니다.");
                })
              }
            >
              <Save size={15} /> 이 이름으로 바꾸기
            </Button>
          </footer>
        </Modal>
      )}
      {proposal && (
        <Modal title="연결된 기획 제안" wide onClose={() => setProposal(null)}>
          <div className="modal-body tree-proposal">
            <p>{proposal.patch.summary}</p>
            <h3>변경되는 가지</h3>
            {proposal.patch.nodes.map((n: any) => (
              <details
                className="panel"
                key={n.id}
                open={n.id === proposal.nodeId}
              >
                <summary>{n.title}</summary>
                <p>{renderReferences(n.content, proposal.preview.entities)}</p>
                <small>
                  연결:{" "}
                  {n.dependsOn
                    .map(
                      (k: string) =>
                        proposal.preview.nodes.find((d: any) => d.id === k)
                          ?.title,
                    )
                    .join(" · ") || "상위 기획"}
                </small>
              </details>
            ))}
            {proposal.patch.entities.length > 0 && (
              <>
                <h3>공통 이름 · 배경</h3>
                {proposal.patch.entities.map((e: any) => (
                  <div className="panel" key={e.id}>
                    <strong>
                      {e.name} · {e.role || e.kind}
                    </strong>
                    <p>
                      {renderReferences(
                        e.description,
                        proposal.preview.entities,
                      )}
                    </p>
                  </div>
                ))}
              </>
            )}
            {proposal.patch.issues.map((i: any) => (
              <div className="warning-box" key={i.id}>
                <strong>
                  {renderReferences(i.title, proposal.preview.entities)} ·{" "}
                  {i.status === "resolved" ? "해결안 있음" : "미해결"}
                </strong>
                <p>
                  {renderReferences(
                    i.resolution || i.detail,
                    proposal.preview.entities,
                  )}
                </p>
              </div>
            ))}
            <p className="muted">
              반환되지 않은 가지·미정·기존 문서는 그대로 보존됩니다. 적용하면
              연결된 설정을 재검토하며, 작품 승인이나 집필은 실행하지 않습니다.
            </p>
            <div className="button-row">
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await update(
                      await send(base + "/tree/apply", {
                        revision: project.revision,
                        proposalId: proposal.id,
                        confirmed: true,
                      }),
                    );
                    choose(proposal.nodeId);
                    setProposal(null);
                    notify(
                      "연결된 기획을 적용했습니다. 가지를 펼쳐 구체화하세요.",
                    );
                  })
                }
              >
                <Check size={16} />
                기획에 반영
              </Button>
              <Button variant="secondary" onClick={() => setProposal(null)}>
                현재 기획 유지
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {history && (
        <Modal title="공통 기획 변경 이력" onClose={() => setHistory(null)}>
          <div className="modal-body">
            {history.map((h: any, i: number) => (
              <details className="panel" key={h.id ?? i}>
                <summary>
                  {date(h.createdAt)} · {h.newName ? "이름 변경" : "기획 적용"}
                </summary>
                <pre>{JSON.stringify(h, null, 2)}</pre>
              </details>
            ))}
            {!history.length && <p>아직 적용된 변경이 없습니다.</p>}
          </div>
        </Modal>
      )}
    </>
  );
}
