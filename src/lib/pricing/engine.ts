import {
  INITIAL_MARKET_IDENTITIES,
  STRATEGY_DEFINITIONS,
  type CurrencyCode,
  type ExchangeRateProvenance,
  type Market,
  type MarketId,
  type Money,
  type Provenance,
  type PurchasingPowerMethod,
  type Strategy,
  type StrategyId,
} from "./config.ts";

export type PriceResult = {
  marketId: MarketId;
  strategyId: StrategyId;
  convertedAnchor: Money;
  purchasingPowerFactor: number;
  localAnchor: Money;
  strategyAnchor: Money;
  preRoundPrice: Money;
  finalPrice: Money;
  coffeeEquivalent?: number;
  provenance: {
    exchangeRate: ExchangeRateProvenance;
    purchasingPower: Provenance;
    strategy: Provenance;
    coffee?: Provenance;
    pricePoints: Provenance;
  };
};

const strategyOrder: readonly StrategyId[] = ["accessible", "balanced", "premium"];
const marketIds: readonly MarketId[] = INITIAL_MARKET_IDENTITIES.map(({ id }) => id);

function fail(message: string): never {
  throw new Error(message);
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function hasValidProvenance(value: unknown): value is Provenance {
  if (!value || typeof value !== "object") return false;
  const provenance = value as Provenance;
  if (provenance.status === "sourced") {
    return typeof provenance.source === "string" && provenance.source.trim() !== ""
      && typeof provenance.observedAt === "string" && validObservationDate(provenance.observedAt);
  }
  if (provenance.status === "illustrative" || provenance.status === "user-configured") {
    return typeof provenance.note === "string" && provenance.note.trim() !== "";
  }
  return false;
}

function validObservationDate(value: string): boolean {
  if (/^\d{4}$/.test(value)) return true;
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validateProvenance(provenance: Provenance, label: string): void {
  if (!provenance || typeof provenance !== "object") fail(`${label} provenance is required.`);
  if (provenance.status === "sourced") {
    if (!provenance.source?.trim()) fail(`${label} sourced provenance requires a source.`);
    if (!provenance.observedAt || !validObservationDate(provenance.observedAt)) {
      fail(`${label} sourced provenance requires an observation date.`);
    }
  } else if (provenance.status === "illustrative" || provenance.status === "user-configured") {
    if (!provenance.note?.trim()) fail(`${label} ${provenance.status} provenance requires a note.`);
  } else {
    fail(`${label} provenance has an unsupported status.`);
  }
}

function validateExchangeRateProvenance(provenance: ExchangeRateProvenance, label: string, rateToLocal: number): void {
  if (provenance?.status === "identity") {
    if (!provenance.note?.trim()) fail(`${label} identity provenance requires an explanation.`);
    if (rateToLocal !== 1) fail(`${label} identity rate must equal 1.`);
    return;
  }
  validateProvenance(provenance, label);
}

function validateMethod(method: PurchasingPowerMethod): void {
  if (!method || typeof method !== "object") fail("Purchasing-power method is required.");
  if (!method.indexName?.trim() || !method.method?.trim() || !method.units?.trim()) {
    fail("Purchasing-power method name, method, and units are required.");
  }
  if (!marketIds.includes(method.baseMarketId)) fail("Purchasing-power method has an unsupported base market.");
  if (method.normalization !== "base-market-equals-1") fail("Unsupported purchasing-power normalization.");
  if (method.direction !== "higher-means-greater-purchasing-power") fail("Unsupported purchasing-power direction.");
  validateProvenance(method.provenance, "Purchasing-power method");
}

function validateMarket(market: Market, method: PurchasingPowerMethod): void {
  if (!market || typeof market !== "object") fail("Market configuration is required.");
  const identity = INITIAL_MARKET_IDENTITIES.find(({ id }) => id === market.id);
  if (!identity) fail("Market id is not one of the four supported markets.");
  if (market.name !== identity.name || market.currency !== identity.currency) {
    fail("Market name and currency must match its configured market identity.");
  }
  if (!isPositiveFinite(market.rateToLocal)) fail("Exchange rate must be positive and finite.");
  validateExchangeRateProvenance(market.exchangeRateProvenance, "Exchange rate", market.rateToLocal);

  if (!market.purchasingPower || market.purchasingPower.mode === "index") {
    fail("Index-mode purchasing power requires additional base-index input.");
  }
  if (!isPositiveFinite(market.purchasingPower.factor)) fail("Purchasing-power factor must be positive and finite.");
  if (!market.purchasingPower.provenance
    || (market.purchasingPower.mode === "illustrative-factor" && market.purchasingPower.provenance.status !== "illustrative")
    || (market.purchasingPower.mode === "relative-factor" && !["sourced", "user-configured"].includes(market.purchasingPower.provenance.status))) {
    fail("Purchasing-power demo factors must have illustrative provenance.");
  }
  validateProvenance(market.purchasingPower.provenance, "Purchasing-power factor");
  if (market.id === method.baseMarketId && market.purchasingPower.factor !== 1) {
    fail("Base-market purchasing-power factor must equal 1.");
  }

  if (!Array.isArray(market.pricePoints) || market.pricePoints.length === 0) {
    fail("Price points must be a non-empty list.");
  }
  let previous = 0;
  for (const point of market.pricePoints) {
    if (!isPositiveFinite(point)) fail("Price points must be positive and finite.");
    if (point <= previous) fail("Price points must be strictly increasing with no duplicates.");
    previous = point;
  }
  validateProvenance(market.pricePointsProvenance, "Price points");
}

function validateMoney(money: Money, label: string): void {
  if (!money || typeof money !== "object" || !isPositiveFinite(money.amount)) {
    fail(`${label} amount must be positive and finite.`);
  }
  if (typeof money.currency !== "string" || money.currency.trim() === "") fail(`${label} currency is required.`);
}

function validateStrategy(strategy: Strategy): void {
  if (!strategy || typeof strategy !== "object") fail("Strategy configuration is required.");
  const definition = STRATEGY_DEFINITIONS.find(({ id }) => id === strategy.id);
  if (!definition || strategy.label !== definition.label) fail("Strategy id and label must match a supported strategy.");
  if (!isPositiveFinite(strategy.factor)) fail("Strategy factor must be positive and finite.");
  if (strategy.provenance?.status === "sourced") fail("Strategy factors are product assumptions and cannot be labeled as sourced.");
  validateProvenance(strategy.provenance, "Strategy");
}

function validateBasePrice(basePrice: Money): void {
  validateMoney(basePrice, "Base price");
  if (!["USD", "TRY", "GBP", "EUR"].includes(basePrice.currency)) {
    fail("Base price currency is unsupported.");
  }
}

function requireFiniteResult(value: number, label: string): number {
  if (!Number.isFinite(value)) fail(`${label} calculation must be finite.`);
  return value;
}

/** Convert a base-currency amount using local-currency units per base-currency unit. */
export function convertCurrency(basePrice: Money, rateToLocal: number, localCurrency: CurrencyCode): Money {
  validateMoney(basePrice, "Base price");
  if (!isPositiveFinite(rateToLocal)) fail("Exchange rate must be positive and finite.");
  const amount = requireFiniteResult(basePrice.amount * rateToLocal, "Currency conversion");
  return { amount, currency: localCurrency };
}

/** Apply a positive purchasing-power factor to a converted local-currency anchor. */
export function adjustForPurchasingPower(converted: Money, factor: number): Money {
  validateMoney(converted, "Converted price");
  if (!isPositiveFinite(factor)) fail("Purchasing-power factor must be positive and finite.");
  return { amount: requireFiniteResult(converted.amount * factor, "Purchasing-power adjustment"), currency: converted.currency };
}

/** Apply the selected strategy factor to the purchasing-power-adjusted anchor. */
export function applyStrategyFactor(localAnchor: Money, factor: number): Money {
  validateMoney(localAnchor, "Local anchor");
  if (!isPositiveFinite(factor)) fail("Strategy factor must be positive and finite.");
  return { amount: requireFiniteResult(localAnchor.amount * factor, "Strategy adjustment"), currency: localAnchor.currency };
}

/** Choose the nearest supported point; an exact tie selects the lower price. */
export function roundToNearestPricePoint(amount: number, pricePoints: readonly number[]): number {
  if (!isPositiveFinite(amount)) fail("Pre-round price must be positive and finite.");
  if (!Array.isArray(pricePoints) || pricePoints.length === 0) fail("Price points must be a non-empty list.");
  let previous = 0;
  for (const point of pricePoints) {
    if (!isPositiveFinite(point)) fail("Price points must be positive and finite.");
    if (point <= previous) fail("Price points must be strictly increasing with no duplicates.");
    previous = point;
  }

  return pricePoints.reduce((nearest, point) => {
    const pointDistance = Math.abs(point - amount);
    const nearestDistance = Math.abs(nearest - amount);
    return pointDistance < nearestDistance || (pointDistance === nearestDistance && point < nearest) ? point : nearest;
  });
}

/** Coffee is a display-only comparison: amount = final app price / coffee price. */
export function calculateCoffeeEquivalent(finalPrice: Money, coffeePrice: Money): number {
  validateMoney(finalPrice, "Final price");
  validateMoney(coffeePrice, "Coffee benchmark");
  if (finalPrice.currency !== coffeePrice.currency) fail("Coffee benchmark currency must match the final price currency.");
  return requireFiniteResult(finalPrice.amount / coffeePrice.amount, "Coffee-equivalent");
}

function calculatePrice(basePrice: Money, market: Market, strategy: Strategy, method: PurchasingPowerMethod): PriceResult {
  validateMethod(method);
  validateMarket(market, method);
  validateStrategy(strategy);
  validateBasePrice(basePrice);
  if (market.purchasingPower.mode === "index") {
    fail("Index-mode purchasing power requires additional base-index input.");
  }

  const convertedAnchor = convertCurrency(basePrice, market.rateToLocal, market.currency);
  const localAnchor = adjustForPurchasingPower(convertedAnchor, market.purchasingPower.factor);
  const strategyAnchor = applyStrategyFactor(localAnchor, strategy.factor);
  const finalPrice = {
    amount: roundToNearestPricePoint(strategyAnchor.amount, market.pricePoints),
    currency: market.currency,
  };
  const coffeePrice = market.coffeePrice;
  const coffeeIsAvailable = coffeePrice !== undefined && coffeePrice !== null
    && typeof coffeePrice === "object"
    && isPositiveFinite(coffeePrice.amount)
    && coffeePrice.currency === market.currency
    && hasValidProvenance(market.coffeeProvenance)
    && Number.isFinite(finalPrice.amount / coffeePrice.amount);

  return {
    marketId: market.id,
    strategyId: strategy.id,
    convertedAnchor,
    purchasingPowerFactor: market.purchasingPower.factor,
    localAnchor,
    strategyAnchor,
    preRoundPrice: strategyAnchor,
    finalPrice,
    ...(coffeeIsAvailable ? { coffeeEquivalent: calculateCoffeeEquivalent(finalPrice, coffeePrice) } : {}),
    provenance: {
      exchangeRate: market.exchangeRateProvenance,
      purchasingPower: market.purchasingPower.provenance,
      strategy: strategy.provenance,
      ...(coffeeIsAvailable ? { coffee: market.coffeeProvenance } : {}),
      pricePoints: market.pricePointsProvenance,
    },
  };
}

/** Deterministic local recommendation from explicit inputs. */
export function recommendPrice(
  basePrice: Money,
  market: Market,
  strategy: Strategy,
  purchasingPowerMethod: PurchasingPowerMethod,
): PriceResult {
  return calculatePrice(basePrice, market, strategy, purchasingPowerMethod);
}

/** Calculate all three strategies in product order and enforce monotonic output. */
export function compareStrategies(
  basePrice: Money,
  market: Market,
  strategies: Strategy[],
  purchasingPowerMethod: PurchasingPowerMethod,
): PriceResult[] {
  if (!Array.isArray(strategies) || strategies.length !== strategyOrder.length) {
    fail("Exactly one Accessible, Balanced, and Premium strategy must be configured.");
  }
  const byId = new Map<StrategyId, Strategy>();
  for (const strategy of strategies) {
    validateStrategy(strategy);
    if (byId.has(strategy.id)) fail(`Strategy ${strategy.id} is configured more than once.`);
    byId.set(strategy.id, strategy);
  }
  const ordered = strategyOrder.map((id) => {
    const strategy = byId.get(id);
    if (!strategy) fail(`Missing required ${id} strategy configuration.`);
    return strategy;
  });
  if (!(ordered[0].factor <= ordered[1].factor && ordered[1].factor <= ordered[2].factor)) {
    fail("Strategy factors must be non-decreasing: Accessible ≤ Balanced ≤ Premium.");
  }

  const results = ordered.map((strategy) => calculatePrice(basePrice, market, strategy, purchasingPowerMethod));
  if (!(results[0].finalPrice.amount <= results[1].finalPrice.amount && results[1].finalPrice.amount <= results[2].finalPrice.amount)) {
    fail("Rounded strategy prices must remain non-decreasing.");
  }
  return results;
}
