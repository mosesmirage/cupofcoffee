import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_MARKET_IDENTITIES,
  STRATEGY_DEFINITIONS,
  type Market,
  type Money,
  type Provenance,
  type PurchasingPowerMethod,
  type Strategy,
} from "./config.ts";
import {
  adjustForPurchasingPower,
  applyStrategyFactor,
  calculateCoffeeEquivalent,
  compareStrategies,
  convertCurrency,
  recommendPrice,
  roundToNearestPricePoint,
} from "./engine.ts";

const illustrative: Provenance = {
  status: "illustrative",
  note: "Synthetic test fixture only; not market data.",
};
const userConfigured: Provenance = {
  status: "user-configured",
  note: "Synthetic strategy assumption for tests.",
};
const method: PurchasingPowerMethod = {
  indexName: "Illustrative factor configuration",
  method: "Synthetic illustrative factors; no index-derived data is used.",
  baseMarketId: "US",
  units: "relative factor",
  normalization: "base-market-equals-1",
  direction: "higher-means-greater-purchasing-power",
  provenance: illustrative,
};

function makeMarket(overrides: Partial<Market> = {}): Market {
  const identity = INITIAL_MARKET_IDENTITIES[0];
  return {
    ...identity,
    rateToLocal: 1.25,
    exchangeRateProvenance: illustrative,
    purchasingPower: { mode: "illustrative-factor", factor: 1, provenance: illustrative },
    coffeePrice: { amount: 2, currency: identity.currency },
    coffeeProvenance: illustrative,
    pricePoints: [0.5, 1, 1.5, 2, 3, 5, 10],
    pricePointsProvenance: illustrative,
    ...overrides,
  };
}

function makeStrategies(factors = [0.8, 1, 1.2]): Strategy[] {
  return STRATEGY_DEFINITIONS.map((definition, index) => ({
    ...definition,
    factor: factors[index],
    provenance: userConfigured,
  }));
}

const basePrice: Money = { amount: 4, currency: "USD" };

test("keeps conversion, purchasing-power, and strategy adjustments in the documented order", () => {
  const converted = convertCurrency(basePrice, 2, "TRY");
  const adjusted = adjustForPurchasingPower(converted, 0.75);
  const strategyAdjusted = applyStrategyFactor(adjusted, 1.2);

  assert.deepEqual(converted, { amount: 8, currency: "TRY" });
  assert.deepEqual(adjusted, { amount: 6, currency: "TRY" });
  assert.ok(Math.abs(strategyAdjusted.amount - 7.2) < Number.EPSILON * 8);
  assert.equal(strategyAdjusted.currency, "TRY");
});

test("recommendation returns every intermediate value, selected point, equivalent, and provenance", () => {
  const market = makeMarket();
  const strategy = makeStrategies()[1];
  const result = recommendPrice(basePrice, market, strategy, method);

  assert.deepEqual(result.convertedAnchor, { amount: 5, currency: "USD" });
  assert.equal(result.purchasingPowerFactor, 1);
  assert.deepEqual(result.localAnchor, { amount: 5, currency: "USD" });
  assert.deepEqual(result.strategyAnchor, { amount: 5, currency: "USD" });
  assert.deepEqual(result.preRoundPrice, { amount: 5, currency: "USD" });
  assert.deepEqual(result.finalPrice, { amount: 5, currency: "USD" });
  assert.equal(result.coffeeEquivalent, 2.5);
  assert.equal(result.provenance.purchasingPower.status, "illustrative");
  assert.equal(result.provenance.exchangeRate.note, illustrative.note);
});

test("pricing engine applies sourced relative purchasing-power factors", () => {
  const market = makeMarket({ purchasingPower: {
    mode: "relative-factor", factor: 1,
    provenance: { status: "sourced", source: "World Bank + Frankfurter", observedAt: "2025" },
  } });
  const result = recommendPrice(basePrice, market, makeStrategies()[1], method);
  assert.equal(result.finalPrice.amount, 5);
  assert.equal(result.provenance.purchasingPower.status, "sourced");
});

test("nearest-point rounding selects the closest value and breaks exact ties downward", () => {
  assert.equal(roundToNearestPricePoint(1.8, [1, 2, 3]), 2);
  assert.equal(roundToNearestPricePoint(2.5, [1, 2, 3]), 2);
  assert.equal(roundToNearestPricePoint(0.5, [0.25, 0.75]), 0.25);
});

test("rejects invalid amounts, rates, factors, currencies, and price-point lists", () => {
  assert.throws(() => convertCurrency({ amount: 0, currency: "USD" }, 1, "USD"), /positive and finite/);
  assert.throws(() => convertCurrency(basePrice, Number.NaN, "USD"), /positive and finite/);
  assert.throws(() => adjustForPurchasingPower({ amount: 1, currency: "USD" }, 0), /positive and finite/);
  assert.throws(() => applyStrategyFactor({ amount: 1, currency: "USD" }, Infinity), /positive and finite/);
  assert.throws(() => roundToNearestPricePoint(1, [1, 3, 2]), /strictly increasing/);
  assert.throws(() => roundToNearestPricePoint(1, [1, 1, 2]), /strictly increasing/);
  assert.throws(() => roundToNearestPricePoint(1, []), /non-empty/);
  assert.throws(() => recommendPrice(basePrice, makeMarket({ rateToLocal: -1 }), makeStrategies()[1], method), /positive and finite/);
  assert.throws(() => recommendPrice(basePrice, makeMarket({ purchasingPower: {
    mode: "illustrative-factor", factor: Number.NaN, provenance: illustrative,
  } }), makeStrategies()[1], method), /positive and finite/);
  assert.throws(() => recommendPrice(basePrice, makeMarket({ pricePoints: [1, 3, 2] }), makeStrategies()[1], method), /strictly increasing/);
  assert.throws(() => recommendPrice({ amount: 2, currency: "CAD" as Money["currency"] }, makeMarket(), makeStrategies()[1], method), /unsupported/);
});

test("rejects index mode rather than deriving or substituting an unsupported factor", () => {
  const market = makeMarket({
    purchasingPower: { mode: "index", indexValue: 0.7, provenance: {
      status: "sourced", source: "Synthetic source", observedAt: "2026-01-01",
    } },
  });
  assert.throws(() => recommendPrice(basePrice, market, makeStrategies()[1], method), /Index-mode purchasing power/);
});

test("coffee benchmark amount and provenance affect only the displayed coffee equivalent", () => {
  const strategy = makeStrategies()[1];
  const originalMarket = makeMarket();
  const original = recommendPrice(basePrice, originalMarket, strategy, method);
  const changedMarket = makeMarket({
    coffeePrice: { amount: 4, currency: "USD" },
    coffeeProvenance: { status: "user-configured", note: "Changed synthetic comparison only." },
  });
  const changed = recommendPrice(basePrice, changedMarket, strategy, method);

  assert.deepEqual(changed.finalPrice, original.finalPrice);
  assert.ok(original.coffeeEquivalent !== undefined && changed.coffeeEquivalent !== undefined);
  assert.equal(changed.coffeeEquivalent, original.coffeeEquivalent / 2);
  assert.equal(changed.provenance.coffee?.status, "user-configured");
  assert.equal(calculateCoffeeEquivalent({ amount: 5, currency: "USD" }, { amount: 2, currency: "USD" }), 2.5);
  assert.throws(() => calculateCoffeeEquivalent({ amount: 1, currency: "USD" }, { amount: 1, currency: "EUR" }), /must match/);
});

test("valid recommendation is produced when the coffee benchmark is missing or invalid", () => {
  const strategy = makeStrategies()[1];
  const baseline = recommendPrice(basePrice, makeMarket(), strategy, method);
  const missing = recommendPrice(basePrice, makeMarket({ coffeePrice: undefined, coffeeProvenance: undefined }), strategy, method);
  const invalidAmount = recommendPrice(basePrice, makeMarket({
    coffeePrice: { amount: 0, currency: "USD" },
  }), strategy, method);
  const invalidCurrency = recommendPrice(basePrice, makeMarket({
    coffeePrice: { amount: 2, currency: "EUR" },
  }), strategy, method);
  const unrepresentableEquivalent = recommendPrice(basePrice, makeMarket({
    coffeePrice: { amount: Number.MIN_VALUE, currency: "USD" },
  }), strategy, method);
  const invalidProvenance = recommendPrice(basePrice, makeMarket({ coffeeProvenance: undefined }), strategy, method);

  for (const result of [missing, invalidAmount, invalidCurrency, unrepresentableEquivalent, invalidProvenance]) {
    assert.deepEqual(result.finalPrice, baseline.finalPrice);
    assert.equal(result.coffeeEquivalent, undefined);
    assert.equal(result.provenance.coffee, undefined);
  }
});

test("removing the coffee benchmark never changes the recommended price", () => {
  const strategy = makeStrategies()[1];
  const baseline = recommendPrice(basePrice, makeMarket(), strategy, method);
  const removed = recommendPrice(basePrice, makeMarket({ coffeePrice: undefined, coffeeProvenance: undefined }), strategy, method);

  assert.deepEqual(removed.finalPrice, baseline.finalPrice);
  assert.equal(removed.coffeeEquivalent, undefined);
});

test("strategy comparison is ordered and remains non-decreasing after rounding, including ties", () => {
  const market = makeMarket({ pricePoints: [1, 2, 3, 4, 5, 6, 7] });
  const results = compareStrategies(basePrice, market, makeStrategies([0.9, 1, 1.1]), method);
  assert.deepEqual(results.map(({ strategyId }) => strategyId), ["accessible", "balanced", "premium"]);
  assert.ok(results[0].finalPrice.amount <= results[1].finalPrice.amount);
  assert.ok(results[1].finalPrice.amount <= results[2].finalPrice.amount);
  assert.deepEqual(results.map(({ finalPrice }) => finalPrice.amount), [4, 5, 5]);
});

test("rejects missing, duplicate, or out-of-order strategy factors", () => {
  const strategies = makeStrategies();
  assert.throws(() => compareStrategies(basePrice, makeMarket(), strategies.slice(0, 2), method), /Exactly one/);
  assert.throws(() => compareStrategies(basePrice, makeMarket(), [strategies[0], strategies[0], strategies[2]], method), /configured more than once/);
  assert.throws(() => compareStrategies(basePrice, makeMarket(), makeStrategies([1.1, 1, 1.2]), method), /non-decreasing/);
});

test("identical inputs produce deeply identical results", () => {
  const args = [basePrice, makeMarket(), makeStrategies()[0], method] as const;
  assert.deepEqual(recommendPrice(...args), recommendPrice(...args));
});

test("pricing accepts an explicitly labeled identity conversion rate", () => {
  const market = makeMarket({
    rateToLocal: 1,
    exchangeRateProvenance: {
      status: "identity",
      note: "The base and market currencies are both USD.",
    },
  });
  const result = recommendPrice(basePrice, market, makeStrategies()[1], method);
  assert.equal(result.convertedAnchor.amount, basePrice.amount);
  assert.equal(result.provenance.exchangeRate.status, "identity");
});
