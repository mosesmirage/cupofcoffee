import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_STRATEGY_FACTORS } from "./config.ts";
import { DEFAULT_STRATEGY_FACTOR_TEXT, parseStrategyPreferences } from "./strategy-preferences.ts";

test("strategy defaults are editable product assumptions at the selected starting factors", () => {
  assert.deepEqual(DEFAULT_STRATEGY_FACTORS, { accessible: 0.8, balanced: 1, premium: 1.25 });
  assert.deepEqual(DEFAULT_STRATEGY_FACTOR_TEXT, { accessible: "0.80", balanced: "1.00", premium: "1.25" });
});

test("saved strategy preferences preserve user-edited values and reject malformed storage", () => {
  assert.deepEqual(parseStrategyPreferences('{"accessible":"0.75","balanced":"1.05","premium":"1.3"}'), {
    accessible: "0.75", balanced: "1.05", premium: "1.3",
  });
  assert.equal(parseStrategyPreferences("not json"), undefined);
  assert.equal(parseStrategyPreferences('{"accessible":"0.8"}'), undefined);
});
