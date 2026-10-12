import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_MARKET_IDENTITIES,
  STRATEGY_DEFINITIONS,
  provenanceLabel,
  type Market,
  type Provenance,
  type PurchasingPowerMethod,
  type Strategy,
} from "./config.ts";
import { validatePricingConfig } from "./validation.ts";

const demoProvenance: Provenance = {
  status: "illustrative",
  note: "Synthetic validation fixture only; not market data.",
};

function makeMarkets(): Market[] {
  return INITIAL_MARKET_IDENTITIES.map((identity) => ({
    ...identity,
    rateToLocal: 1,
    exchangeRateProvenance: demoProvenance,
    purchasingPower: {
      mode: "illustrative-factor",
      factor: 1,
      provenance: demoProvenance,
    },
    coffeePrice: { amount: 1, currency: identity.currency },
    coffeeProvenance: demoProvenance,
    pricePoints: [1, 2, 3],
    pricePointsProvenance: demoProvenance,
  }));
}

function makeStrategies(factors = [0.8, 1, 1.2]): Strategy[] {
  return STRATEGY_DEFINITIONS.map((definition, index) => ({
    ...definition,
    factor: factors[index],
    provenance: { status: "user-configured", note: "Synthetic configurable factor for tests." },
  }));
}

const demoMethod: PurchasingPowerMethod = {
  indexName: "Illustrative factor configuration",
  method: "Synthetic factor-mode fixture; no index data used.",
  baseMarketId: "US",
  units: "ratio to base-market factor",
  normalization: "base-market-equals-1",
  direction: "higher-means-greater-purchasing-power",
  provenance: demoProvenance,
};

function errors(
  markets = makeMarkets(),
  strategies = makeStrategies(),
  method = demoMethod,
): string[] {
  return validatePricingConfig(markets, strategies, method);
}

test("defines all four initial market identities with their required currencies", () => {
  assert.deepEqual(
    INITIAL_MARKET_IDENTITIES.map(({ id, currency }) => [id, currency]),
    [["US", "USD"], ["TR", "TRY"], ["UK", "GBP"], ["DE", "EUR"]],
  );
});

test("accepts complete explicitly illustrative test configuration and ordered user factors", () => {
  assert.deepEqual(errors(), []);
});

test("accepts sourced relative purchasing-power factors with a US baseline", () => {
  const markets = makeMarkets();
  for (const market of markets) market.purchasingPower = {
    mode: "relative-factor", factor: 1,
    provenance: { status: "sourced", source: "World Bank + Frankfurter", observedAt: "2022" },
  };
  assert.deepEqual(errors(markets), []);
});

test("reports absent markets instead of filling them with assumed data", () => {
  const result = errors(makeMarkets().slice(0, 3));
  assert.ok(result.some((message) => message.includes("Missing required Germany market configuration")));
});

test("requires sourced inputs to include a source and valid observation date", () => {
  const markets = makeMarkets();
  markets[0].exchangeRateProvenance = { status: "sourced", source: "Example source" };
  const result = errors(markets);
  assert.ok(result.some((message) => message.includes("exchange rate sourced provenance requires a valid ISO observation date")));
});

test("requires illustrative purchasing-power factors to stay explicitly illustrative", () => {
  const markets = makeMarkets();
  markets[1].purchasingPower = {
    mode: "illustrative-factor",
    factor: 0.7,
    provenance: { status: "user-configured", note: "This is not a sourced index." },
  };
  const result = errors(markets);
  assert.ok(result.some((message) => message.includes("demo purchasing-power factor must have illustrative provenance")));
});

test("requires illustrative factors to explain the assumption and base factor to equal one", () => {
  const markets = makeMarkets();
  markets[0].purchasingPower = {
    mode: "illustrative-factor",
    factor: 0.9,
    provenance: { status: "illustrative", note: "Synthetic test factor." },
  };
  const result = errors(markets);
  assert.ok(result.some((message) => message.includes("base-market illustrative purchasing-power factor must equal 1")));

  markets[0].purchasingPower.provenance = { status: "illustrative" };
  assert.ok(errors(markets).some((message) => message.includes("purchasing-power factor illustrative provenance requires a note")));
});

test("rejects currency mismatches, invalid rates, and unsorted or duplicate price points", () => {
  const markets = makeMarkets();
  markets[0].currency = "EUR";
  markets[1].rateToLocal = Number.NaN;
  markets[2].pricePoints = [1, 3, 2];
  markets[3].pricePoints = [1, 1, 2];
  const result = errors(markets);
  assert.ok(result.some((message) => message.includes("currency does not match its market id")));
  assert.ok(result.some((message) => message.includes("exchange rate must be positive and finite")));
  assert.equal(result.filter((message) => message.includes("price points must be strictly increasing")).length, 2);
});

test("accepts an identity exchange rate only when the configured rate is exactly one", () => {
  const markets = makeMarkets();
  markets[0].rateToLocal = 1;
  markets[0].exchangeRateProvenance = {
    status: "identity",
    note: "The base and United States market currencies are both USD.",
  };
  assert.deepEqual(errors(markets), []);

  markets[0].rateToLocal = 1.25;
  assert.ok(errors(markets).some((message) => message.includes("identity rate must equal 1")));
});

test("coffee benchmark availability and validity do not block market configuration", () => {
  const markets = makeMarkets();
  delete markets[0].coffeePrice;
  delete markets[0].coffeeProvenance;
  markets[1].coffeePrice = { amount: Number.NaN, currency: "USD" };
  markets[2].coffeeProvenance = undefined;
  assert.deepEqual(errors(markets), []);
});

test("requires the full ordered strategy set and refuses empirical sourced factors", () => {
  const result = errors(makeMarkets(), makeStrategies([0.8, 1.2, 1]));
  assert.ok(result.some((message) => message.includes("Strategy factors must be non-decreasing")));

  const sourced = makeStrategies();
  sourced[0].provenance = { status: "sourced", source: "Example", observedAt: "2026-01-01" };
  assert.ok(errors(makeMarkets(), sourced).some((message) => message.includes("product assumption and cannot be labeled as sourced")));
  assert.ok(errors(makeMarkets(), makeStrategies().slice(0, 2)).some((message) => message.includes("Missing required premium strategy configuration")));
});

test("labels sourced, user-configured, and illustrative data distinctly for future UI use", () => {
  assert.equal(provenanceLabel({ status: "sourced", source: "Dataset", observedAt: "2026-01-01" }), "Sourced data");
  assert.equal(provenanceLabel({ status: "user-configured", note: "Assumption" }), "User-configured assumption");
  assert.equal(provenanceLabel(demoProvenance), "Illustrative demo assumption");
});
