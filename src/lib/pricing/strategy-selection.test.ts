import assert from "node:assert/strict";
import test from "node:test";
import { makeIllustrativeMarkets, DEMO_PURCHASING_POWER_METHOD, DEMO_STRATEGIES } from "./demo-data.ts";
import { compareStrategies } from "./engine.ts";
import { selectStrategyPrices } from "./strategy-selection.ts";

test("selects each market's exact rounded engine price for the chosen strategy", () => {
  const resultsByMarket = Object.fromEntries(makeIllustrativeMarkets().map((market) => [
    market.id,
    compareStrategies({ amount: 4.99, currency: "USD" }, market, DEMO_STRATEGIES, DEMO_PURCHASING_POWER_METHOD),
  ]));
  const selected = selectStrategyPrices(resultsByMarket, "premium");

  for (const [marketId, results] of Object.entries(resultsByMarket)) {
    const enginePrice = results.find(({ strategyId }) => strategyId === "premium")?.finalPrice;
    assert.ok(enginePrice);
    assert.strictEqual(selected[marketId as keyof typeof selected], enginePrice);
  }
});

test("changing the selected strategy returns that strategy's local final price", () => {
  const markets = makeIllustrativeMarkets();
  const resultsByMarket = Object.fromEntries(markets.map((market) => [
    market.id,
    compareStrategies({ amount: 4.99, currency: "USD" }, market, DEMO_STRATEGIES, DEMO_PURCHASING_POWER_METHOD),
  ]));
  const balanced = selectStrategyPrices(resultsByMarket, "balanced");
  const premium = selectStrategyPrices(resultsByMarket, "premium");
  const ukBalanced = resultsByMarket.UK?.find(({ strategyId }) => strategyId === "balanced")?.finalPrice;
  const ukPremium = resultsByMarket.UK?.find(({ strategyId }) => strategyId === "premium")?.finalPrice;

  assert.ok(ukBalanced && ukPremium);
  assert.strictEqual(balanced.UK, ukBalanced);
  assert.strictEqual(premium.UK, ukPremium);
  assert.notEqual(balanced.UK?.amount, premium.UK?.amount);
});

test("does not expose an unavailable or invalid strategy price", () => {
  const market = makeIllustrativeMarkets()[0];
  const results = compareStrategies({ amount: 4.99, currency: "USD" }, market, DEMO_STRATEGIES, DEMO_PURCHASING_POWER_METHOD);
  const invalidResults = results.map((result) => result.strategyId === "premium"
    ? { ...result, finalPrice: { ...result.finalPrice, amount: Number.NaN } }
    : result);
  const selected = selectStrategyPrices({ US: invalidResults }, "premium");

  assert.equal(selected.US, undefined);
  assert.equal(selected.TR, undefined);
});
