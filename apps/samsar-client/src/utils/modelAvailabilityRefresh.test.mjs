import assert from "node:assert/strict";
import test from "node:test";

import {
  refreshModelAvailabilityCaches,
  subscribeToModelAvailabilityRefresh,
} from "./modelAvailabilityRefresh.mjs";

test("refreshes active cache listeners and ignores listeners after unsubscribe", async () => {
  const calls = [];
  const unsubscribeFirst = subscribeToModelAvailabilityRefresh(async () => {
    calls.push("first");
  });
  const unsubscribeSecond = subscribeToModelAvailabilityRefresh(() => {
    calls.push("second");
    throw new Error("individual cache refresh failed");
  });

  await refreshModelAvailabilityCaches();
  assert.deepEqual(calls, ["first", "second"]);

  unsubscribeFirst();
  unsubscribeSecond();
  await refreshModelAvailabilityCaches();
  assert.deepEqual(calls, ["first", "second"]);
});
