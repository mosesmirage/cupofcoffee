"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import {
  INITIAL_MARKET_IDENTITIES,
  STRATEGY_DEFINITIONS,
  type CurrencyCode,
  type Market,
  type MarketId,
  type Strategy,
  type StrategyId,
} from "@/lib/pricing/config.ts";
import {
  DEMO_MARKET_CONFIGURATIONS,
  DEMO_PURCHASING_POWER_METHOD,
  DEMO_STRATEGIES,
  makeIllustrativeMarkets,
} from "@/lib/pricing/demo-data.ts";
import { compareStrategies, type PriceResult } from "@/lib/pricing/engine.ts";
import { explainProvenance, explainRecommendation } from "@/lib/pricing/explanation.ts";
import { simulateRevenue } from "@/lib/pricing/revenue.ts";
import { selectStrategyPrices } from "@/lib/pricing/strategy-selection.ts";
import { provenanceLabel } from "@/lib/pricing/config.ts";
import { DEFAULT_STRATEGY_FACTOR_TEXT, parseStrategyPreferences, STRATEGY_PREFERENCES_STORAGE_KEY } from "@/lib/pricing/strategy-preferences.ts";
import {
  clearCoffeeOverrideDraft,
  COFFEE_OVERRIDE_STORAGE_KEY,
  CANDIDATE_COFFEE_BENCHMARKS,
  coffeeComparisonForDisplay,
  coffeePricingContext,
  makeIllustrativeCoffeeBenchmark,
  parseCoffeeOverrideDrafts,
  resolveCoffeeBenchmark,
  updateCoffeeOverrideDraft,
  VERIFIED_COFFEE_BENCHMARKS,
  type CoffeeBenchmarkOverrideDraft,
  type CoffeeBenchmarkResolution,
} from "@/lib/pricing/coffee-benchmark.ts";
import {
  fetchFrankfurterRates,
  makeFallbackExchangeRates,
  type ExchangeRateSnapshot,
  type MarketExchangeRate,
} from "@/lib/exchange-rates/frankfurter.ts";
import { formatFetchTime } from "@/lib/exchange-rates/format.ts";
import CompetitorPriceResearch, { SelectedAppStorefronts } from "@/components/competitor-price-research.tsx";
import type { AppleApp, ApplePriceComparison } from "@/lib/apple-app-store/client.ts";
import { getAppReferencePrice } from "@/lib/apple-app-store/workflow.ts";
import { manualEntryReducer } from "@/lib/pricing/manual-entry.ts";

const flags: Record<MarketId, string> = { US: "🇺🇸", TR: "🇹🇷", UK: "🇬🇧", DE: "🇩🇪" };
const marketNames = Object.fromEntries(INITIAL_MARKET_IDENTITIES.map(({ id, name }) => [id, name])) as Record<MarketId, string>;
const marketConfigs = DEMO_MARKET_CONFIGURATIONS;
const strategyCopy: Record<StrategyId, string> = {
  accessible: "Lower entry price",
  balanced: "Middle-ground pricing",
  premium: "Higher-value positioning",
};

type EditableRevenueInputs = Record<MarketId, { audience: string; conversionPercent: string; feePercent: string }>;
type PricingState = {
  results: Partial<Record<MarketId, PriceResult[]>>;
  markets: Partial<Record<MarketId, Market>>;
  errors: Partial<Record<MarketId, string>>;
};

function makeDemoFallbackRates(baseCurrency: CurrencyCode): Record<MarketId, number> {
  return Object.fromEntries(
    DEMO_MARKET_CONFIGURATIONS.map(({ id, rateToLocalByBaseCurrency }) => [id, rateToLocalByBaseCurrency[baseCurrency]]),
  ) as Record<MarketId, number>;
}

function exchangeRateLabel(rate: MarketExchangeRate, manuallyEdited: boolean): string {
  if (manuallyEdited) return "Manual override";
  if (rate.kind === "live") return "Live rate";
  if (rate.kind === "identity") return "Identity rate";
  return "Illustrative fallback";
}

function exchangeRateDescription(rate: MarketExchangeRate, manuallyEdited: boolean): string {
  if (manuallyEdited) return "User-configured override; not a live rate.";
  if (rate.kind === "live") {
    return `${rate.provenance.source} · observed ${rate.observedAt} · fetched ${formatFetchTime(rate.fetchedAt)}`;
  }
  if (rate.kind === "identity") return rate.provenance.note;
  return `${rate.provenance.note} Fallback rates are illustrative demo data.`;
}

function formatMoney(amount: number, currency: CurrencyCode): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatNumber(value: number, maximumFractionDigits = 3): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

function storefrontPriceFor(comparison: ApplePriceComparison | null, marketId: MarketId, currency: CurrencyCode) {
  const storefront = comparison?.storefronts.find(({ storefrontId }) => storefrontId === marketId);
  const price = storefront?.status === "available" ? storefront.app?.price : undefined;
  return price?.currency === currency && Number.isFinite(price.amount) && price.amount >= 0 ? price : undefined;
}

function recommendationDifference(recommended: number, current: number, currency: CurrencyCode): string {
  const difference = recommended - current;
  if (difference === 0) return "Same as current";
  return (difference > 0 ? "+" : "") + formatMoney(difference, currency) + " vs current";
}

function coffeeStatusLabel(resolution: CoffeeBenchmarkResolution): string {
  if (resolution.status === "verified") return "Verified reference";
  if (resolution.status === "candidate-unverified") return "Coffee price available · Verification pending";
  if (resolution.status === "user-entered") return "User-entered";
  if (resolution.status === "illustrative") return "Coffee benchmark not configured · illustrative sample";
  return "Needs review";
}

function coffeeFreshnessLabel(resolution: CoffeeBenchmarkResolution): string {
  if (resolution.freshness === "current") return "within 90 days";
  if (resolution.freshness === "stale") return "stale · over 90 days";
  if (resolution.freshness === "invalid-date") return "invalid observation date";
  return "undated";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Check the configured values and try again.";
}

function pricingErrorMessage(message: string, market: Market | undefined, baseCurrency: CurrencyCode): string {
  if (message.includes("base app price")) return "Enter a base app price greater than zero to calculate recommendations.";
  if (message.includes("Exchange rate")) return `Enter a positive exchange rate in ${market?.currency ?? "local currency"} per 1 ${baseCurrency}.`;
  if (message.includes("Purchasing-power factor")) return "Enter a positive illustrative factor. The United States baseline is fixed at 1.";
  if (message.includes("illustrative purchasing-power factors only")) return "This MVP uses illustrative purchasing-power factors only; index-derived values need additional base-index inputs.";
  if (message.includes("Price points must be a non-empty")) return "Add one or more positive local price points, separated by commas.";
  if (message.includes("Price points must be strictly increasing")) return "Enter positive price points in strictly increasing order, without duplicates.";
  if (message.includes("Strategy factors must be non-decreasing")) return "Set positive strategy factors in order: Accessible ≤ Balanced ≤ Premium.";
  if (message.includes("strategy factor must be positive")) return "Enter a positive factor for each strategy.";
  return message;
}

function revenueErrorMessage(message: string): string {
  if (message.includes("audience must")) return "Enter a finite audience size of 0 or more for each market.";
  if (message.includes("conversion rate")) return "Enter a conversion rate from 0% to 100% for each market.";
  if (message.includes("fee rate")) return "Enter a platform fee from 0% to 100%, or clear the field to omit the fee calculation.";
  if (message.includes("no applicable revenue assumptions")) return "Add audience and conversion assumptions for each market with a price.";
  if (message.includes("local price")) return "Correct the market recommendation before calculating a revenue scenario.";
  return message;
}

function makeStrategies(factors: Record<StrategyId, string>): Strategy[] {
  return DEMO_STRATEGIES.map((strategy) => ({ ...strategy, factor: Number(factors[strategy.id]) }));
}

function makePricingState(
  basePriceText: string,
  baseCurrency: CurrencyCode,
  rates: Partial<Record<MarketId, Partial<Record<CurrencyCode, string>>>>,
  purchasingPowers: Partial<Record<MarketId, string>>,
  purchasingPowerProvenance: Partial<Record<MarketId, import("@/lib/pricing/config.ts").Provenance>>,
  coffeeBenchmarks: Partial<Record<MarketId, CoffeeBenchmarkResolution>>,
  pricePoints: Partial<Record<MarketId, string>>,
  strategyFactors: Record<StrategyId, string>,
  exchangeRateSnapshot: ExchangeRateSnapshot,
  coffeeNow: number,
): PricingState {
  const results: PricingState["results"] = {};
  const configuredMarkets: PricingState["markets"] = {};
  const errors: PricingState["errors"] = {};
  const amount = Number(basePriceText);
  const rateOverrides: Partial<Record<MarketId, Partial<Record<CurrencyCode, number>>>> = {};
  const purchasingPowerOverrides: Partial<Record<MarketId, number>> = {};
  const pricePointOverrides: Partial<Record<MarketId, number[]>> = {};
  for (const market of INITIAL_MARKET_IDENTITIES) {
    const marketRates = rates[market.id];
    const userRate = marketRates?.[baseCurrency];
    rateOverrides[market.id] = {
      [baseCurrency]: userRate === undefined
        ? exchangeRateSnapshot.rates[market.id].rateToLocal
        : Number(userRate),
    };
    if (purchasingPowers[market.id] !== undefined) purchasingPowerOverrides[market.id] = Number(purchasingPowers[market.id]);
    if (pricePoints[market.id] !== undefined) {
      const value = pricePoints[market.id] ?? "";
      pricePointOverrides[market.id] = value.trim() === "" ? [] : value.split(",").map((part) => Number(part.trim()));
    }
  }

  const markets = makeIllustrativeMarkets(rateOverrides, purchasingPowerOverrides, {}, pricePointOverrides, baseCurrency);
  for (const market of markets) {
    const userRate = rates[market.id]?.[baseCurrency];
    market.exchangeRateProvenance = userRate === undefined
      ? exchangeRateSnapshot.rates[market.id].provenance
      : { status: "user-configured", note: "Exchange rate manually overridden by the user; not a live rate." };
    if (purchasingPowers[market.id] !== undefined) {
      market.purchasingPower.mode = "relative-factor";
      market.purchasingPower.provenance = { status: "user-configured", note: "Purchasing-power factor manually overridden by the user." };
    } else if (purchasingPowerProvenance[market.id]) {
      market.purchasingPower.mode = "relative-factor";
      market.purchasingPower.provenance = purchasingPowerProvenance[market.id]!;
    }
    const resolution = coffeeBenchmarks[market.id];
    const benchmark = resolution?.benchmark;
    market.coffeePrice = undefined;
    market.coffeeProvenance = undefined;
    Object.assign(market, coffeePricingContext(benchmark, coffeeNow));
    configuredMarkets[market.id] = market;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    const message = "Enter a base app price greater than zero.";
    for (const market of INITIAL_MARKET_IDENTITIES) errors[market.id] = message;
    return { results, markets: configuredMarkets, errors };
  }

  const strategies = makeStrategies(strategyFactors);
  const basePrice = { amount, currency: baseCurrency };
  for (const market of markets) {
    try {
      results[market.id] = compareStrategies(basePrice, market, strategies, DEMO_PURCHASING_POWER_METHOD);
    } catch (error) {
      errors[market.id] = errorMessage(error);
    }
  }
  return { results, markets: configuredMarkets, errors };
}

export default function PricingDashboard() {
  const [entry, dispatchEntry] = useReducer(manualEntryReducer, { journey: "discover", amount: "4.99", currency: "USD" });
  const { journey, amount: basePrice, currency: baseCurrency } = entry;
  const manualPriceInput = useRef<HTMLInputElement>(null);
  const [selectedApp, setSelectedApp] = useState<AppleApp | null>(null);
  const [appComparison, setAppComparison] = useState<ApplePriceComparison | null>(null);
  const [appLookupMessage, setAppLookupMessage] = useState("");
  const [referencePriceSource, setReferencePriceSource] = useState("Manual reference price");
  const [rates, setRates] = useState<Partial<Record<MarketId, Partial<Record<CurrencyCode, string>>>>>(() => ({}));
  const [purchasingPowers, setPurchasingPowers] = useState<Partial<Record<MarketId, string>>>({});
  const [purchasingPowerProvenance, setPurchasingPowerProvenance] = useState<Partial<Record<MarketId, import("@/lib/pricing/config.ts").Provenance>>>({});
  const [coffeeOverrides, setCoffeeOverrides] = useState<Partial<Record<MarketId, CoffeeBenchmarkOverrideDraft>>>({});
  const [coffeeOverridesLoaded, setCoffeeOverridesLoaded] = useState(false);
  const [coffeeNow, setCoffeeNow] = useState(0);
  const [pricePoints, setPricePoints] = useState<Partial<Record<MarketId, string>>>({});
  const [strategyFactors, setStrategyFactors] = useState<Record<StrategyId, string>>(DEFAULT_STRATEGY_FACTOR_TEXT);
  const [strategyFactorsLoaded, setStrategyFactorsLoaded] = useState(false);
  const [revenueStrategy, setRevenueStrategy] = useState<StrategyId>("balanced");
  const [exchangeRateSnapshot, setExchangeRateSnapshot] = useState<ExchangeRateSnapshot | null>(null);
  const [rateRequest, setRateRequest] = useState<{
    baseCurrency: CurrencyCode;
    status: "loading" | "ready" | "error";
    error?: string;
  }>({ baseCurrency: "USD", status: "loading" });
  const [revenueInputs, setRevenueInputs] = useState<EditableRevenueInputs>({
    US: { audience: "1200", conversionPercent: "2.5", feePercent: "15" },
    TR: { audience: "900", conversionPercent: "2", feePercent: "15" },
    UK: { audience: "700", conversionPercent: "2.5", feePercent: "15" },
    DE: { audience: "800", conversionPercent: "2", feePercent: "15" },
  });

  useEffect(() => {
    window.queueMicrotask(() => setCoffeeNow(Date.now()));
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/pricing/purchasing-power")
      .then(async (response) => {
        if (!response.ok) throw new Error("Purchasing-power data is unavailable.");
        return response.json();
      })
      .then((snapshot) => {
        if (!active) return;
        setPurchasingPowers((current) => Object.fromEntries(INITIAL_MARKET_IDENTITIES.map(({ id }) => [id, current[id] ?? String(snapshot.factors[id])])) as Partial<Record<MarketId, string>>);
        setPurchasingPowerProvenance(snapshot.provenance);
      })
      .catch(() => { /* Retain the existing clearly illustrative factors when comparable annual data is unavailable. */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let savedFactors: Record<StrategyId, string> | undefined;
    try {
      savedFactors = parseStrategyPreferences(window.localStorage.getItem(STRATEGY_PREFERENCES_STORAGE_KEY));
    } catch { /* Use defaults when browser storage is unavailable. */ }
    window.queueMicrotask(() => {
      if (savedFactors) setStrategyFactors(savedFactors);
      setStrategyFactorsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!strategyFactorsLoaded) return;
    try {
      window.localStorage.setItem(STRATEGY_PREFERENCES_STORAGE_KEY, JSON.stringify(strategyFactors));
    } catch { /* Strategy factors remain editable for this session. */ }
  }, [strategyFactors, strategyFactorsLoaded]);

  useEffect(() => {
    if (journey === "manual") manualPriceInput.current?.focus();
  }, [journey]);

  useEffect(() => {
    let savedOverrides: Partial<Record<MarketId, CoffeeBenchmarkOverrideDraft>> = {};
    try {
      savedOverrides = parseCoffeeOverrideDrafts(window.localStorage.getItem(COFFEE_OVERRIDE_STORAGE_KEY));
    } catch { /* Browser storage can be disabled; use the in-memory editor. */ }
    window.queueMicrotask(() => {
      setCoffeeOverrides(savedOverrides);
      setCoffeeOverridesLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!coffeeOverridesLoaded) return;
    try {
      window.localStorage.setItem(COFFEE_OVERRIDE_STORAGE_KEY, JSON.stringify(coffeeOverrides));
    } catch {
      // The benchmark editor still works for this session if browser storage is unavailable.
    }
  }, [coffeeOverrides, coffeeOverridesLoaded]);

  const demoFallbackRates = makeDemoFallbackRates(baseCurrency);
  const activeRateSnapshot = exchangeRateSnapshot?.baseCurrency === baseCurrency
    ? exchangeRateSnapshot
    : makeFallbackExchangeRates(baseCurrency, demoFallbackRates, "Live rates are loading or unavailable.");
  const ratesLoading = rateRequest.baseCurrency !== baseCurrency || rateRequest.status === "loading";
  const rateFetchError = rateRequest.baseCurrency === baseCurrency && rateRequest.status === "error"
    ? rateRequest.error ?? "Unable to fetch Frankfurter rates."
    : "";

  useEffect(() => {
    const controller = new AbortController();

    void fetchFrankfurterRates(baseCurrency, makeDemoFallbackRates(baseCurrency), { signal: controller.signal })
      .then((snapshot) => {
        if (controller.signal.aborted) return;
        setExchangeRateSnapshot(snapshot);
        setRateRequest({ baseCurrency, status: "ready" });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = errorMessage(error);
        setExchangeRateSnapshot(makeFallbackExchangeRates(
          baseCurrency,
          makeDemoFallbackRates(baseCurrency),
          `Frankfurter could not be reached (${message}).`,
        ));
        setRateRequest({ baseCurrency, status: "error", error: message });
      });

    return () => controller.abort();
  }, [baseCurrency]);

  const coffeeResolutions = Object.fromEntries(INITIAL_MARKET_IDENTITIES.map((identity) => {
    const demo = marketConfigs.find(({ id }) => id === identity.id)!;
    const fallback = makeIllustrativeCoffeeBenchmark(identity.id, demo.coffeePrice, identity.currency);
    const referenceBenchmarks = [...VERIFIED_COFFEE_BENCHMARKS, ...CANDIDATE_COFFEE_BENCHMARKS];
    return [identity.id, resolveCoffeeBenchmark(identity.id, fallback, coffeeOverrides[identity.id], referenceBenchmarks, coffeeNow)];
  })) as Record<MarketId, CoffeeBenchmarkResolution>;
  const pricing = makePricingState(basePrice, baseCurrency, rates, purchasingPowers, purchasingPowerProvenance, coffeeResolutions, pricePoints, strategyFactors, activeRateSnapshot, coffeeNow);
  const selectedStrategyPrices = selectStrategyPrices(pricing.results, revenueStrategy);
  const revenue = (() => {
    const pricesByMarket: Partial<Record<MarketId, { amount: number; currency: CurrencyCode }>> = {};
    const assumptionsByMarket: Partial<Record<MarketId, { audience: number; conversionRate: number; feeRate?: number; provenance: { status: "user-configured"; note: string } }>> = {};
    for (const market of INITIAL_MARKET_IDENTITIES) {
      const selectedPrice = selectedStrategyPrices[market.id];
      if (!selectedPrice) return { results: [], error: pricing.errors[market.id] ?? `${marketNames[market.id]} has no valid ${revenueStrategy} strategy price.` };
      pricesByMarket[market.id] = selectedPrice;
      const assumption = revenueInputs[market.id];
      const fee = assumption.feePercent.trim() === "" ? undefined : Number(assumption.feePercent) / 100;
      assumptionsByMarket[market.id] = {
        audience: Number(assumption.audience),
        conversionRate: Number(assumption.conversionPercent) / 100,
        ...(fee === undefined ? {} : { feeRate: fee }),
        provenance: { status: "user-configured", note: `Editable hypothetical scenario input for ${marketNames[market.id]}.` },
      };
    }
    try {
      return { results: simulateRevenue({ pricesByMarket, assumptionsByMarket }), error: "" };
    } catch (error) {
      return { results: [], error: errorMessage(error) };
    }
  })();

  function updateRevenue(marketId: MarketId, key: keyof EditableRevenueInputs[MarketId], value: string) {
    setRevenueInputs((current) => ({
      ...current,
      [marketId]: { ...current[marketId], [key]: value },
    }));
  }

  const revenueStrategyLabel = STRATEGY_DEFINITIONS.find(({ id }) => id === revenueStrategy)?.label ?? "Selected";
  const strategyIsOrdered = Number(strategyFactors.accessible) <= Number(strategyFactors.balanced)
    && Number(strategyFactors.balanced) <= Number(strategyFactors.premium)
    && [strategyFactors.accessible, strategyFactors.balanced, strategyFactors.premium].every((factor) => Number.isFinite(Number(factor)) && Number(factor) > 0);

  function handleAppSelected(app: AppleApp, comparison: ApplePriceComparison | null, error: string) {
    const reference = getAppReferencePrice(app, comparison);
    setSelectedApp(app);
    setAppComparison(comparison);
    setAppLookupMessage(error || (reference.amount === null ? reference.message : ""));
    dispatchEntry({ type: "select-app", currency: reference.currency, amount: reference.amount === null ? "" : String(reference.amount) });
    setReferencePriceSource(reference.sourceLabel);
  }

  function chooseAnotherApp() {
    setSelectedApp(null);
    setAppComparison(null);
    setAppLookupMessage("");
    dispatchEntry({ type: "return-to-search" });
  }

  return (
    <div className={`dashboard-shell${journey === "discover" ? " discovery-shell" : ""}`}>
      {journey !== "discover" && <aside className="dashboard-sidebar">
        <a className="dashboard-brand" href="#top" aria-label="CupOfCoffee dashboard home">
          <span className="dashboard-brand-mark" aria-hidden="true">☕</span>
          <span>cup<span>of</span>coffee</span>
        </a>
        <div className="dashboard-nav-label">WORKSPACE</div>
        <nav className="dashboard-nav" aria-label="Dashboard sections">
          <a className="selected" href="#top">Overview</a>
          <a href="#markets">Markets <span>04</span></a>
          <a href="#strategies">Strategies</a>
          <a href="#revenue">Scenarios</a>
        </nav>
        <div className="dashboard-sidebar-note">
          <span className="live-dot" />
          <strong>Local context, clearly shown.</strong>
          <p>All market examples here are illustrative and editable.</p>
          <small>CUP OF COFFEE · MVP</small>
        </div>
      </aside>}

      <main className="dashboard-main" id="top">
        {journey !== "discover" && <header className="dashboard-topbar">
          <div className="dashboard-breadcrumb">Workspace <span>/</span> <strong>Pricing overview</strong></div>
          <span className="demo-status"><span className="live-dot" /> DEMO ASSUMPTIONS</span>
        </header>}

        <div className={`dashboard-content${journey === "discover" ? " discovery-content" : ""}`}>
          {journey === "discover" ? <><a className="discovery-brand" href="#top" aria-label="Cup of Coffee home"><span aria-hidden="true">☕</span><span className="discovery-brand-wordmark">Cup of Coffee</span></a><CompetitorPriceResearch onAppSelected={handleAppSelected} onEnterManual={() => { setReferencePriceSource("Manual reference price"); dispatchEntry({ type: "open-manual" }); }} /></> : <>
          {journey === "app" && selectedApp && <>
            <SelectedAppStorefronts app={selectedApp} comparison={appComparison} lookupError={appLookupMessage} onChooseAnother={chooseAnotherApp} />
          </>}
          {journey === "manual" && <section className="reference-panel manual-reference-panel" aria-labelledby="manual-reference-title">
            <div className="manual-reference-heading">
              <div className="reference-heading"><span className="section-eyebrow">MANUAL ENTRY</span><h2 id="manual-reference-title">Manual reference price</h2><p>Enter your app’s current one-time purchase price and currency.</p></div>
              <button className="manual-return-button" type="button" onClick={() => dispatchEntry({ type: "return-to-search" })}>Find my app in the App Store</button>
            </div>
            <div className="reference-fields manual-reference-fields">
              <label className="field-label">Price amount
                <span className="currency-input-wrap"><input ref={manualPriceInput} aria-label="Manual reference price amount" type="number" min="0.01" step="0.01" value={basePrice} onChange={(event) => { dispatchEntry({ type: "set-amount", amount: event.target.value }); setReferencePriceSource("Manual reference price"); }} aria-invalid={!Number.isFinite(Number(basePrice)) || Number(basePrice) <= 0} /></span>
              </label>
              <label className="field-label">Currency
                <select aria-label="Manual reference price currency" value={baseCurrency} onChange={(event) => { dispatchEntry({ type: "set-currency", currency: event.target.value as CurrencyCode }); setReferencePriceSource("Manual reference price"); }}>
                  <option value="USD">USD · US Dollar</option><option value="TRY">TRY · Turkish Lira</option><option value="GBP">GBP · Pound Sterling</option><option value="EUR">EUR · Euro</option>
                </select>
              </label>
            </div>
            <p className="reference-assurance">Your price is used as the starting reference for the four market recommendations.</p>
            {(!Number.isFinite(Number(basePrice)) || Number(basePrice) <= 0) && <p className="field-error" role="alert">Enter a base app price greater than zero to calculate recommendations.</p>}
          </section>}
          <section className="localized-recommendations" id="markets" aria-labelledby="recommendations-title">
            <div className="recommendations-heading">
              <div>
                <span className="section-eyebrow">PRICING INTELLIGENCE · FOUR MARKETS</span>
                <h1 id="recommendations-title">Localized pricing recommendations</h1>
                <p>Compare your current price with three pricing strategies across markets.</p>
              </div>
              <span className="illustrative-badge">DECISION SUPPORT</span>
            </div>
            <div className="recommendation-market-grid">
              {INITIAL_MARKET_IDENTITIES.map((identity) => {
                const market = pricing.markets[identity.id];
                const results = pricing.results[identity.id] ?? [];
                const marketError = pricing.errors[identity.id];
                const currentPrice = storefrontPriceFor(appComparison, identity.id, identity.currency);
                const storeResult = appComparison?.storefronts.find(({ storefrontId }) => storefrontId === identity.id);
                const currentPriceLabel = currentPrice
                  ? currentPrice.isFree ? "Free" : currentPrice.formattedPrice
                  : "Price unavailable";
                const currentCoffeeComparison = currentPrice && !currentPrice.isFree
                  ? coffeeComparisonForDisplay(
                    { amount: currentPrice.amount, currency: identity.currency },
                    coffeeResolutions[identity.id],
                    coffeeNow,
                  )
                  : undefined;
                return (
                  <article className="recommendation-market-card" key={identity.id}>
                    <header className="recommendation-market-heading">
                      <span className="market-flag" aria-hidden="true">{flags[identity.id]}</span>
                      <div><h2>{identity.name}</h2><span>{identity.currency}</span></div>
                    </header>
                    <div className={"current-market-price" + (currentPrice?.isFree ? " current-free" : "")}>
                      <span>Current App Store price</span>
                      <strong>{currentPriceLabel}</strong>
                      {currentCoffeeComparison?.status === "available" && <small className="current-coffee-equivalent">☕ About {formatNumber(currentCoffeeComparison.cups, 1)} cups · {formatMoney(currentCoffeeComparison.price.amount, currentCoffeeComparison.price.currency)} coffee</small>}
                      {!currentPrice && <small>{appComparison ? storeResult?.message ?? "No matching storefront price." : "No storefront listing selected."}</small>}
                    </div>
                    {marketError ? (
                      <div className="market-error" role="alert" aria-live="polite">
                        <strong>{Number(basePrice) > 0 ? "Recommendations unavailable" : "Reference price needed"}</strong>
                        <span>{pricingErrorMessage(marketError, market, baseCurrency)}</span>
                      </div>
                    ) : (
                      <div className="recommendation-strategy-list">
                        {STRATEGY_DEFINITIONS.map((strategy, index) => {
                          const result = results[index];
                          if (!result) return null;
                          const strategyConfig = { ...DEMO_STRATEGIES[index], factor: Number(strategyFactors[strategy.id]) };
                          const coffeeComparison = coffeeComparisonForDisplay(result.finalPrice, coffeeResolutions[identity.id], coffeeNow);
                          return (
                            <div className={"recommendation-strategy recommendation-" + strategy.id} key={strategy.id}>
                              <div className="recommendation-strategy-label">
                                <strong>{strategy.label}</strong>
                                <span>{strategyCopy[strategy.id]}</span>
                              </div>
                              <b className="recommendation-price">{formatMoney(result.finalPrice.amount, identity.currency)}</b>
                              {coffeeComparison.status === "available" && <div className="recommendation-coffee-comparison" aria-label={`About ${formatNumber(coffeeComparison.cups, 1)} cups of coffee`}><span>☕ About {formatNumber(coffeeComparison.cups, 1)} cups of coffee</span></div>}
                              {currentPrice && <span className="recommendation-difference">{recommendationDifference(result.finalPrice.amount, currentPrice.amount, identity.currency)}</span>}
                              <details className="recommendation-calculation">
                                <summary>How was this calculated?</summary>
                                <ol className="explanation-steps">
                                  {explainRecommendation({ amount: Number(basePrice), currency: baseCurrency }, market!, strategyConfig, result).map((line, lineIndex) => <li key={lineIndex}>{line}</li>)}
                                </ol>
                                <div className="provenance-details">
                                  <p><strong>Exchange rate</strong><span>{explainProvenance(result.provenance.exchangeRate)}</span></p>
                                  <p><strong>Purchasing power</strong><span>{result.provenance.purchasingPower.status === "sourced" ? "Applied" : explainProvenance(result.provenance.purchasingPower)}</span></p>
                                  <p><strong>Strategy</strong><span>{explainProvenance(result.provenance.strategy)}</span></p>
                                  <p><strong>Local price points</strong><span>{explainProvenance(result.provenance.pricePoints)}</span></p>
                                </div>
                              </details>
                            </div>
                          );
                        })}
                        {new Set(results.map(({ finalPrice }) => finalPrice.amount)).size < results.length && <p className="rounding-note">Some strategy prices meet at the same local price point after rounding.</p>}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            <p className="recommendation-note">Suggestions use the visible assumptions and do not estimate willingness to pay or an optimal price.</p>
          </section>

          <details className="advanced-settings">
            <summary>Advanced pricing settings <span>Reference price, currencies, factors, and local price points</span></summary>
            <div className="advanced-settings-content">
              {journey === "app" && <section className="reference-panel" aria-labelledby="reference-title">
                <div className="reference-row">
                  <div className="reference-heading"><h2 id="reference-title">Reference price</h2><p>{journey === "app" ? "Selected app · paid one-time purchase" : "Paid app · one-time purchase"}</p></div>
                  <div className="reference-fields">
                    <label className="field-label">Base price
                      <span className="currency-input-wrap"><input aria-label="Base one-time app purchase price" type="number" min="0.01" step="0.01" value={basePrice} onChange={(event) => { dispatchEntry({ type: "set-amount", amount: event.target.value }); setReferencePriceSource("Manual reference price"); }} aria-invalid={!Number.isFinite(Number(basePrice)) || Number(basePrice) <= 0} /><span>{baseCurrency}</span></span>
                    </label>
                    <label className="field-label">Base currency
                      <select value={baseCurrency} onChange={(event) => { dispatchEntry({ type: "set-currency", currency: event.target.value as CurrencyCode }); setReferencePriceSource("Manual reference price"); }}>
                        <option value="USD">USD · US Dollar</option><option value="TRY">TRY · Turkish Lira</option><option value="GBP">GBP · Pound Sterling</option><option value="EUR">EUR · Euro</option>
                      </select>
                    </label>
                  </div>
                </div>
                <p className="reference-assurance">Source: {referencePriceSource}{appComparison?.lastSuccessfulRetrievalAt ? " · checked " + formatFetchTime(appComparison.lastSuccessfulRetrievalAt) : ""}.</p>
                {(!Number.isFinite(Number(basePrice)) || Number(basePrice) <= 0) && <p className="field-error" role="alert">Enter a base app price greater than zero to calculate recommendations.</p>}
              </section>}

              <section className="assumption-section" id="strategies" aria-labelledby="strategy-title">
                <div className="section-title-row"><div><span className="section-eyebrow">STRATEGY ASSUMPTIONS</span><h2 id="strategy-title">Strategy factors</h2></div><span className="soft-badge">Editable product assumptions</span></div>
                <p className="section-lede">These factors shape decision-support scenarios; they are not empirical estimates.</p>
                <div className="strategy-factor-grid">
                  {STRATEGY_DEFINITIONS.map((strategy, index) => (
                    <label className={"factor-card factor-" + strategy.id} key={strategy.id}>
                      <span className="factor-card-index">0{index + 1}</span>
                      <strong>{strategy.label}</strong>
                      <span className="factor-description">{strategyCopy[strategy.id]}</span>
                      <span className="factor-input-row"><span>Strategy factor</span><input aria-label={strategy.label + " strategy factor"} type="number" min="0.01" step="0.01" value={strategyFactors[strategy.id]} onChange={(event) => setStrategyFactors((current) => ({ ...current, [strategy.id]: event.target.value }))} aria-invalid={!strategyIsOrdered} /></span>
                      <span className="small-data-label">User-configured · assumption</span>
                    </label>
                  ))}
                </div>
                {!strategyIsOrdered && <p className="inline-error" role="alert">Set positive factors in order: Accessible ≤ Balanced ≤ Premium. Prices are paused until corrected.</p>}
              </section>

              <section className="advanced-market-settings" aria-labelledby="market-settings-title">
                <div className="section-title-row"><div><span className="section-eyebrow">MARKET INPUTS</span><h2 id="market-settings-title">Exchange rates and local price points</h2></div><span className="illustrative-badge">ASSUMPTIONS VISIBLE</span></div>
                <div className={"exchange-fetch-status" + (rateFetchError ? " has-error" : "")} role={rateFetchError ? "alert" : "status"} aria-live="polite">
                  {ratesLoading
                    ? "Loading Frankfurter daily reference rates. Illustrative fallback rates remain in use until quotes arrive."
                    : rateFetchError
                      ? "Frankfurter rates unavailable. Affected markets use illustrative demo rates."
                      : "Frankfurter daily reference rates are loaded where available. Fallback quotes remain illustrative."}
                </div>
                <div className="advanced-market-grid">
                  {INITIAL_MARKET_IDENTITIES.map((identity) => {
                    const demoMarket = marketConfigs.find(({ id }) => id === identity.id)!;
                    const market = pricing.markets[identity.id];
                    const marketError = pricing.errors[identity.id];
                    const rateInfo = activeRateSnapshot.rates[identity.id];
                    const rateWasManuallyEdited = rates[identity.id]?.[baseCurrency] !== undefined;
                    return (
                      <article className="advanced-market-card" key={identity.id}>
                        <header><strong><span aria-hidden="true">{flags[identity.id]}</span> {identity.name}</strong><span className={"market-data-status rate-" + (rateWasManuallyEdited ? "manual" : rateInfo.kind)}>{exchangeRateLabel(rateInfo, rateWasManuallyEdited)}</span></header>
                        <p className="exchange-rate-status">{exchangeRateDescription(rateInfo, rateWasManuallyEdited)}</p>
                        <div className="advanced-input-grid">
                          <label>Exchange rate <small>{identity.currency} per 1 {baseCurrency}</small><input type="number" min="0.000001" step="any" value={rates[identity.id]?.[baseCurrency] ?? rateInfo.rateToLocal} disabled={identity.currency === baseCurrency} aria-invalid={Boolean(marketError?.includes("Exchange rate"))} onChange={(event) => setRates((current) => ({ ...current, [identity.id]: { ...current[identity.id], [baseCurrency]: event.target.value } }))} /></label>
                          <label>Purchasing-power factor <small>US baseline = 1</small><input type="number" min="0.000001" step="0.01" value={purchasingPowers[identity.id] ?? demoMarket.purchasingPowerFactor} disabled={identity.id === "US"} aria-invalid={Boolean(marketError?.toLowerCase().includes("purchasing-power"))} onChange={(event) => setPurchasingPowers((current) => ({ ...current, [identity.id]: event.target.value }))} /></label>
                          <label className="price-points-field">Supported local price points <small>{provenanceLabel(market!.pricePointsProvenance)} · comma-separated</small><input type="text" value={pricePoints[identity.id] ?? demoMarket.pricePoints.join(", ")} aria-invalid={Boolean(marketError?.includes("Price points"))} onChange={(event) => setPricePoints((current) => ({ ...current, [identity.id]: event.target.value }))} /></label>
                        </div>
                      </article>
                    );
                  })}
                </div>
                <details className="methodology-disclosure"><summary>Calculation methodology and data status</summary><p>Each suggestion shows currency conversion, purchasing-power adjustment, the selected strategy factor, and nearest local price-point rounding as separate steps. Market and strategy assumptions are labeled in their inputs; exchange-rate sources are shown with each rate.</p></details>
              </section>
            </div>
          </details>

          <details className="coffee-context-section">
            <summary>Coffee price context <span>Optional local benchmark comparison</span></summary>
            <p className="coffee-context-intro">Coffee is a local spending reference only and does not change app prices.</p>
            <div className="coffee-context-market-grid">
              {INITIAL_MARKET_IDENTITIES.map((identity) => {
                const coffeeResolution = coffeeResolutions[identity.id];
                const coffeeBenchmark = coffeeResolution.benchmark;
                const coffeeDraft = coffeeOverrides[identity.id];
                const results = pricing.results[identity.id] ?? [];
                return (
                  <article className="coffee-context-market-card" key={identity.id}>
                    <div className="coffee-context-card-heading"><strong><span aria-hidden="true">{flags[identity.id]}</span> {identity.name}</strong><span>{identity.currency}</span></div>
                    <div className="coffee-context-value"><div><span>{coffeeBenchmark?.coffeeType ?? "Coffee benchmark needs review"}</span><small>{coffeeBenchmark?.city ? coffeeBenchmark.city + " · " : ""}{coffeeBenchmark?.productSize ? coffeeBenchmark.productSize + " · " : ""}{coffeeStatusLabel(coffeeResolution)} · {coffeeFreshnessLabel(coffeeResolution)}</small></div><b>{coffeeBenchmark ? formatMoney(coffeeBenchmark.price.amount, identity.currency) : "Price unavailable"}</b></div>
                    <div className="coffee-benchmark-meta">
                      {coffeeBenchmark?.sourceUrl
                        ? <a href={coffeeBenchmark.sourceUrl} target="_blank" rel="noreferrer">{coffeeBenchmark.sourceName ?? "Source"}</a>
                        : <span>{coffeeBenchmark?.sourceName ? "Note: " + coffeeBenchmark.sourceName : "No verified reference source configured"}</span>}
                      {coffeeBenchmark?.status === "candidate-unverified" && <span>Reported price type: {coffeeBenchmark.priceType === "reported-in-store" ? "in-store (source claim; unverified)" : coffeeBenchmark.priceType === "delivery" ? "delivery" : "unknown"}</span>}
                      {coffeeBenchmark?.additionalSources?.map((source) => <a href={source.url} key={source.url} target="_blank" rel="noreferrer">Additional source: {source.name}</a>)}
                      {coffeeBenchmark?.sourceReportedAt && <span>Source references {coffeeBenchmark.sourceReportedAt}; not an observation verification date.</span>}
                      {coffeeBenchmark?.status === "candidate-unverified" && coffeeBenchmark.notes.map((note) => <span className="coffee-candidate-limitation" key={note}>{note}</span>)}
                      {coffeeBenchmark?.observedAt && <span>Observed {coffeeBenchmark.observedAt}</span>}
                      {coffeeBenchmark?.verifiedAt && <span>Verified {coffeeBenchmark.verifiedAt}</span>}
                      {coffeeBenchmark?.retrievedAt && <span>Entered {formatFetchTime(coffeeBenchmark.retrievedAt)}</span>}
                    </div>
                    {results[1]?.coffeeEquivalent !== undefined
                      ? <strong className="coffee-ratio">Balanced app price ≈ {formatNumber(results[1].coffeeEquivalent, 1)} benchmarks</strong>
                      : <strong className="coffee-ratio-unavailable">{coffeeResolution.status === "candidate-unverified" ? "Candidate data is unverified and cannot produce a coffee ratio." : coffeeResolution.status === "needs-review" ? coffeeResolution.errors.join(" ") : coffeeResolution.freshness === "stale" ? "Benchmark is older than 90 days; ratio hidden." : coffeeResolution.freshness === "undated" ? "Add a recent observation date to calculate a ratio." : "No current, same-currency benchmark ratio available."}</strong>}
                    <details className="coffee-edit-details">
                      <summary>Edit my benchmark</summary>
                      <div className="coffee-edit-grid">
                        <label>My price <small>Currency fixed to {identity.currency}; stored in this browser</small><input type="number" min="0.000001" step="0.01" value={coffeeDraft?.amount ?? ""} placeholder={coffeeBenchmark?.status === "illustrative" ? String(coffeeBenchmark.price.amount) : "Enter your price"} aria-invalid={coffeeResolution.status === "needs-review"} onChange={(event) => setCoffeeOverrides((current) => updateCoffeeOverrideDraft(current, identity.id, "amount", event.target.value))} /></label>
                        <label>Coffee type <small>Required · not independently verified</small><input type="text" value={coffeeDraft?.coffeeType ?? ""} placeholder={coffeeBenchmark?.status === "illustrative" ? "Type not specified in demo" : "e.g. regular cappuccino"} aria-invalid={coffeeResolution.status === "needs-review" && coffeeResolution.errors.some((error) => error.includes("type"))} onChange={(event) => setCoffeeOverrides((current) => updateCoffeeOverrideDraft(current, identity.id, "coffeeType", event.target.value))} /></label>
                        <label>City or scope <small>Optional geographic context</small><input type="text" value={coffeeDraft?.city ?? ""} placeholder="Optional city" onChange={(event) => setCoffeeOverrides((current) => updateCoffeeOverrideDraft(current, identity.id, "city", event.target.value))} /></label>
                        <label>Source note <small>Optional note; not proof of verification</small><input type="text" value={coffeeDraft?.sourceNote ?? ""} placeholder="Where you observed it" onChange={(event) => setCoffeeOverrides((current) => updateCoffeeOverrideDraft(current, identity.id, "sourceNote", event.target.value))} /></label>
                        <label>Observation date <small>YYYY-MM-DD or YYYY-MM; ratios require a current date</small><input type="text" value={coffeeDraft?.observedAt ?? ""} placeholder="YYYY-MM-DD" aria-invalid={coffeeResolution.status === "needs-review" && coffeeResolution.errors.some((error) => error.includes("date"))} onChange={(event) => setCoffeeOverrides((current) => updateCoffeeOverrideDraft(current, identity.id, "observedAt", event.target.value))} /></label>
                        {coffeeDraft && <p className="coffee-override-help" role={coffeeResolution.status === "needs-review" ? "alert" : "status"}>{coffeeResolution.status === "needs-review" ? coffeeResolution.errors.join(" ") : "User-entered · not independently verified."}</p>}
                        <button className="coffee-reset-button" type="button" onClick={() => setCoffeeOverrides((current) => clearCoffeeOverrideDraft(current, identity.id))}>{[...VERIFIED_COFFEE_BENCHMARKS, ...CANDIDATE_COFFEE_BENCHMARKS].some((record) => record.marketId === identity.id) ? "Reset to reference observation" : "Use illustrative demo value"}</button>
                      </div>
                    </details>
                  </article>
                );
              })}
            </div>
          </details>

          <details className="revenue-scenarios-accordion">
            <summary>Revenue scenarios <span>Optional simulator</span></summary>
            <section className="revenue-section" id="revenue" aria-labelledby="revenue-title">
              <div className="section-title-row"><div><span className="section-eyebrow">SCENARIO EXPLORER</span><h2 id="revenue-title">Revenue assumptions</h2></div><label className="scenario-strategy-select">Price strategy<select value={revenueStrategy} onChange={(event) => setRevenueStrategy(event.target.value as StrategyId)}>{STRATEGY_DEFINITIONS.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.label}</option>)}</select></label></div>
              <p className="section-lede">Illustrative scenarios from editable assumptions; results are not predictions. Gross = audience × conversion rate × local app price. Net = gross × (1 − fee).</p>
              <div className="revenue-assumption-grid">
                {INITIAL_MARKET_IDENTITIES.map((market) => {
                  const values = revenueInputs[market.id];
                  return (
                    <fieldset className="revenue-market-inputs" key={market.id}>
                      <legend><span aria-hidden="true">{flags[market.id]}</span> {market.name} <small>{market.currency}</small></legend>
                      <div className="revenue-field-grid">
                        <label>Eligible audience<input type="number" min="0" step="1" value={values.audience} onChange={(event) => updateRevenue(market.id, "audience", event.target.value)} aria-invalid={!Number.isFinite(Number(values.audience)) || Number(values.audience) < 0} /></label>
                        <label>Conversion rate<input type="number" min="0" max="100" step="0.1" value={values.conversionPercent} onChange={(event) => updateRevenue(market.id, "conversionPercent", event.target.value)} aria-invalid={!Number.isFinite(Number(values.conversionPercent)) || Number(values.conversionPercent) < 0 || Number(values.conversionPercent) > 100} /><span>%</span></label>
                        <label>Platform fee<input type="number" min="0" max="100" step="0.1" value={values.feePercent} onChange={(event) => updateRevenue(market.id, "feePercent", event.target.value)} aria-invalid={values.feePercent !== "" && (!Number.isFinite(Number(values.feePercent)) || Number(values.feePercent) < 0 || Number(values.feePercent) > 100)} /><span>%</span></label>
                      </div>
                      <p>Assumptions apply to {market.name} only · editable scenario values</p>
                    </fieldset>
                  );
                })}
              </div>
              <div className="revenue-results" aria-live="polite">
                {revenue.error && <div className="revenue-error" role="alert" aria-live="polite"><strong>Revenue scenario unavailable</strong><span>{revenueErrorMessage(revenue.error)}</span></div>}
                <div className="revenue-results-header"><strong>Scenario output by market</strong><span>Each market is shown in its local currency; values are not compared across currencies.</span></div>
                <div className="revenue-result-grid">
                  {INITIAL_MARKET_IDENTITIES.map((identity) => {
                    const result = revenue.results.find(({ marketId }) => marketId === identity.id);
                    const selectedPrice = selectedStrategyPrices[identity.id];
                    const gross = result?.grossRevenue.amount;
                    const net = result?.estimatedNet?.amount;
                    const netShare = net === undefined || gross === undefined ? undefined : gross === 0 ? 0 : (net / gross) * 100;
                    return (
                      <article className="revenue-result-card" key={identity.id}>
                        <div className="revenue-result-market"><span>{flags[identity.id]}</span><strong>{marketNames[identity.id]}</strong></div>
                        <div className="scenario-app-price"><span>{revenueStrategyLabel} app price</span><strong>{selectedPrice ? formatMoney(selectedPrice.amount, selectedPrice.currency) : "Price unavailable"}</strong></div>
                        <div className="revenue-result-line"><span>Expected purchases</span><b>{result ? formatNumber(result.expectedPurchases, 2) : "Unavailable"}</b></div>
                        <div className="revenue-result-line"><span>Gross scenario</span><b>{result ? formatMoney(result.grossRevenue.amount, result.grossRevenue.currency) : "Unavailable"}</b></div>
                        <div className="revenue-result-line"><span>Net after configured fee</span><b>{result ? (result.estimatedNet ? formatMoney(result.estimatedNet.amount, result.estimatedNet.currency) : "Not modeled") : "Unavailable"}</b></div>
                        {result && <div className="scenario-bars" aria-label={netShare === undefined ? "Net revenue is not modeled for " + marketNames[result.marketId] : "Net revenue is " + formatNumber(netShare, 1) + " percent of gross for " + marketNames[result.marketId]}>
                          <div><span>Gross</span><i className="gross-bar" /></div>
                          {netShare === undefined ? <small className="unmodeled-net">Net is not modeled because no fee rate is configured.</small> : <div><span>Net share</span><i className="net-bar" style={{ width: netShare + "%" }} /></div>}
                        </div>}
                      </article>
                    );
                  })}
                </div>
                <p className="chart-note">Bars show net as a share of gross within each market. Revenue values use separate local currencies, so no cross-market total or ranking is implied.</p>
              </div>
              <div className="limitation-note"><strong>Scenario limitations</strong><span>Does not model market reach, demand response to price, taxes, refunds, platform rules, ranking effects, or cross-market behavior. Expected purchases may be fractional values.</span></div>
            </section>
          </details>

          <footer className="dashboard-footer"><span>Made for independent app developers.</span></footer>
          </>}
        </div>
      </main>
    </div>
  );
}
