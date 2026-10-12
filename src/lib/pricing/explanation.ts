import type { ExchangeRateProvenance, Market, Money, Provenance, Strategy } from "./config.ts";
import type { PriceResult } from "./engine.ts";
import { provenanceLabel } from "./config.ts";
import type { CoffeeBenchmarkResolution } from "./coffee-benchmark.ts";

function formatMoney(money: Money): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: money.currency,
    maximumFractionDigits: 2,
  }).format(money.amount);
}

export function explainProvenance(provenance: Provenance | ExchangeRateProvenance): string {
  if (provenance.status === "identity") return `Identity rate: ${provenance.note}`;
  if (provenance.status === "sourced") {
    const date = provenance.observedAt ? `, observed ${provenance.observedAt}` : "";
    return `${provenanceLabel(provenance)}${provenance.source ? `: ${provenance.source}` : ""}${date}`;
  }
  return `${provenanceLabel(provenance)}${provenance.note ? `: ${provenance.note}` : ""}`;
}

/** Describe engine outputs without recalculating or changing the recommendation. */
export function explainRecommendation(
  basePrice: Money,
  market: Market,
  strategy: Strategy,
  result: PriceResult,
): string[] {
  return [
    `Convert ${formatMoney(basePrice)} at ${market.rateToLocal} ${market.currency} per 1 ${basePrice.currency} → ${formatMoney(result.convertedAnchor)}.`,
    `Apply ${market.purchasingPower.mode === "illustrative-factor" ? "illustrative " : ""}purchasing-power factor ${result.purchasingPowerFactor}× → ${formatMoney(result.localAnchor)}.`,
    `Apply ${strategy.label} strategy factor ${strategy.factor}× → ${formatMoney(result.strategyAnchor)}.`,
    `Round ${formatMoney(result.preRoundPrice)} to the nearest configured local point (lower point wins an exact tie) → ${formatMoney(result.finalPrice)}.`,
  ];
}

export function explainCoffeeContext(result: PriceResult, market: Market): string {
  if (result.coffeeEquivalent === undefined || !market.coffeePrice) {
    return "Coffee comparison is unavailable because no valid, provenance-labeled benchmark is configured. This does not affect the app price.";
  }
  return `Coffee is context only: ${formatMoney(result.finalPrice)} is about ${result.coffeeEquivalent} coffee equivalents at ${formatMoney(market.coffeePrice)}. Coffee price does not enter or change any recommendation step.`;
}

/** Describe benchmark availability without treating candidate data as a valid ratio input. */
export function explainCoffeeBenchmarkState(
  resolution: CoffeeBenchmarkResolution,
  result: PriceResult,
  market: Market,
): string {
  if (resolution.status === "candidate-unverified") {
    return "Candidate coffee price available; ratio unavailable pending verification.";
  }
  if (resolution.status === "illustrative") {
    return "Coffee benchmark not configured. An illustrative demo value may be shown, but no ratio is calculated.";
  }
  if (resolution.status === "needs-review") {
    return "Coffee benchmark needs review; no coffee-equivalent ratio is available.";
  }
  if (resolution.freshness === "stale") {
    return "Coffee price available, but its observation is older than 90 days; ratio unavailable.";
  }
  if (resolution.freshness === "undated" || resolution.freshness === "invalid-date") {
    return "Coffee price available, but it has no valid observation date; ratio unavailable.";
  }
  if (result.coffeeEquivalent === undefined) {
    return "Coffee price available, but no valid same-currency ratio is available.";
  }
  return explainCoffeeContext(result, market);
}
