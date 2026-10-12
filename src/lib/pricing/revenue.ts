import {
  INITIAL_MARKET_IDENTITIES,
  type MarketId,
  type MarketRevenueAssumptions,
  type Provenance,
  type RevenueInputs,
  type RevenueResult,
} from "./config.ts";

const marketIds: readonly MarketId[] = INITIAL_MARKET_IDENTITIES.map(({ id }) => id);

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateProvenance(provenance: Provenance, label: string): void {
  if (!isRecord(provenance)) fail(`${label} provenance is required.`);
  if (provenance.status === "sourced") {
    if (typeof provenance.source !== "string" || provenance.source.trim() === "") {
      fail(`${label} sourced provenance requires a source.`);
    }
    if (typeof provenance.observedAt !== "string" || !isValidIsoDate(provenance.observedAt)) {
      fail(`${label} sourced provenance requires a valid ISO observation date.`);
    }
  } else if (provenance.status === "illustrative" || provenance.status === "user-configured") {
    if (typeof provenance.note !== "string" || provenance.note.trim() === "") {
      fail(`${label} ${provenance.status} provenance requires a note.`);
    }
  } else {
    fail(`${label} provenance has an unsupported status.`);
  }
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validateAssumptions(value: unknown, label: string): asserts value is MarketRevenueAssumptions {
  if (!isRecord(value)) fail(`${label} revenue assumptions are required.`);
  if (typeof value.audience !== "number" || !Number.isFinite(value.audience) || value.audience < 0) {
    fail(`${label} audience must be a non-negative finite number.`);
  }
  if (typeof value.conversionRate !== "number" || !Number.isFinite(value.conversionRate)
    || value.conversionRate < 0 || value.conversionRate > 1) {
    fail(`${label} conversion rate must be between 0 and 1.`);
  }
  if ("feeRate" in value && (typeof value.feeRate !== "number" || !Number.isFinite(value.feeRate)
    || value.feeRate < 0 || value.feeRate > 1)) {
    fail(`${label} fee rate must be between 0 and 1 when provided.`);
  }
  validateProvenance(value.provenance as Provenance, label);
}

function validatePrices(prices: unknown): asserts prices is RevenueInputs["pricesByMarket"] {
  if (!isRecord(prices)) fail("Prices by market are required.");
  for (const [id, price] of Object.entries(prices)) {
    const identity = INITIAL_MARKET_IDENTITIES.find((market) => market.id === id);
    if (!identity) fail(`Unsupported market id in prices: ${id}.`);
    if (!isRecord(price) || typeof price.amount !== "number" || !Number.isFinite(price.amount) || price.amount <= 0) {
      fail(`${identity.name} local price must be positive and finite.`);
    }
    if (price.currency !== identity.currency) fail(`${identity.name} local price currency must be ${identity.currency}.`);
  }
}

function validateInput(input: RevenueInputs): void {
  if (!isRecord(input)) fail("Revenue simulation inputs are required.");
  validatePrices(input.pricesByMarket);
  if (!isRecord(input.assumptionsByMarket)) fail("Market-specific assumptions must be an object.");

  for (const [id, assumptions] of Object.entries(input.assumptionsByMarket)) {
    if (!marketIds.includes(id as MarketId)) fail(`Unsupported market id in assumptions: ${id}.`);
    validateAssumptions(assumptions, `Market ${id}`);
  }

  const shared = input.sharedAssumptions;
  if (shared !== undefined) {
    if (!isRecord(shared)) fail("Shared scenario assumptions must be an object.");
    validateAssumptions(shared, "Shared scenario");
    if (typeof shared.label !== "string" || shared.label.trim() === "") {
      fail("Shared scenario assumptions require an explicit label.");
    }
    if (!Array.isArray(shared.marketIds) || shared.marketIds.length === 0) {
      fail("Shared scenario assumptions must list at least one applicable market.");
    }
    const seen = new Set<string>();
    for (const id of shared.marketIds) {
      if (!marketIds.includes(id as MarketId)) fail(`Unsupported market id in shared assumptions: ${String(id)}.`);
      if (seen.has(id)) fail(`Shared assumptions list market ${id} more than once.`);
      seen.add(id);
    }
  }

  for (const id of Object.keys(input.pricesByMarket)) {
    const hasMarketSpecific = input.assumptionsByMarket[id as MarketId] !== undefined;
    const sharedApplies = shared?.marketIds.includes(id as MarketId) ?? false;
    if (!hasMarketSpecific && !sharedApplies) {
      fail(`Market ${id} has a price but no applicable revenue assumptions.`);
    }
  }
}

function copyAssumptions(assumptions: MarketRevenueAssumptions): MarketRevenueAssumptions {
  return { ...assumptions, provenance: { ...assumptions.provenance } };
}

/**
 * Compute hypothetical per-market revenue scenarios from explicit local prices
 * and market-specific or explicitly shared assumptions. No forecast is implied.
 */
export function simulateRevenue(input: RevenueInputs): RevenueResult[] {
  validateInput(input);

  return marketIds.flatMap((marketId) => {
    const price = input.pricesByMarket[marketId];
    if (!price) return [];

    const marketAssumptions = input.assumptionsByMarket[marketId];
    const shared = input.sharedAssumptions?.marketIds.includes(marketId) ? input.sharedAssumptions : undefined;
    const assumptions = marketAssumptions ?? shared;
    if (!assumptions) return [];

    const expectedPurchases = assumptions.audience * assumptions.conversionRate;
    const grossAmount = expectedPurchases * price.amount;
    if (!Number.isFinite(expectedPurchases) || !Number.isFinite(grossAmount)) {
      fail(`Revenue scenario for ${marketId} exceeds finite numeric range.`);
    }
    const result: RevenueResult = {
      marketId,
      expectedPurchases,
      grossRevenue: { amount: grossAmount, currency: price.currency },
      assumptions: copyAssumptions(assumptions),
      assumptionMode: marketAssumptions ? "market-specific" : "shared-simplifying-assumption",
      ...(marketAssumptions ? {} : { assumptionLabel: shared?.label }),
      hypothetical: true,
    };
    if (assumptions.feeRate !== undefined) {
      const netAmount = grossAmount * (1 - assumptions.feeRate);
      if (!Number.isFinite(netAmount)) fail(`Net revenue scenario for ${marketId} exceeds finite numeric range.`);
      result.estimatedNet = { amount: netAmount, currency: price.currency };
    }
    return [result];
  });
}
