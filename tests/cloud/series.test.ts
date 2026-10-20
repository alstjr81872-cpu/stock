import { test } from "node:test";
import assert from "node:assert/strict";
import { fitLength, synopsisState } from "../../worker/series";
import fixtures from "./fixtures.json";
test("episode length is apportioned exactly without changing source scene IDs", () => {
  const plot = structuredClone(fixtures.plot),
    fitted = fitLength(plot, 6001);
  assert.equal(
    fitted.scenes.reduce((sum: number, sc: any) => sum + sc.targetChars, 0),
    6001,
  );
  assert.deepEqual(
    fitted.scenes.map((sc: any) => sc.id),
    plot.scenes.map((sc: any) => sc.id),
  );
  assert.notEqual(plot.scenes[0].targetChars, fitted.scenes[0].targetChars);
  assert.throws(
    () => fitLength(plot, 20000),
    (e: any) => e.status === 422,
  );
});
test("a following synopsis block requires all ten prior episodes, not merely episode ten", async () => {
  const store: any = {
    list: async () => [{ start: 1, end: 10, status: "APPLIED" }],
  };
  assert.equal(
    (await synopsisState(store, { completedEpisodes: [10] })).canExtend,
    false,
  );
  const state = await synopsisState(store, {
    completedEpisodes: Array.from({ length: 10 }, (_, i) => i + 1),
  });
  assert.equal(state.canExtend, true);
  assert.equal(state.nextStart, 11);
});
