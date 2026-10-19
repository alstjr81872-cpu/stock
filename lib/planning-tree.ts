export type TreeRecord = Record<string, any>;
export const branchLabels: Record<string, string> = {
  root: "작품의 중심",
  world: "세계관",
  characters: "인물",
  story: "스토리",
  style: "문체 · 연출",
};
export const moduleBranches: Record<string, string> = {
  concept: "root",
  protagonist: "characters",
  characters: "characters",
  relationships: "characters",
  world: "world",
  narrative: "story",
  fun: "story",
  density: "story",
  style: "style",
  special: "style",
  serial: "story",
};
export function renderReferences(text: string, entities: TreeRecord[]) {
  return (text ?? "").replace(
    /\{\{entity:([A-Za-z0-9_-]+)\}\}/g,
    (_all, key) =>
      entities.find((e) => e.id === key)?.name ?? `[연결 확인: ${key}]`,
  );
}
export function entityReferences(text: string): string[] {
  return [...(text ?? "").matchAll(/\{\{entity:([A-Za-z0-9_-]+)\}\}/g)].map(
    (m) => m[1],
  );
}
export function descendants(nodes: TreeRecord[], id: string): string[] {
  const result: string[] = [];
  const queue = [id];
  while (queue.length) {
    const next = queue.shift()!;
    for (const n of nodes)
      if (n.parentId === next && !result.includes(n.id) && n.id !== id) {
        result.push(n.id);
        queue.push(n.id);
      }
  }
  return result;
}

export const moduleLabels: Record<string, string> = {
  concept: "콘셉트",
  protagonist: "주인공",
  characters: "주요 인물",
  relationships: "관계망",
  world: "세계관",
  narrative: "장기 서사",
  fun: "독자 재미",
  density: "장면 밀도",
  style: "스타일 바이블",
  special: "장면별 연출",
  serial: "연재 운영",
};
