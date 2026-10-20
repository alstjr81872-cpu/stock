import { test } from "node:test";
import assert from "node:assert/strict";
import { validateLaunchPlan } from "../../worker/launch";
import {
  validateStoryBatch,
  checkPlotSeeds,
  storyContext,
  confirmStoryBeats,
} from "../../worker/story-ledger";
import { launchPlan, seedPlan, storyBatch } from "./launch-fixtures";
import fixtures from "./fixtures.json";
test("compact file plans identify one stable protagonist without requiring interviews", () => {
  validateLaunchPlan(structuredClone(launchPlan));
  assert.throws(
    () =>
      validateLaunchPlan({
        ...structuredClone(launchPlan),
        protagonistId: "missing",
      }),
    (e: any) => e.status === 422,
  );
});
test("a seed planted in episode nine is required in episode seventeen with its saved method", () => {
  const first = validateStoryBatch(
    { planningMode: "launch" },
    storyBatch(1),
    1,
    10,
  );
  const p = {
    planningMode: "launch",
    foreshadowing: first.seeds.map((s: any) => ({ ...s, status: "planted" })),
    storyFacts: first.facts,
  };
  const next = validateStoryBatch(p, storyBatch(11), 11, 20);
  assert.equal(next.seeds[0].payoffEpisode, 17);
  assert.equal(next.seeds[0].payoffMethod, seedPlan.payoffMethod);
  const missing = storyBatch(11);
  missing.episodes[6].seedPayoffs = [];
  assert.throws(
    () => validateStoryBatch(p, missing, 11, 20),
    (e: any) => e.status === 422,
  );
  const moved = storyBatch(11);
  moved.seeds = [{ ...seedPlan, payoffEpisode: 18 }];
  assert.throws(
    () => validateStoryBatch(p, moved, 11, 20),
    (e: any) => e.status === 422,
  );
});
test("world facts cannot be silently retconned and future rules or answers do not leak into setup prose", () => {
  const first = validateStoryBatch(
    { planningMode: "launch" },
    storyBatch(1),
    1,
    10,
  );
  const p = {
    currentEpisode: 9,
    storyFacts: [
      ...first.facts,
      { id: "future", statement: "未来", introducedEpisode: 18 },
    ],
    foreshadowing: first.seeds,
  };
  const context = storyContext(p);
  assert(!context.worldFacts.some((f: any) => f.id === "future"));
  assert.equal(context.plants[0].payoffMethod, undefined);
  const bad = storyBatch(11);
  bad.worldFacts = [
    {
      ...first.facts[0],
      statement: "같은 설정 ID를 사용하지만 전혀 다른 규칙으로 바꾸려 한다.",
    },
  ];
  assert.throws(
    () => validateStoryBatch(p, bad, 11, 20),
    (e: any) => e.status === 422,
  );
});
test("payoff scenes must carry their due seed and only author-confirmed manuscripts complete it", () => {
  const p: any = {
    currentEpisode: 17,
    episodeSynopsis: storyBatch(11).episodes[6],
    foreshadowing: [
      { ...seedPlan, status: "planted", plantedIn: { chapterId: "chapter-9" } },
    ],
  };
  const plot: any = structuredClone(fixtures.plot);
  assert.throws(
    () => checkPlotSeeds(p, plot),
    (e: any) => e.status === 422,
  );
  plot.scenes[0].seedPayoffs = [seedPlan.id];
  checkPlotSeeds(p, plot);
  assert.throws(
    () => confirmStoryBeats(p, { id: "chapter-17", contentHash: "h" }, []),
    (e: any) => e.status === 422,
  );
  assert.equal(p.foreshadowing[0].status, "planted");
  confirmStoryBeats(p, { id: "chapter-17", contentHash: "h" }, [seedPlan.id]);
  assert.equal(p.foreshadowing[0].status, "paid");
  assert.equal(p.foreshadowing[0].paidIn.chapterId, "chapter-17");
});
