import { INITIAL_MARKET_IDENTITIES, type CurrencyCode, type ExchangeRateProvenance, type MarketId, type Provenance } from "../pricing/config.ts";

export type ExchangeRateKind = "live" | "identity" | "fallback";

type LiveRateProvenance = Provenance & { status: "sourced"; source: string; observedAt: string };
type FallbackRateProvenance = Provenance & { status: "illustrative"; note: string };

export type MarketExchangeRate =
  | {
      rateToLocal: number;
      kind: "live";
      provenance: LiveRateProvenance;
      observedAt: string;
      fetchedAt: string;
    }
  | {
      rateToLocal: 1;
      kind: "identity";
      provenance: Extract<ExchangeRateProvenance, { status: "identity" }>;
    }
  | {
      rateToLocal: number;
      kind: "fallback";
      provenance: FallbackRateProvenance;
    };

export type ExchangeRateSnapshot = {
  baseCurrency: CurrencyCode;
  rates: Record<MarketId, MarketExchangeRate>;
  fetchedAt?: string;
};

export type FrankfurterRateRow = {
  date: string;
  base: string;
  quote: string;
  rate: number;
  providers?: string[];
};

export type DemoFallbackRates = Record<MarketId, number>;

type FetchOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => Date;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isFrankfurterRateRow(value: unknown, base: CurrencyCode, quote: CurrencyCode): value is FrankfurterRateRow {
  return isRecord(value)
    && typeof value.base === "string"
    && value.base.toUpperCase() === base
    && typeof value.quote === "string"
    && value.quote.toUpperCase() === quote
    && isIsoDate(value.date)
    && isPositiveFinite(value.rate);
}

function identityRate(marketName: string, baseCurrency: CurrencyCode): MarketExchangeRate {
  return {
    rateToLocal: 1,
    kind: "identity",
    provenance: {
      status: "identity",
      note: `The base currency and ${marketName} market currency are both ${baseCurrency}.`,
    },
  };
}

function fallbackRate(rateToLocal: number, reason: string): MarketExchangeRate {
  return {
    rateToLocal,
    kind: "fallback",
    provenance: {
      status: "illustrative",
      note: `Illustrative demo fallback rate. ${reason}`,
    },
  };
}

/** Map a Frankfurter v2 rates response, falling back quote-by-quote when needed. */
export function mapFrankfurterRates(
  baseCurrency: CurrencyCode,
  response: unknown,
  demoFallbackRates: DemoFallbackRates,
  fetchedAt: string,
): ExchangeRateSnapshot {
  if (!Array.isArray(response)) throw new Error("Frankfurter returned an unexpected rates response.");
  if (!Number.isFinite(Date.parse(fetchedAt))) throw new Error("Rate fetch timestamp is invalid.");

  const rates = {} as Record<MarketId, MarketExchangeRate>;
  for (const market of INITIAL_MARKET_IDENTITIES) {
    if (market.currency === baseCurrency) {
      rates[market.id] = identityRate(market.name, baseCurrency);
      continue;
    }

    const row = response.find((candidate: unknown) => {
      if (!isRecord(candidate)) return false;
      return typeof candidate.base === "string"
        && candidate.base.toUpperCase() === baseCurrency
        && typeof candidate.quote === "string"
        && candidate.quote.toUpperCase() === market.currency;
    });

    if (!isFrankfurterRateRow(row, baseCurrency, market.currency)) {
      rates[market.id] = fallbackRate(
        demoFallbackRates[market.id],
        `Frankfurter did not provide a valid ${baseCurrency}/${market.currency} quote.`,
      );
      continue;
    }

    const providers = Array.isArray(row.providers)
      ? row.providers.filter((provider): provider is string => typeof provider === "string" && provider.trim() !== "")
      : [];
    const source = providers.length > 0
      ? `Frankfurter v2 (${providers.join(", ")})`
      : "Frankfurter v2 blended reference rates";
    const provenance: LiveRateProvenance = {
      status: "sourced",
      source,
      observedAt: row.date,
    };
    rates[market.id] = {
      rateToLocal: row.rate,
      kind: "live",
      provenance,
      observedAt: row.date,
      fetchedAt,
    };
  }

  return { baseCurrency, rates, fetchedAt };
}

/** Produce clearly illustrative fallbacks after a request-wide failure. */
export function makeFallbackExchangeRates(
  baseCurrency: CurrencyCode,
  demoFallbackRates: DemoFallbackRates,
  reason: string,
): ExchangeRateSnapshot {
  const rates = {} as Record<MarketId, MarketExchangeRate>;
  for (const market of INITIAL_MARKET_IDENTITIES) {
    rates[market.id] = market.currency === baseCurrency
      ? identityRate(market.name, baseCurrency)
      : fallbackRate(demoFallbackRates[market.id], reason);
  }
  return { baseCurrency, rates };
}

/** Fetch a single base-to-all-quotes batch; the pricing engine remains offline and deterministic. */
export async function fetchFrankfurterRates(
  baseCurrency: CurrencyCode,
  demoFallbackRates: DemoFallbackRates,
  options: FetchOptions = {},
): Promise<ExchangeRateSnapshot> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 8_000;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", forwardAbort, { once: true });

  const quoteCurrencies = INITIAL_MARKET_IDENTITIES
    .map(({ currency }) => currency)
    .filter((currency) => currency !== baseCurrency);
  const url = new URL("https://api.frankfurter.dev/v2/rates");
  url.searchParams.set("base", baseCurrency);
  url.searchParams.set("quotes", quoteCurrencies.join(","));
  url.searchParams.set("expand", "providers");

  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Frankfurter request failed with HTTP ${response.status}.`);
    const body: unknown = await response.json();
    const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
    return mapFrankfurterRates(baseCurrency, body, demoFallbackRates, fetchedAt);
  } catch (error) {
    if (timedOut) throw new Error("Frankfurter request timed out.");
    if (options.signal?.aborted) {
      const abortError = new Error("Rate request was superseded.");
      abortError.name = "AbortError";
      throw abortError;
    }
    if (error instanceof Error) throw error;
    throw new Error("Frankfurter request failed.");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}
