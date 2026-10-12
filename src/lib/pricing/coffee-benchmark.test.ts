import assert from "node:assert/strict";
import test from "node:test";
import {
  canShowCoffeeEquivalent,
  CANDIDATE_COFFEE_BENCHMARKS,
  clearCoffeeOverrideDraft,
  coffeeBenchmarkFreshness,
  coffeeComparisonForDisplay,
  coffeeEquivalentForBenchmark,
  coffeePricingContext,
  makeIllustrativeCoffeeBenchmark,
  makeUserCoffeeBenchmark,
  parseCoffeeOverrideDrafts,
  resolveCoffeeBenchmark,
  updateCoffeeOverrideDraft,
  validateCoffeeBenchmarkRecord,
  type CoffeeBenchmark,
  type CoffeeBenchmarkOverrideDraft,
} from "./coffee-benchmark.ts";
import { DEMO_PURCHASING_POWER_METHOD, DEMO_STRATEGIES, makeIllustrativeMarkets } from "./demo-data.ts";
import { compareStrategies } from "./engine.ts";
import { simulateRevenue } from "./revenue.ts";

const now = Date.UTC(2026, 9, 12);
const currentDate = "2026-10-01";
const userDraft: CoffeeBenchmarkOverrideDraft = {
  amount: "4.5",
  coffeeType: "Regular cappuccino",
  city: "Boston",
  sourceNote: "Observed at a local cafe",
  observedAt: currentDate,
};

function verifiedBenchmark(overrides: Partial<CoffeeBenchmark> = {}): CoffeeBenchmark {
  return {
    id: "reference-us-cappuccino",
    marketId: "US",
    city: "Boston",
    coffeeType: "Regular cappuccino",
    price: { amount: 4.5, currency: "USD" },
    sourceName: "Cafe menu",
    sourceUrl: "https://example.com/menu",
    observedAt: currentDate,
    verifiedAt: "2026-10-12",
    status: "verified",
    retrieval: "manual",
    notes: [],
    ...overrides,
  };
}

test("validates provenance, market currency, dates, and stable record IDs", () => {
  assert.deepEqual(validateCoffeeBenchmarkRecord(verifiedBenchmark()), []);
  assert.ok(validateCoffeeBenchmarkRecord(verifiedBenchmark({ id: "" })).some((error) => error.includes("stable ID")));
  assert.ok(validateCoffeeBenchmarkRecord(verifiedBenchmark({ price: { amount: 0, currency: "USD" } })).some((error) => error.includes("positive finite")));
  assert.ok(validateCoffeeBenchmarkRecord(verifiedBenchmark({ price: { amount: 4, currency: "EUR" } })).some((error) => error.includes("match its market")));
  assert.ok(validateCoffeeBenchmarkRecord(verifiedBenchmark({ sourceUrl: "javascript:alert(1)" })).some((error) => error.includes("HTTP or HTTPS")));
  assert.ok(validateCoffeeBenchmarkRecord(verifiedBenchmark({ observedAt: "not-a-date" })).some((error) => error.includes("Observation date")));
  assert.ok(validateCoffeeBenchmarkRecord(verifiedBenchmark({ sourceUrl: undefined })).some((error) => error.includes("source URL")));
});

test("calculates ratios only for valid, same-currency, dated current benchmarks", () => {
  const benchmark = verifiedBenchmark();
  assert.equal(coffeeEquivalentForBenchmark({ amount: 9, currency: "USD" }, benchmark, now), 2);
  assert.equal(coffeeEquivalentForBenchmark({ amount: 9, currency: "EUR" }, benchmark, now), undefined);
  assert.equal(coffeeEquivalentForBenchmark({ amount: 0, currency: "USD" }, benchmark, now), undefined);
  assert.equal(coffeeEquivalentForBenchmark({ amount: 9, currency: "USD" }, { ...benchmark, price: { amount: 0, currency: "USD" } }, now), undefined);
});

test("coffee comparison display handles eligible, demo candidate, missing, and incompatible benchmarks", () => {
  const eligibleResolution = {
    benchmark: verifiedBenchmark(), status: "verified" as const, errors: [], freshness: "current" as const,
  };
  assert.deepEqual(
    coffeeComparisonForDisplay({ amount: 9, currency: "USD" }, eligibleResolution, now),
    { status: "available", cups: 2, price: { amount: 4.5, currency: "USD" }, coffeeType: "Regular cappuccino", provenance: "verified" },
  );

  const candidate = CANDIDATE_COFFEE_BENCHMARKS[0];
  assert.deepEqual(coffeeComparisonForDisplay(
    { amount: 9, currency: "USD" },
    { benchmark: candidate, status: "candidate-unverified", errors: [], freshness: "undated" },
    now,
  ), { status: "available", cups: 9 / 5.25, price: candidate.price, coffeeType: candidate.coffeeType, provenance: "candidate-demo" });
  assert.deepEqual(coffeeComparisonForDisplay(
    { amount: 9, currency: "USD" },
    { status: "illustrative", errors: [], freshness: "undated" },
    now,
  ), { status: "unavailable" });
  assert.deepEqual(coffeeComparisonForDisplay(
    { amount: 9, currency: "EUR" },
    { ...eligibleResolution, benchmark: verifiedBenchmark({ price: { amount: 4.5, currency: "EUR" } }) },
    now,
  ), { status: "unavailable" });
});

test("demo cup comparisons use each existing candidate price and its matching local currency", () => {
  const appPrices = { US: { amount: 7, currency: "USD" }, TR: { amount: 300, currency: "TRY" }, UK: { amount: 6, currency: "GBP" }, DE: { amount: 7, currency: "EUR" } } as const;
  for (const candidate of CANDIDATE_COFFEE_BENCHMARKS) {
    const appPrice = appPrices[candidate.marketId];
    const comparison = coffeeEquivalentForBenchmark(appPrice, candidate, now, { allowCandidateDemo: true });
    assert.equal(comparison, appPrice.amount / candidate.price.amount);
  }
  assert.equal(coffeeEquivalentForBenchmark({ amount: 7, currency: "EUR" }, CANDIDATE_COFFEE_BENCHMARKS[0], now, { allowCandidateDemo: true }), undefined);
});

test("undated, stale, and illustrative benchmarks never produce a ratio", () => {
  const undated = verifiedBenchmark({ observedAt: undefined, verifiedAt: undefined });
  const stale = verifiedBenchmark({ observedAt: "2026-01-01", verifiedAt: "2026-10-12" });
  const illustrative = makeIllustrativeCoffeeBenchmark("US", 4, "USD");
  assert.equal(coffeeBenchmarkFreshness(undefined, now), "undated");
  assert.equal(coffeeBenchmarkFreshness("2026-01-01", now), "stale");
  assert.equal(canShowCoffeeEquivalent(undated, now), false);
  assert.equal(canShowCoffeeEquivalent(stale, now), false);
  assert.equal(canShowCoffeeEquivalent(illustrative, now), false);
  assert.equal(coffeeEquivalentForBenchmark({ amount: 5, currency: "USD" }, stale, now), undefined);
  assert.equal(coffeeEquivalentForBenchmark({ amount: 5, currency: "USD" }, illustrative, now), undefined);
});

test("user-entered values are labeled manual and never promoted to verified", () => {
  const result = makeUserCoffeeBenchmark("US", userDraft, Date.UTC(2026, 9, 12, 12));
  assert.equal(result.status, "user-entered");
  assert.equal(result.benchmark?.status, "user-entered");
  assert.equal(result.benchmark?.retrieval, "manual");
  assert.equal(result.benchmark?.verifiedAt, undefined);
  assert.deepEqual(validateCoffeeBenchmarkRecord(result.benchmark), []);
  assert.equal(coffeeEquivalentForBenchmark({ amount: 9, currency: "USD" }, result.benchmark!, now), 2);

  const incomplete = makeUserCoffeeBenchmark("US", { ...userDraft, amount: "" });
  assert.equal(incomplete.status, "needs-review");
  assert.equal(incomplete.benchmark, undefined);
  assert.ok(incomplete.errors.some((error) => error.includes("price")));
});

test("override editing, persistence parsing, and reset preserve the reference/demo record", () => {
  const updated = updateCoffeeOverrideDraft({}, "US", "amount", "4.5");
  const completed = updateCoffeeOverrideDraft(updated, "US", "coffeeType", "Regular cappuccino");
  const parsed = parseCoffeeOverrideDrafts(JSON.stringify(completed));
  assert.deepEqual(parsed.US, { amount: "4.5", coffeeType: "Regular cappuccino", city: "", sourceNote: "", observedAt: "" });

  const demo = makeIllustrativeCoffeeBenchmark("US", 4, "USD");
  const active = resolveCoffeeBenchmark("US", demo, parsed.US);
  assert.equal(active.status, "user-entered");
  assert.equal(active.freshness, "undated"); // no observation date: no ratio-eligible manual benchmark
  const reset = clearCoffeeOverrideDraft(parsed, "US");
  assert.equal(reset.US, undefined);
  assert.equal(resolveCoffeeBenchmark("US", demo, reset.US).benchmark?.id, demo.id);
  assert.equal(resolveCoffeeBenchmark("US", demo, reset.US).status, "illustrative");
  assert.equal(resolveCoffeeBenchmark("US", demo, reset.US, [verifiedBenchmark()], now).benchmark?.id, "reference-us-cappuccino");
  assert.deepEqual(parseCoffeeOverrideDrafts("not json"), {});
});

test("reference resolution does not promote an illustrative record", () => {
  const demo = makeIllustrativeCoffeeBenchmark("TR", 100, "TRY");
  const resolution = resolveCoffeeBenchmark("TR", demo, undefined, [demo]);
  assert.equal(resolution.status, "needs-review");
  assert.equal(resolution.benchmark, undefined);
});

test("candidate observations preserve their source details and remain unverified", () => {
  assert.equal(CANDIDATE_COFFEE_BENCHMARKS.length, 4);
  const expected = [
    ["US", 5.25, "USD", "New York City", "reported-in-store"],
    ["TR", 235, "TRY", undefined, "unknown"],
    ["UK", 4.3, "GBP", undefined, "unknown"],
    ["DE", 5.2, "EUR", undefined, "unknown"],
  ];
  for (const [index, benchmark] of CANDIDATE_COFFEE_BENCHMARKS.entries()) {
    assert.deepEqual(validateCoffeeBenchmarkRecord(benchmark), []);
    assert.deepEqual(
      [benchmark.marketId, benchmark.price.amount, benchmark.price.currency, benchmark.city, benchmark.priceType],
      expected[index],
    );
    assert.equal(benchmark.status, "candidate-unverified");
    assert.equal(benchmark.observedAt, undefined);
    assert.equal(benchmark.verifiedAt, undefined);
    assert.equal(benchmark.retrievedAt, undefined);
    assert.ok(benchmark.sourceUrl?.startsWith("https://"));
    assert.ok(benchmark.notes.length > 0);
    assert.equal(canShowCoffeeEquivalent(benchmark, now), false);
    assert.equal(coffeeEquivalentForBenchmark(benchmark.price, benchmark, now), undefined);
  }
  assert.equal(CANDIDATE_COFFEE_BENCHMARKS.find(({ marketId }) => marketId === "UK")?.sourceReportedAt, "2026-06");
  assert.equal(CANDIDATE_COFFEE_BENCHMARKS.find(({ marketId }) => marketId === "TR")?.additionalSources?.length, 1);
  const candidateResolution = resolveCoffeeBenchmark(
    "US",
    makeIllustrativeCoffeeBenchmark("US", 4, "USD"),
    undefined,
    CANDIDATE_COFFEE_BENCHMARKS,
    now,
  );
  assert.equal(candidateResolution.status, "candidate-unverified");
  assert.equal(candidateResolution.benchmark?.id, CANDIDATE_COFFEE_BENCHMARKS[0].id);
});

test("candidate coffee data cannot change recommendations or hypothetical revenue", () => {
  const basePrice = { amount: 4.99, currency: "USD" as const };
  const strategies = DEMO_STRATEGIES;
  for (const candidate of CANDIDATE_COFFEE_BENCHMARKS) {
    const market = makeIllustrativeMarkets().find(({ id }) => id === candidate.marketId)!;
    market.coffeePrice = undefined;
    market.coffeeProvenance = undefined;
    const baseline = compareStrategies(basePrice, market, strategies, DEMO_PURCHASING_POWER_METHOD);
    const candidateContext = coffeePricingContext(candidate, now);
    const withCandidate = compareStrategies(basePrice, { ...market, ...candidateContext }, strategies, DEMO_PURCHASING_POWER_METHOD);
    assert.deepEqual(withCandidate.map(({ finalPrice }) => finalPrice), baseline.map(({ finalPrice }) => finalPrice));

    const assumptions = { audience: 500, conversionRate: 0.025, feeRate: 0.15, provenance: { status: "user-configured" as const, note: "Synthetic regression fixture." } };
    const baselineRevenue = simulateRevenue({
      pricesByMarket: { [candidate.marketId]: baseline[1].finalPrice },
      assumptionsByMarket: { [candidate.marketId]: assumptions },
    });
    const candidateRevenue = simulateRevenue({
      pricesByMarket: { [candidate.marketId]: withCandidate[1].finalPrice },
      assumptionsByMarket: { [candidate.marketId]: assumptions },
    });
    assert.deepEqual(candidateRevenue, baselineRevenue);
    assert.deepEqual(candidateContext, {});
  }
});
