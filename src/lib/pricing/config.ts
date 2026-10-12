/** Provenance status is part of every configured market or strategy value. */
export type DataStatus = "sourced" | "user-configured" | "illustrative";

export type Provenance = {
  status: DataStatus;
  source?: string;
  /** Source observation date (YYYY-MM-DD), month precision (YYYY-MM), or annual period (YYYY). */
  observedAt?: string;
  note?: string;
};

export type IdentityRateProvenance = {
  status: "identity";
  note: string;
};

export type ExchangeRateProvenance = Provenance | IdentityRateProvenance;

export type MarketId = "US" | "TR" | "UK" | "DE";
export type CurrencyCode = "USD" | "TRY" | "GBP" | "EUR";

export type MarketIdentity = {
  id: MarketId;
  name: string;
  currency: CurrencyCode;
};

/** Identity metadata only; this intentionally contains no market seed values. */
export const INITIAL_MARKET_IDENTITIES = [
  { id: "US", name: "United States", currency: "USD" },
  { id: "TR", name: "Türkiye", currency: "TRY" },
  { id: "UK", name: "United Kingdom", currency: "GBP" },
  { id: "DE", name: "Germany", currency: "EUR" },
] as const satisfies readonly MarketIdentity[];

export type Money = {
  amount: number;
  currency: CurrencyCode;
};

export type PurchasingPowerInput =
  | {
      mode: "index";
      indexValue: number;
      provenance: Provenance;
    }
  | {
      mode: "illustrative-factor";
      factor: number;
      provenance: Provenance;
    }
  | {
      mode: "relative-factor";
      factor: number;
      provenance: Provenance;
    };

/** Complete market configuration shape. No instances are seeded in Task 2. */
export type Market = MarketIdentity & {
  rateToLocal: number;
  exchangeRateProvenance: ExchangeRateProvenance;
  purchasingPower: PurchasingPowerInput;
  coffeePrice?: Money;
  coffeeProvenance?: Provenance;
  pricePoints: number[];
  pricePointsProvenance: Provenance;
};

export const STRATEGY_DEFINITIONS = [
  { id: "accessible", label: "Accessible" },
  { id: "balanced", label: "Balanced" },
  { id: "premium", label: "Premium" },
] as const;

export type StrategyId = (typeof STRATEGY_DEFINITIONS)[number]["id"];

/** Initial editable product assumptions; these are not empirically calibrated. */
export const DEFAULT_STRATEGY_FACTORS: Readonly<Record<StrategyId, number>> = {
  accessible: 0.8,
  balanced: 1,
  premium: 1.25,
};

/** Factors are supplied by configuration; no empirical defaults are included. */
export type Strategy = {
  id: StrategyId;
  label: (typeof STRATEGY_DEFINITIONS)[number]["label"];
  factor: number;
  provenance: Provenance;
};

export type PurchasingPowerMethod = {
  indexName: string;
  method: string;
  baseMarketId: MarketId;
  units: string;
  normalization: "base-market-equals-1";
  direction: "higher-means-greater-purchasing-power";
  provenance: Provenance;
};

export type MarketRevenueAssumptions = {
  audience: number;
  conversionRate: number;
  feeRate?: number;
  provenance: Provenance;
};

export type RevenueConfiguration = {
  assumptionsByMarket: Partial<Record<MarketId, MarketRevenueAssumptions>>;
  sharedAssumptions?: MarketRevenueAssumptions & {
    label: string;
    marketIds: MarketId[];
  };
};

export type RevenueInputs = RevenueConfiguration & {
  pricesByMarket: Partial<Record<MarketId, Money>>;
};

export type RevenueResult = {
  marketId: MarketId;
  expectedPurchases: number;
  grossRevenue: Money;
  estimatedNet?: Money;
  assumptions: MarketRevenueAssumptions;
  assumptionMode: "market-specific" | "shared-simplifying-assumption";
  assumptionLabel?: string;
  hypothetical: true;
};

/** UI-friendly wording that preserves the distinction between provenance types. */
export function provenanceLabel(provenance: Provenance | IdentityRateProvenance): string {
  switch (provenance.status) {
    case "identity":
      return "Identity rate";
    case "sourced":
      return "Sourced data";
    case "user-configured":
      return "User-configured assumption";
    case "illustrative":
      return "Illustrative demo assumption";
  }
}
