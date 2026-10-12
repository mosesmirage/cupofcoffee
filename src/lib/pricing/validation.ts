import {
  INITIAL_MARKET_IDENTITIES,
  STRATEGY_DEFINITIONS,
  type DataStatus,
  type Market,
  type MarketId,
  type PurchasingPowerMethod,
  type Strategy,
  type StrategyId,
} from "./config.ts";

const dataStatuses: readonly DataStatus[] = ["sourced", "user-configured", "illustrative"];
const strategyOrder: readonly StrategyId[] = ["accessible", "balanced", "premium"];
const marketIds: readonly MarketId[] = INITIAL_MARKET_IDENTITIES.map(({ id }) => id);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validIsoDate(value: string): boolean {
  if (/^\d{4}$/.test(value)) return true;
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validateProvenance(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} provenance is required.`];

  const errors: string[] = [];
  const status = value.status;
  if (!dataStatuses.includes(status as DataStatus)) {
    return [`${path} provenance has an unsupported status.`];
  }

  if (status === "sourced") {
    if (typeof value.source !== "string" || value.source.trim() === "") {
      errors.push(`${path} sourced provenance requires a source.`);
    }
    if (typeof value.observedAt !== "string" || !validIsoDate(value.observedAt)) {
      errors.push(`${path} sourced provenance requires a valid ISO observation date.`);
    }
  } else if (typeof value.note !== "string" || value.note.trim() === "") {
    errors.push(`${path} ${status} provenance requires a note.`);
  }

  return errors;
}

function validateExchangeRateProvenance(value: unknown, path: string, rateToLocal: number): string[] {
  if (isRecord(value) && value.status === "identity") {
    if (typeof value.note !== "string" || value.note.trim() === "") {
      return [`${path} identity provenance requires an explanation.`];
    }
    return rateToLocal === 1 ? [] : [`${path} identity rate must equal 1.`];
  }
  return validateProvenance(value, path);
}

function validateMethod(method: PurchasingPowerMethod): string[] {
  const errors: string[] = [];
  if (!isRecord(method)) return ["Purchasing-power method is required."];

  for (const field of ["indexName", "method", "units"] as const) {
    if (typeof method[field] !== "string" || method[field].trim() === "") {
      errors.push(`Purchasing-power method ${field} is required.`);
    }
  }
  if (!marketIds.includes(method.baseMarketId)) {
    errors.push("Purchasing-power method must name one of the four initial markets as its base.");
  }
  if (method.normalization !== "base-market-equals-1") {
    errors.push("Purchasing-power normalization must be base-market-equals-1.");
  }
  if (method.direction !== "higher-means-greater-purchasing-power") {
    errors.push("Purchasing-power direction must identify higher values with greater purchasing power.");
  }
  errors.push(...validateProvenance(method.provenance, "Purchasing-power method"));
  return errors;
}

function validateMarket(market: unknown, path: string, baseMarketId: MarketId): string[] {
  const errors: string[] = [];
  if (!isRecord(market)) return [`${path} configuration is required.`];
  const configuredMarket = market as unknown as Market;
  const identity = INITIAL_MARKET_IDENTITIES.find(({ id }) => id === configuredMarket.id);

  if (!identity) {
    errors.push(`${path} has an unsupported market id.`);
  } else {
    if (configuredMarket.name !== identity.name) errors.push(`${path} name does not match its market id.`);
    if (configuredMarket.currency !== identity.currency) errors.push(`${path} currency does not match its market id.`);
  }

  if (!isPositiveFinite(configuredMarket.rateToLocal)) errors.push(`${path} exchange rate must be positive and finite.`);
  errors.push(...validateExchangeRateProvenance(configuredMarket.exchangeRateProvenance, `${path} exchange rate`, configuredMarket.rateToLocal));

  const purchasingPower = configuredMarket.purchasingPower;
  if (!isRecord(purchasingPower)) {
    errors.push(`${path} purchasing-power input is required.`);
  } else if (purchasingPower.mode === "index") {
    if (!isPositiveFinite(purchasingPower.indexValue)) {
      errors.push(`${path} purchasing-power index value must be positive and finite.`);
    }
    if (isRecord(purchasingPower.provenance) && purchasingPower.provenance.status !== "sourced") {
      errors.push(`${path} index-derived purchasing-power data must be sourced; use an illustrative factor when reliable index data is unavailable.`);
    }
    errors.push(...validateProvenance(purchasingPower.provenance, `${path} purchasing-power index`));
  } else if (purchasingPower.mode === "illustrative-factor" || purchasingPower.mode === "relative-factor") {
    if (!isPositiveFinite(purchasingPower.factor)) {
      errors.push(`${path} illustrative purchasing-power factor must be positive and finite.`);
    }
    if (purchasingPower.mode === "illustrative-factor" && isRecord(purchasingPower.provenance) && purchasingPower.provenance.status !== "illustrative") {
      errors.push(`${path} demo purchasing-power factor must have illustrative provenance.`);
    }
    if (purchasingPower.mode === "relative-factor" && isRecord(purchasingPower.provenance) && !["sourced", "user-configured"].includes(String(purchasingPower.provenance.status))) {
      errors.push(`${path} relative purchasing-power factor must be sourced or user-configured.`);
    }
    errors.push(...validateProvenance(purchasingPower.provenance, `${path} purchasing-power factor`));
    if (configuredMarket.id === baseMarketId && purchasingPower.factor !== 1) {
      errors.push(purchasingPower.mode === "illustrative-factor"
        ? `${path} base-market illustrative purchasing-power factor must equal 1.`
        : `${path} base-market purchasing-power factor must equal 1.`);
    }
  } else {
    errors.push(`${path} purchasing-power mode must be index or illustrative-factor.`);
  }

  if (!Array.isArray(configuredMarket.pricePoints) || configuredMarket.pricePoints.length === 0) {
    errors.push(`${path} price points must be a non-empty list.`);
  } else {
    let previous = 0;
    configuredMarket.pricePoints.forEach((point, index) => {
      if (!isPositiveFinite(point)) {
        errors.push(`${path} price point ${index + 1} must be positive and finite.`);
      } else if (point <= previous) {
        errors.push(`${path} price points must be strictly increasing with no duplicates.`);
      }
      previous = point;
    });
  }
  errors.push(...validateProvenance(configuredMarket.pricePointsProvenance, `${path} price points`));
  return errors;
}

function validateStrategies(strategies: readonly Strategy[]): string[] {
  if (!Array.isArray(strategies)) return ["Strategy configuration must be a list."];
  const errors: string[] = [];
  const seen = new Set<string>();
  const configuredById = new Map<string, Strategy>();

  strategies.forEach((strategy, index) => {
    const path = `Strategy ${index + 1}`;
    if (!isRecord(strategy)) {
      errors.push(`${path} configuration is required.`);
      return;
    }
    const configuredStrategy = strategy as unknown as Strategy;
    if (!strategyOrder.includes(configuredStrategy.id)) {
      errors.push(`${path} has an unsupported strategy id.`);
      return;
    }
    if (seen.has(configuredStrategy.id)) errors.push(`Strategy ${configuredStrategy.id} is configured more than once.`);
    seen.add(configuredStrategy.id);
    configuredById.set(configuredStrategy.id, configuredStrategy);

    const definition = STRATEGY_DEFINITIONS.find(({ id }) => id === configuredStrategy.id);
    if (configuredStrategy.label !== definition?.label) errors.push(`${path} label does not match its strategy id.`);
    if (!isPositiveFinite(configuredStrategy.factor)) errors.push(`${path} factor must be positive and finite.`);
    if (isRecord(configuredStrategy.provenance) && configuredStrategy.provenance.status === "sourced") {
      errors.push(`${path} factor is a product assumption and cannot be labeled as sourced market data.`);
    }
    errors.push(...validateProvenance(configuredStrategy.provenance, path));
  });

  for (const id of strategyOrder) {
    if (!seen.has(id)) errors.push(`Missing required ${id} strategy configuration.`);
  }

  const factors = strategyOrder.map((id) => configuredById.get(id)?.factor);
  if (factors.every(isPositiveFinite) && !(factors[0] <= factors[1] && factors[1] <= factors[2])) {
    errors.push("Strategy factors must be non-decreasing: Accessible ≤ Balanced ≤ Premium.");
  }
  return errors;
}

/** Validate complete configuration without calculating or filling any values. */
export function validatePricingConfig(
  markets: readonly Market[],
  strategies: readonly Strategy[],
  purchasingPowerMethod: PurchasingPowerMethod,
): string[] {
  if (!Array.isArray(markets)) return ["Market configuration must be a list."];
  const errors = validateMethod(purchasingPowerMethod);
  const seen = new Set<string>();
  const marketIdsConfigured = new Set<string>();

  markets.forEach((market, index) => {
    const path = `Market ${index + 1}`;
    if (!isRecord(market)) {
      errors.push(`${path} configuration is required.`);
      return;
    }
    if (typeof market.id === "string" && seen.has(market.id)) {
      errors.push(`Market ${market.id} is configured more than once.`);
    }
    if (typeof market.id === "string") marketIdsConfigured.add(market.id);
    seen.add(String(market.id));
    errors.push(...validateMarket(market, path, purchasingPowerMethod.baseMarketId));
  });

  for (const identity of INITIAL_MARKET_IDENTITIES) {
    if (!marketIdsConfigured.has(identity.id)) errors.push(`Missing required ${identity.name} market configuration.`);
  }
  if (!marketIdsConfigured.has(purchasingPowerMethod.baseMarketId)) {
    errors.push("Purchasing-power base market must be included in market configuration.");
  }

  errors.push(...validateStrategies(strategies));
  return errors;
}
