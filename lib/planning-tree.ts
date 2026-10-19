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
// Prefer the longest registered name. Never replace another person's longer
// name, an ambiguous alias, an entity ID, or part of an unrelated word.
export function replaceEntityName(
  text: string,
  entities: TreeRecord[],
  entityId: string,
  replacement: string,
): string {
  const owners = new Map<string, Set<string>>();
  for (const e of entities)
    for (const name of [e.name, ...(e.aliases ?? [])]) {
      if (typeof name !== "string" || name.trim().length < 2) continue;
      const set = owners.get(name) ?? new Set<string>();
      set.add(e.id);
      owners.set(name, set);
    }
  const names = [...owners.keys()].sort((a, b) => b.length - a.length);
  if (!names.length) return text;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(
    "\\{\\{entity:[A-Za-z0-9_-]+\\}\\}|" + escaped.join("|"),
    "gu",
  );
  return text.replace(pattern, (match, offset: number) => {
    const set = owners.get(match);
    if (!set || set.size !== 1 || !set.has(entityId)) return match;
    const before = text.slice(0, offset).at(-1) ?? "";
    const after = text.slice(offset + match.length);
    if (/[\p{L}\p{N}_]/u.test(before)) return match;
    if (
      /^[\p{L}\p{N}_]/u.test(after) &&
      !/^(?:은|는|이|가|을|를|와|과|의|에|도|만|로|으로|에게|처럼|보다|부터|까지|이라|라고|라는|이다|였다)/u.test(
        after,
      )
    )
      return match;
    return replacement;
  });
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
