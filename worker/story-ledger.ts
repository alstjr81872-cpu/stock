import { type Doc, requireThat as check } from "./shared";

export function validateStoryBatch(
  p: Doc,
  result: Doc,
  start: number,
  end: number,
) {
  const seeds = new Map<string, Doc>(
    (p.foreshadowing ?? []).map((s: Doc) => [s.id, s]),
  );
  const facts = new Map<string, Doc>(
    (p.storyFacts ?? []).map((f: Doc) => [f.id, f]),
  );
  check(
    new Set((result.seeds ?? []).map((s: Doc) => s.id)).size ===
      (result.seeds ?? []).length,
    "복선 ID가 중복됐습니다.",
    422,
  );
  check(
    new Set((result.worldFacts ?? []).map((s: Doc) => s.id)).size ===
      (result.worldFacts ?? []).length,
    "세계관 설정 ID가 중복됐습니다.",
    422,
  );
  for (const seed of result.seeds ?? []) {
    const old = seeds.get(seed.id);
    check(
      seed.payoffEpisode > seed.plantEpisode,
      "복선 회수는 투척 이후 회차로 지정해주세요.",
      422,
    );
    if (old)
      check(
        [
          "title",
          "plantEpisode",
          "payoffEpisode",
          "plantMethod",
          "payoffMethod",
        ].every((k) => old[k] === seed[k]),
        "이미 기록한 복선의 투척·회수 계획을 새 구간에서 바꿀 수 없습니다.",
        422,
      );
    else
      check(
        seed.plantEpisode >= start && seed.plantEpisode <= end,
        "새 복선은 현재 구간에서 투척하도록 지정해주세요.",
        422,
      );
    seeds.set(seed.id, old ?? { ...seed, status: "planned" });
  }
  for (const fact of result.worldFacts ?? []) {
    const old = facts.get(fact.id);
    if (old)
      check(
        old.statement === fact.statement &&
          old.introducedEpisode === fact.introducedEpisode,
        "이미 기록한 세계관 사실을 다른 내용으로 덮어쓸 수 없습니다.",
        422,
      );
    else
      check(
        fact.introducedEpisode >= start && fact.introducedEpisode <= end,
        "새 세계관은 실제 도입할 회차를 현재 구간에 지정해주세요.",
        422,
      );
    facts.set(fact.id, old ?? { ...fact, status: "planned" });
  }
  if (p.planningMode === "launch") {
    check(
      result.episodes.every(
        (e: Doc) =>
          e.openingHook?.trim().length >= 10 &&
          e.readerPayoff?.trim().length >= 10,
      ),
      "각 회차에 첫 흥미 장면과 독자가 체감할 보상을 지정해주세요.",
      422,
    );
    if (start === 1)
      check(seeds.size > 0, "첫 10화에 투척·회수할 복선을 지정해주세요.", 422);
  }
  for (const episode of result.episodes) {
    for (const [key, field] of [
      ["seedPlants", "plantEpisode"],
      ["seedPayoffs", "payoffEpisode"],
    ]) {
      const beats: Doc[] = episode[key] ?? [];
      check(
        new Set(beats.map((b) => b.seedId)).size === beats.length,
        "한 회차의 복선 배치가 중복됐습니다.",
        422,
      );
      for (const beat of beats)
        check(
          seeds.get(beat.seedId)?.[field] === episode.number,
          "시놉시스의 복선 ID 또는 투척·회수 회차가 기록과 다릅니다.",
          422,
        );
      for (const seed of seeds.values())
        if (seed[field] === episode.number)
          check(
            beats.some((b) => b.seedId === seed.id),
            `${episode.number}화에 예정된 복선 '${seed.title}'의 ${key === "seedPlants" ? "투척" : "회수"} 방법이 빠졌습니다.`,
            422,
          );
    }
  }
  for (const seed of seeds.values())
    check(
      !(seed.payoffEpisode < start && seed.status !== "paid"),
      "회수 예정 회차를 지난 미회수 복선이 있습니다. 이전 회차의 회수 확인부터 점검해주세요.",
      409,
    );
  return { seeds: [...seeds.values()], facts: [...facts.values()] };
}

export function checkPlotSeeds(p: Doc, plot: Doc) {
  check(Array.isArray(plot?.scenes), "회차의 장면을 먼저 설계해주세요.", 422);
  const episode = p.episodeSynopsis;
  for (const key of ["seedPlants", "seedPayoffs"]) {
    const required: string[] = (episode?.[key] ?? []).map((b: Doc) => b.seedId);
    const assigned = plot.scenes.flatMap((s: Doc) => s[key] ?? []);
    check(
      required.every((seed) => assigned.includes(seed)) &&
        assigned.every((seed: string) => required.includes(seed)),
      "이번 회차의 복선 투척·회수를 해당 장면에 빠짐없이 배치해주세요.",
      422,
    );
    check(
      new Set(assigned).size === assigned.length,
      "같은 복선을 여러 장면에서 중복 처리하지 마세요.",
      422,
    );
  }
}
export function storyContext(p: Doc) {
  const number = p.currentEpisode ?? 1;
  return {
    plan: p.launchPlan ?? null,
    worldFacts: (p.storyFacts ?? []).filter(
      (f: Doc) => f.introducedEpisode <= number,
    ),
    plants: (p.foreshadowing ?? [])
      .filter((s: Doc) => s.plantEpisode === number)
      .map((s: Doc) => ({
        id: s.id,
        title: s.title,
        plantMethod: s.plantMethod,
        payoffEpisode: s.payoffEpisode,
      })),
    payoffs: (p.foreshadowing ?? []).filter(
      (s: Doc) => s.payoffEpisode === number,
    ),
  };
}
export function confirmStoryBeats(p: Doc, ch: Doc, verified: string[] = []) {
  const number = p.currentEpisode ?? 1;
  const required = [
    ...(p.episodeSynopsis?.seedPlants ?? []),
    ...(p.episodeSynopsis?.seedPayoffs ?? []),
  ].map((b: Doc) => b.seedId);
  check(
    required.every((id: string) => verified.includes(id)),
    "이번 회차 원고에서 복선 투척·회수를 확인해주세요.",
    422,
  );
  for (const seed of p.foreshadowing ?? []) {
    const receipt = {
      chapterId: ch.id,
      contentHash: ch.contentHash,
      verifiedByAuthor: true,
    };
    if (seed.plantEpisode === number) {
      seed.status = "planted";
      seed.plantedIn = receipt;
    }
    if (seed.payoffEpisode === number) {
      check(
        seed.plantedIn && seed.status === "planted",
        "이전 회차에서 투척을 확인하지 않은 복선은 회수 완료로 기록할 수 없습니다.",
        422,
      );
      seed.status = "paid";
      seed.paidIn = receipt;
    }
  }
  for (const fact of p.storyFacts ?? [])
    if (fact.introducedEpisode === number) fact.status = "established";
}
