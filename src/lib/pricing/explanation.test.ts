import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_PURCHASING_POWER_METHOD, DEMO_STRATEGIES, makeIllustrativeMarkets } from "./demo-data.ts";
import { compareStrategies } from "./engine.ts";
import { explainCoffeeBenchmarkState, explainCoffeeContext, explainProvenance, explainRecommendation } from "./explanation.ts";
import {
  CANDIDATE_COFFEE_BENCHMARKS,
  makeIllustrativeCoffeeBenchmark,
  makeUserCoffeeBenchmark,
  resolveCoffeeBenchmark,
} from "./coffee-benchmark.ts";

test("explains the actual engine values in pipeline order and labels illustrative purchasing power", () => {
  const market = makeIllustrativeMarkets()[0];
  const strategy = DEMO_STRATEGIES[1];
  const basePrice = { amount: 4.99, currency: "USD" as const };
  const result = compareStrategies(basePrice, market, DEMO_STRATEGIES, DEMO_PURCHASING_POWER_METHOD)[1];
  const explanation = explainRecommendation(basePrice, market, strategy, result);

  assert.equal(explanation.length, 4);
  assert.match(explanation[0], /Convert .* at 1 USD per 1 USD/);
  assert.match(explanation[1], /illustrative purchasing-power factor 1×/);
  assert.match(explanation[1], /Apply illustrative purchasing-power factor/);
  assert.ok(explanation[1].includes(new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(result.localAnchor.amount)));
  assert.match(explanation[2], /Balanced strategy factor 1×/);
  assert.ok(explanation[3].includes(new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(result.finalPrice.amount)));
});

test("provenance explanations distinguish sourced, user-configured, and illustrative values", () => {
  assert.match(explainProvenance({ status: "sourced", source: "Synthetic test dataset", observedAt: "2026-01-02" }), /Sourced data: Synthetic test dataset, observed 2026-01-02/);
  assert.match(explainProvenance({ status: "user-configured", note: "Editable scenario assumption." }), /User-configured assumption/);
  assert.match(explainProvenance({ status: "illustrative", note: "Demo example only." }), /Illustrative demo assumption/);
});

test("coffee explanation is contextual and explicitly independent of recommendation steps", () => {
  const market = makeIllustrativeMarkets()[0];
  const result = compareStrategies({ amount: 4.99, currency: "USD" }, market, DEMO_STRATEGIES, DEMO_PURCHASING_POWER_METHOD)[1];
  const explanation = explainCoffeeContext(result, market);

  assert.match(explanation, /context only/);
  assert.match(explanation, /does not enter or change any recommendation step/);
  assert.ok(explanation.includes(String(result.coffeeEquivalent)));
});

test("unavailable coffee comparison is explained without invalidating the recommendation", () => {
  const market = makeIllustrativeMarkets()[0];
  const withoutBenchmark = { ...market, coffeePrice: undefined, coffeeProvenance: undefined };
  const result = compareStrategies(
    { amount: 4.99, currency: "USD" },
    withoutBenchmark,
    DEMO_STRATEGIES,
    DEMO_PURCHASING_POWER_METHOD,
  )[1];
  const explanation = explainCoffeeContext(result, withoutBenchmark);

  assert.ok(result.finalPrice.amount > 0);
  assert.equal(result.coffeeEquivalent, undefined);
  assert.match(explanation, /comparison is unavailable/);
  assert.match(explanation, /does not affect the app price/);
});

test("coffee status messaging distinguishes unconfigured, candidate, and eligible benchmarks", () => {
  const market = makeIllustrativeMarkets()[0];
  const basePrice = { amount: 4.99, currency: "USD" as const };
  const noBenchmarkMarket = { ...market, coffeePrice: undefined, coffeeProvenance: undefined };
  const noBenchmarkResult = compareStrategies(basePrice, noBenchmarkMarket, DEMO_STRATEGIES, DEMO_PURCHASING_POWER_METHOD)[1];
  const illustrative = resolveCoffeeBenchmark("US", makeIllustrativeCoffeeBenchmark("US", 4, "USD"), undefined, []);
  assert.match(explainCoffeeBenchmarkState(illustrative, noBenchmarkResult, noBenchmarkMarket), /^Coffee benchmark not configured\./);

  const candidate = resolveCoffeeBenchmark(
    "US",
    makeIllustrativeCoffeeBenchmark("US", 4, "USD"),
    undefined,
    CANDIDATE_COFFEE_BENCHMARKS,
  );
  const candidateMessage = explainCoffeeBenchmarkState(candidate, noBenchmarkResult, noBenchmarkMarket);
  assert.equal(candidateMessage, "Candidate coffee price available; ratio unavailable pending verification.");
  assert.equal(noBenchmarkResult.coffeeEquivalent, undefined);

  const observedAt = new Date().toISOString().slice(0, 10);
  const userEntered = makeUserCoffeeBenchmark("US", {
    amount: "4.5",
    coffeeType: "Regular cappuccino",
    city: "Boston",
    sourceNote: "Personal observation",
    observedAt,
  });
  const eligibleBenchmark = userEntered.benchmark!;
  const eligibleMarket = {
    ...noBenchmarkMarket,
    coffeePrice: eligibleBenchmark.price,
    coffeeProvenance: { status: "user-configured" as const, note: "User-entered, not independently verified." },
  };
  const eligibleResult = compareStrategies(basePrice, eligibleMarket, DEMO_STRATEGIES, DEMO_PURCHASING_POWER_METHOD)[1];
  assert.ok(eligibleResult.coffeeEquivalent !== undefined);
  assert.equal(
    explainCoffeeBenchmarkState(userEntered, eligibleResult, eligibleMarket),
    explainCoffeeContext(eligibleResult, eligibleMarket),
  );
  assert.match(explainCoffeeBenchmarkState(userEntered, eligibleResult, eligibleMarket), /about .* coffee equivalents/);

  const verifiedRecord = {
    ...eligibleBenchmark,
    status: "verified" as const,
    sourceName: "Synthetic verified test fixture",
    sourceUrl: "https://example.com/coffee-price",
    verifiedAt: observedAt,
  };
  const verified = resolveCoffeeBenchmark("US", makeIllustrativeCoffeeBenchmark("US", 4, "USD"), undefined, [verifiedRecord]);
  assert.equal(verified.status, "verified");
  assert.equal(explainCoffeeBenchmarkState(verified, eligibleResult, eligibleMarket), explainCoffeeContext(eligibleResult, eligibleMarket));
});
