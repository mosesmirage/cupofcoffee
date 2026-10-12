# Pricing Intelligence — Design

## Design principles

The engine is deterministic, local, and independent of AI. It exposes intermediate values and provenance. Sourced facts, user inputs, and illustrative demo assumptions are distinct. The output is a structured pricing suggestion, not a demand or revenue prediction.

## Pricing pipeline

For a reference price `P` in base currency, a target market, strategy, and explicit data/configuration:

1. **Currency conversion:** `converted = P × rateToLocal`. Define the exchange-rate direction as local currency units per one base-currency unit. Store its source, observation date, and status. This is a currency-only anchor, not a local recommendation.
2. **Purchasing-power adjustment:** `localAnchor = converted × purchasingPowerFactor`. Configure one comparable purchasing-power index for all markets in a run. The index must have a documented name/method, base market, observation date, units, normalization, direction, and provenance. Normalize the base-market value to `1`; normalize each target value as `targetIndexValue / baseIndexValue`. The exact factor is `purchasingPowerFactor = normalizedTargetIndex / normalizedBaseIndex` (equivalently `targetIndexValue / baseIndexValue` when both use the same index and units). The index's higher value must mean greater purchasing power; if the source uses the opposite direction, document and apply the inverse transformation before normalization. Thus a factor above `1` raises the converted anchor and a factor below `1` lowers it. This broad proxy does not measure app-specific willingness to pay. If reliable comparable index values are unavailable, use explicit, configurable demo factors with `illustrative` provenance and visible labels; never invent coefficients or present demo factors as verified.
3. **Strategy adjustment:** `strategyAnchor = localAnchor × strategyFactor`. Factors are visible product assumptions, not empirical estimates. Validate `accessibleFactor ≤ balancedFactor ≤ premiumFactor`; do not silently reorder or repair invalid configuration.
4. **Coffee comparison:** `coffeeEquivalent = finalPrice / coffeePrice`, using the final local price and the local benchmark in the same currency. Coffee is informational only in the MVP: it is not an input to any price calculation. Changing coffee benchmark amount or provenance must never change the recommendation.
5. **Local price-point rounding:** Select a point from the target market's explicit supported/configured point list. Use nearest absolute distance; on an exact tie, choose the lower point for every strategy. Apply the same monotonic rounding function to all strategies. Reject empty, non-positive, duplicate, or unsorted price-point lists; do not silently sort or repair them. Unsupported or illustrative points must be labeled as such in the UI. The selected point is the final recommendation.

Keep and return each intermediate value. No stage may be hidden inside an unexplained multiplier. Rates, factors, benchmarks, and price points with demo values carry `illustrative` status and are visibly labeled as assumptions. No initial market values or strategy coefficients are asserted by this document.

## Data structures (TypeScript shape)

```ts
type DataStatus = "sourced" | "user-configured" | "illustrative";
type Provenance = {
  status: DataStatus;
  source?: string;
  observedAt?: string;       // ISO date when applicable
  note?: string;
};
type Money = { amount: number; currency: string };
type PurchasingPowerInput =
  | { mode: "index"; indexValue: number; provenance: Provenance }
  | { mode: "illustrative-factor"; factor: number; provenance: Provenance };
type Market = {
  id: "US" | "TR" | "UK" | "DE";
  name: string;
  currency: "USD" | "TRY" | "GBP" | "EUR";
  rateToLocal: number;
  exchangeRateProvenance: Provenance;
  purchasingPower: PurchasingPowerInput;
  coffeePrice: Money;
  coffeeProvenance: Provenance;
  pricePoints: number[];
  pricePointsProvenance: Provenance;
};
type Strategy = {
  id: "accessible" | "balanced" | "premium";
  label: string;
  factor: number;
  provenance: Provenance; // normally user-configured product assumption
};
type PurchasingPowerMethod = {
  indexName: string;
  method: string;
  baseMarketId: Market["id"];
  units: string;
  normalization: "base-market-equals-1";
  direction: "higher-means-greater-purchasing-power";
  provenance: Provenance;
};
```

`purchasingPowerFactor` is derived from the configured method and market index values, not an independent unexplained coefficient. The base market's factor is `1`; each target's factor is its index value divided by the base-market index value, after any documented direction transformation. If comparable index data is unavailable, each market may instead provide an explicit `illustrative-factor` input; that value must have `illustrative` status, a note, and a visible UI label. Such factors are relative to the same named base, so its demo factor must be `1`. Do not mix index-derived and demo factors without clearly indicating the basis per market. Tests can use synthetic index values with a target above/below the base and assert that the factor and adjusted anchor respectively rise/fall. `sourced` values require a source and applicable date. Production data may also carry a methodology/data version.

## Function interfaces

```ts
type PriceResult = {
  marketId: Market["id"];
  strategyId: Strategy["id"];
  convertedAnchor: Money;
  localAnchor: Money;
  strategyAnchor: Money;
  preRoundPrice: Money;
  finalPrice: Money;
  coffeeEquivalent: number;
  purchasingPowerFactor: number;
  provenance: {
    exchangeRate: Provenance;
    purchasingPower: Provenance;
    strategy: Provenance;
    coffee: Provenance;
    pricePoints: Provenance;
  };
};

function validatePricingConfig(
  markets: Market[],
  strategies: Strategy[],
  purchasingPowerMethod: PurchasingPowerMethod
): string[];
function recommendPrice(
  basePrice: Money,
  market: Market,
  strategy: Strategy,
  purchasingPowerMethod: PurchasingPowerMethod
): PriceResult;
function compareStrategies(
  basePrice: Money,
  market: Market,
  strategies: Strategy[],
  purchasingPowerMethod: PurchasingPowerMethod
): PriceResult[];
```

`recommendPrice` validates positive finite amounts/rates/index values, matching currencies, a valid method/base market, and a non-empty strictly increasing price-point list. It derives the factor from index values (or uses explicitly illustrative configured demo factors when comparable index data is unavailable). Coffee data is used only to compute the displayed equivalent and provenance; it is not accepted as a price-calculation control. `compareStrategies` validates factor order and returns results in strategy order. The shared nearest-point rounding rule is monotonic, so ordered strategy anchors remain non-decreasing after rounding, including ties. Unit tests verify adjustment direction, identical-input determinism, visible/explicit handling of missing or illustrative index data, and that changing coffee amount or provenance leaves recommendations unchanged.

## Revenue simulation

For each market, eligible audience `N_m`, conversion assumption `c_m` in `[0,1]`, and selected local price `p_m`:

`expectedPurchases_m = N_m × c_m`

`grossRevenue_m = N_m × c_m × p_m`

If a fee rate `f_m` in `[0,1]` is supplied for that market:

`estimatedNet_m = grossRevenue_m × (1 - f_m)`

Keep currency explicit for each market result. If integer expected purchases are displayed, define whether they are fractional expected value or rounded count; revenue should use the unrounded expectation unless the UI says otherwise. Do not add tax or other deductions unless explicitly modeled as inputs. All results are hypothetical scenarios, never forecasts.

```ts
type MarketRevenueAssumptions = {
  audience: number;
  conversionRate: number;
  feeRate?: number;
  provenance: Provenance;
};
type RevenueInputs = {
  assumptionsByMarket: Partial<Record<Market["id"], MarketRevenueAssumptions>>;
  sharedAssumptions?: MarketRevenueAssumptions & {
    label: string;
    marketIds: Market["id"][];
  };
  pricesByMarket: Partial<Record<Market["id"], Money>>;
};
type RevenueResult = {
  marketId: Market["id"];
  expectedPurchases: number;
  grossRevenue: Money;
  estimatedNet?: Money;
  assumptions: MarketRevenueAssumptions;
  assumptionMode: "market-specific" | "shared-simplifying-assumption";
  hypothetical: true;
};
function simulateRevenue(inputs: RevenueInputs): RevenueResult[];
```

Audience and conversion assumptions can differ by market. To keep the MVP small, one shared set may be explicitly assigned to several markets; clearly label it as a simplifying scenario assumption and show which markets use it. A market-specific set takes precedence for its market. Do not silently apply shared values to unlisted markets or leave missing market assumptions implicit. Audience and conversion are user assumptions; the model omits market reach, demand response to price, taxes, refunds, platform-specific rules, ranking effects, and cross-market behavior. Strategy comparisons may hold each market's assumptions constant to isolate price changes. Results are hypothetical scenarios, not forecasts.

## Advisor and UI

The deterministic advisor builds an explanation from `PriceResult`, documented inputs, and provenance. Optional AI receives those results for wording only; it cannot call or replace the pricing engine. Neither may invent missing exchange rates, indices, coffee prices, conversion rates, competitor data, or market statistics. The dashboard presents markets, strategy comparisons, calculation steps, provenance labels, coffee context, and editable market-specific (or explicitly shared simplifying) simulation assumptions. Illustrative values remain visibly identified wherever they inform output. All pricing and simulation calculations remain pure, deterministic, and independently testable.
