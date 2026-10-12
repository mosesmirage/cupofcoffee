import assert from "node:assert/strict";
import test from "node:test";
import type { MarketId, RevenueInputs, RevenueResult } from "./config.ts";
import { simulateRevenue } from "./revenue.ts";

const userProvenance = {
  status: "user-configured" as const,
  note: "Synthetic scenario assumption for tests.",
};

function marketAssumptions(audience: number, conversionRate: number, feeRate?: number) {
  return { audience, conversionRate, ...(feeRate === undefined ? {} : { feeRate }), provenance: userProvenance };
}

function input(overrides: Partial<RevenueInputs> = {}): RevenueInputs {
  return {
    assumptionsByMarket: { US: marketAssumptions(100, 0.1) },
    pricesByMarket: { US: { amount: 4, currency: "USD" } },
    ...overrides,
  };
}

function resultFor(results: RevenueResult[], marketId: MarketId): RevenueResult {
  const result = results.find((item) => item.marketId === marketId);
  assert.ok(result, `Expected a revenue result for ${marketId}`);
  return result;
}

test("calculates expected purchases and gross revenue using a fractional expectation", () => {
  const result = resultFor(simulateRevenue(input({
    assumptionsByMarket: { US: marketAssumptions(1_000, 0.025) },
    pricesByMarket: { US: { amount: 3.99, currency: "USD" } },
  })), "US");

  assert.equal(result.expectedPurchases, 25);
  assert.equal(result.grossRevenue.amount, 99.75);
  assert.equal(result.grossRevenue.currency, "USD");
  assert.equal(result.estimatedNet, undefined);
  assert.equal(result.hypothetical, true);
});

test("zero audience and zero conversion both produce zero scenario revenue", () => {
  const zeroAudience = resultFor(simulateRevenue(input({
    assumptionsByMarket: { US: marketAssumptions(0, 0.5, 0.3) },
  })), "US");
  assert.equal(zeroAudience.expectedPurchases, 0);
  assert.equal(zeroAudience.grossRevenue.amount, 0);
  assert.equal(zeroAudience.estimatedNet?.amount, 0);

  const zeroConversion = resultFor(simulateRevenue(input({
    assumptionsByMarket: { US: marketAssumptions(100, 0, 0) },
  })), "US");
  assert.equal(zeroConversion.expectedPurchases, 0);
  assert.equal(zeroConversion.grossRevenue.amount, 0);
  assert.equal(zeroConversion.estimatedNet?.amount, 0);
});

test("applies the optional fee rate to gross revenue", () => {
  const result = resultFor(simulateRevenue(input({
    assumptionsByMarket: { US: marketAssumptions(200, 0.25, 0.3) },
  })), "US");
  assert.equal(result.expectedPurchases, 50);
  assert.equal(result.grossRevenue.amount, 200);
  assert.equal(result.estimatedNet?.amount, 140);
  assert.equal(result.estimatedNet?.currency, "USD");
});

test("supports market-specific assumptions and prices with explicit currencies", () => {
  const results = simulateRevenue(input({
    assumptionsByMarket: {
      US: marketAssumptions(100, 0.1),
      TR: marketAssumptions(80, 0.2, 0.1),
      DE: marketAssumptions(50, 0.05),
    },
    pricesByMarket: {
      US: { amount: 5, currency: "USD" },
      TR: { amount: 60, currency: "TRY" },
      DE: { amount: 4, currency: "EUR" },
    },
  }));

  assert.deepEqual(results.map(({ marketId }) => marketId), ["US", "TR", "DE"]);
  assert.equal(resultFor(results, "US").grossRevenue.amount, 50);
  assert.equal(resultFor(results, "TR").grossRevenue.amount, 960);
  assert.equal(resultFor(results, "TR").estimatedNet?.amount, 864);
  assert.equal(resultFor(results, "DE").grossRevenue.currency, "EUR");
  assert.ok(results.every(({ assumptionMode, hypothetical }) => assumptionMode === "market-specific" && hypothetical));
});

test("shared assumptions are explicitly labeled and apply only to listed markets", () => {
  const results = simulateRevenue(input({
    assumptionsByMarket: {},
    sharedAssumptions: {
      ...marketAssumptions(40, 0.1),
      label: "Shared illustrative demo scenario for US and UK",
      marketIds: ["US", "UK"],
    },
    pricesByMarket: {
      US: { amount: 2, currency: "USD" },
      UK: { amount: 3, currency: "GBP" },
    },
  }));

  assert.deepEqual(results.map(({ marketId }) => marketId), ["US", "UK"]);
  assert.equal(results[0].assumptionMode, "shared-simplifying-assumption");
  assert.equal(results[0].assumptionLabel, "Shared illustrative demo scenario for US and UK");
  assert.equal(results[1].grossRevenue.currency, "GBP");
  assert.throws(() => simulateRevenue(input({
    assumptionsByMarket: {},
    sharedAssumptions: { ...marketAssumptions(40, 0.1), label: "US only", marketIds: ["US"] },
    pricesByMarket: { US: { amount: 2, currency: "USD" }, UK: { amount: 3, currency: "GBP" } },
  })), /UK has a price but no applicable revenue assumptions/);
});

test("market-specific assumptions take precedence over shared assumptions", () => {
  const results = simulateRevenue(input({
    assumptionsByMarket: { US: marketAssumptions(10, 0.5) },
    sharedAssumptions: {
      ...marketAssumptions(100, 0.1),
      label: "Shared scenario for US and UK",
      marketIds: ["US", "UK"],
    },
    pricesByMarket: { US: { amount: 2, currency: "USD" } },
  }));
  assert.equal(results[0].expectedPurchases, 5);
  assert.equal(results[0].assumptionMode, "market-specific");
  assert.equal(results[0].assumptionLabel, undefined);
});

test("rejects invalid audience, conversion, fee, price, currency, and assumption coverage", () => {
  const badInputs: Array<[string, RevenueInputs]> = [
    ["negative audience", input({ assumptionsByMarket: { US: marketAssumptions(-1, 0.5) } })],
    ["non-finite audience", input({ assumptionsByMarket: { US: marketAssumptions(Number.NaN, 0.5) } })],
    ["negative conversion", input({ assumptionsByMarket: { US: marketAssumptions(1, -0.01) } })],
    ["conversion above one", input({ assumptionsByMarket: { US: marketAssumptions(1, 1.01) } })],
    ["non-finite conversion", input({ assumptionsByMarket: { US: marketAssumptions(1, Infinity) } })],
    ["negative fee", input({ assumptionsByMarket: { US: marketAssumptions(1, 0.5, -0.01) } })],
    ["fee above one", input({ assumptionsByMarket: { US: marketAssumptions(1, 0.5, 1.01) } })],
    ["non-finite fee", input({ assumptionsByMarket: { US: marketAssumptions(1, 0.5, Number.NaN) } })],
    ["zero price", input({ pricesByMarket: { US: { amount: 0, currency: "USD" } } })],
    ["currency mismatch", input({ pricesByMarket: { US: { amount: 1, currency: "EUR" } } })],
    ["missing assumptions", input({ assumptionsByMarket: {}, sharedAssumptions: undefined })],
  ];

  for (const [label, value] of badInputs) {
    assert.throws(() => simulateRevenue(value), /./, label);
  }
});

test("requires a label and unique supported markets for shared assumptions", () => {
  const assumptions = marketAssumptions(10, 0.5);
  assert.throws(() => simulateRevenue(input({
    assumptionsByMarket: {},
    sharedAssumptions: { ...assumptions, label: " ", marketIds: ["US"] },
  })), /explicit label/);
  assert.throws(() => simulateRevenue(input({
    assumptionsByMarket: {},
    sharedAssumptions: { ...assumptions, label: "Shared", marketIds: ["US", "US"] },
  })), /more than once/);
});

test("identical inputs produce deterministic results", () => {
  const configured = input({
    assumptionsByMarket: { US: marketAssumptions(123, 0.17, 0.15) },
    pricesByMarket: { US: { amount: 4.25, currency: "USD" } },
  });
  assert.deepEqual(simulateRevenue(configured), simulateRevenue(configured));
});
