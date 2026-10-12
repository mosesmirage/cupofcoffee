import {
  DEFAULT_STRATEGY_FACTORS,
  INITIAL_MARKET_IDENTITIES,
  type CurrencyCode,
  type Market,
  type MarketId,
  type Provenance,
  type PurchasingPowerMethod,
  type Strategy,
} from "./config.ts";

const illustrativeProvenance: Provenance = {
  status: "illustrative",
  note: "Illustrative hackathon demo value; not verified market data.",
};

export type DemoMarketConfiguration = {
  id: MarketId;
  /** Synthetic local-currency units per one selected base-currency unit. */
  rateToLocalByBaseCurrency: Record<CurrencyCode, number>;
  purchasingPowerFactor: number;
  coffeePrice: number;
  pricePoints: number[];
};

/** All numeric values below are editable illustrative examples, not market data. */
export const DEMO_MARKET_CONFIGURATIONS: DemoMarketConfiguration[] = [
  {
    id: "US",
    rateToLocalByBaseCurrency: { USD: 1, TRY: 0.03125, GBP: 1.25, EUR: 1.087 },
    purchasingPowerFactor: 1,
    coffeePrice: 4,
    pricePoints: [0.99, 1.99, 2.99, 3.99, 4.99, 5.99, 7.99, 9.99, 14.99, 19.99, 29.99, 49.99],
  },
  {
    id: "TR",
    rateToLocalByBaseCurrency: { USD: 32, TRY: 1, GBP: 40, EUR: 34.78 },
    purchasingPowerFactor: 0.72,
    coffeePrice: 100,
    pricePoints: [9.99, 19.99, 29.99, 39.99, 49.99, 59.99, 79.99, 99.99, 149.99, 199.99, 299.99, 499.99, 999.99],
  },
  {
    id: "UK",
    rateToLocalByBaseCurrency: { USD: 0.8, TRY: 0.025, GBP: 1, EUR: 0.87 },
    purchasingPowerFactor: 0.96,
    coffeePrice: 3.5,
    pricePoints: [0.79, 1.49, 2.49, 3.49, 4.49, 5.99, 7.99, 9.99, 14.99, 19.99, 29.99],
  },
  {
    id: "DE",
    rateToLocalByBaseCurrency: { USD: 0.92, TRY: 0.02875, GBP: 1.15, EUR: 1 },
    purchasingPowerFactor: 0.98,
    coffeePrice: 3.5,
    pricePoints: [0.99, 1.99, 2.99, 3.99, 4.99, 5.99, 7.99, 9.99, 14.99, 19.99, 29.99],
  },
];

export const DEMO_STRATEGIES: Strategy[] = [
  { id: "accessible", label: "Accessible", factor: DEFAULT_STRATEGY_FACTORS.accessible, provenance: { status: "user-configured", note: "Editable product assumption; not empirically calibrated." } },
  { id: "balanced", label: "Balanced", factor: DEFAULT_STRATEGY_FACTORS.balanced, provenance: { status: "user-configured", note: "Editable product assumption; not empirically calibrated." } },
  { id: "premium", label: "Premium", factor: DEFAULT_STRATEGY_FACTORS.premium, provenance: { status: "user-configured", note: "Editable product assumption; not empirically calibrated." } },
];

export const DEMO_PURCHASING_POWER_METHOD: PurchasingPowerMethod = {
  indexName: "Illustrative user-configured adjustment factors",
  method: "Synthetic demo factors relative to United States baseline; no index data is used.",
  baseMarketId: "US",
  units: "relative multiplier; United States baseline equals 1",
  normalization: "base-market-equals-1",
  direction: "higher-means-greater-purchasing-power",
  provenance: illustrativeProvenance,
};

export function makeIllustrativeMarkets(
  rateOverrides: Partial<Record<MarketId, Partial<Record<CurrencyCode, number>>>> = {},
  purchasingPowerOverrides: Partial<Record<MarketId, number>> = {},
  coffeeOverrides: Partial<Record<MarketId, number>> = {},
  pricePointOverrides: Partial<Record<MarketId, number[]>> = {},
  baseCurrency: CurrencyCode = "USD",
): Market[] {
  return DEMO_MARKET_CONFIGURATIONS.map((configuration) => {
    const identity = INITIAL_MARKET_IDENTITIES.find((market) => market.id === configuration.id);
    if (!identity) throw new Error(`Missing identity for demo market ${configuration.id}.`);
    const rateToLocal = rateOverrides[configuration.id]?.[baseCurrency]
      ?? configuration.rateToLocalByBaseCurrency[baseCurrency];
    const factor = purchasingPowerOverrides[configuration.id] ?? configuration.purchasingPowerFactor;
    const coffeePrice = coffeeOverrides[configuration.id] ?? configuration.coffeePrice;
    return {
      ...identity,
      rateToLocal,
      exchangeRateProvenance: illustrativeProvenance,
      purchasingPower: { mode: "illustrative-factor", factor, provenance: illustrativeProvenance },
      coffeePrice: { amount: coffeePrice, currency: identity.currency },
      coffeeProvenance: illustrativeProvenance,
      pricePoints: pricePointOverrides[configuration.id] ?? configuration.pricePoints,
      pricePointsProvenance: illustrativeProvenance,
    };
  });
}
