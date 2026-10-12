import type { MarketId, Provenance } from "./config.ts";

const COUNTRY_CODES: Record<MarketId, string> = { US: "USA", TR: "TUR", UK: "GBR", DE: "DEU" };
const CURRENCIES: Record<MarketId, string> = { US: "USD", TR: "TRY", UK: "GBP", DE: "EUR" };
const CACHE_KEY = "cupofcoffee.world-bank-private-ppp.v1";
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;

export type PurchasingPowerSnapshot = {
  year: number;
  factors: Record<MarketId, number>;
  provenance: Record<MarketId, Provenance>;
};
export type PurchasingPowerSettings = {
  factors: Partial<Record<MarketId, string>>;
  provenance: Partial<Record<MarketId, Provenance>>;
};
type Options = { fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => Date; cache?: Storage | null };

/** Load sourced factors while preserving values the user has explicitly edited. */
export function mergePurchasingPowerSnapshot(
  current: PurchasingPowerSettings,
  snapshot: PurchasingPowerSnapshot,
): PurchasingPowerSettings {
  const factors: PurchasingPowerSettings["factors"] = {};
  const provenance: PurchasingPowerSettings["provenance"] = {};
  for (const id of Object.keys(COUNTRY_CODES) as MarketId[]) {
    const userEdited = current.provenance[id]?.status === "user-configured";
    factors[id] = userEdited && current.factors[id] !== undefined
      ? current.factors[id]
      : String(snapshot.factors[id]);
    provenance[id] = userEdited ? current.provenance[id] : snapshot.provenance[id];
  }
  return { factors, provenance };
}

export function setManualPurchasingPowerFactor(
  current: PurchasingPowerSettings,
  marketId: MarketId,
  factor: string,
): PurchasingPowerSettings {
  return {
    factors: { ...current.factors, [marketId]: factor },
    provenance: {
      ...current.provenance,
      [marketId]: { status: "user-configured", note: "Purchasing-power factor manually overridden by the user." },
    },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function calculateRelativePriceLevelFactors(
  pppByMarket: Record<MarketId, number>,
  annualFxByMarket: Record<MarketId, number>,
): Record<MarketId, number> {
  const usPriceLevel = pppByMarket.US / annualFxByMarket.US;
  if (!Number.isFinite(usPriceLevel) || usPriceLevel <= 0) throw new Error("US PPP and FX values must be positive and finite.");
  const factors = {} as Record<MarketId, number>;
  for (const id of Object.keys(COUNTRY_CODES) as MarketId[]) {
    const priceLevel = pppByMarket[id] / annualFxByMarket[id];
    const factor = priceLevel / usPriceLevel;
    if (![pppByMarket[id], annualFxByMarket[id], factor].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error(`Missing or invalid comparable PPP/FX data for ${id}.`);
    }
    factors[id] = id === "US" ? 1 : factor;
  }
  return factors;
}

export function selectCommonPppYear(response: unknown): { year: number; values: Record<MarketId, number> } {
  if (!Array.isArray(response) || !Array.isArray(response[1])) throw new Error("World Bank returned an unexpected PPP response.");
  const rows = response[1] as unknown[];
  const byCountry = {} as Record<MarketId, Map<number, number>>;
  for (const id of Object.keys(COUNTRY_CODES) as MarketId[]) {
    byCountry[id] = new Map();
    for (const row of rows) {
      if (!record(row) || row.countryiso3code !== COUNTRY_CODES[id] || typeof row.date !== "string") continue;
      const year = Number(row.date);
      if (Number.isInteger(year) && typeof row.value === "number" && Number.isFinite(row.value) && row.value > 0) byCountry[id].set(year, row.value);
    }
  }
  const common = [...byCountry.US.keys()].filter((year) => (Object.keys(COUNTRY_CODES) as MarketId[]).every((id) => byCountry[id].has(year))).sort((a, b) => b - a);
  const year = common[0];
  if (year === undefined) throw new Error("World Bank has no common year with valid PPP observations for all four markets.");
  return { year, values: Object.fromEntries((Object.keys(COUNTRY_CODES) as MarketId[]).map((id) => [id, byCountry[id].get(year)!])) as Record<MarketId, number> };
}

export function averageAnnualFrankfurterFx(response: unknown, year: number): Record<MarketId, number> {
  if (!Array.isArray(response)) throw new Error("Frankfurter returned an unexpected historical FX response.");
  const sums: Record<MarketId, number> = { US: 0, TR: 0, UK: 0, DE: 0 };
  const counts: Record<MarketId, number> = { US: 0, TR: 0, UK: 0, DE: 0 };
  for (const row of response) {
    if (!record(row) || typeof row.date !== "string" || !row.date.startsWith(`${year}-`) || row.base !== "USD") continue;
    for (const id of Object.keys(COUNTRY_CODES) as MarketId[]) {
      if (id === "US") continue;
      if (row.quote === CURRENCIES[id] && typeof row.rate === "number" && Number.isFinite(row.rate) && row.rate > 0) {
        sums[id] += row.rate; counts[id]++;
      }
    }
  }
  const avg: Record<MarketId, number> = { US: 1, TR: 0, UK: 0, DE: 0 };
  for (const id of ["TR", "UK", "DE"] as const) {
    if (!counts[id]) throw new Error(`No ${CURRENCIES[id]} historical FX observations for ${year}.`);
    avg[id] = sums[id] / counts[id];
  }
  return avg;
}

async function requestJson(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, cache: "force-cache", next: { revalidate: 2592000 } } as RequestInit);
    if (!response.ok) throw new Error(`Data request failed with HTTP ${response.status}.`);
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) throw new Error("PPP/FX request timed out.");
    throw error;
  } finally { clearTimeout(timeout); }
}

export async function fetchPurchasingPowerSnapshot(options: Options = {}): Promise<PurchasingPowerSnapshot> {
  const now = options.now ?? (() => new Date());
  const cache = options.cache;
  try {
    const raw = cache?.getItem(CACHE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (record(parsed) && typeof parsed.cachedAt === "number" && now().getTime() - parsed.cachedAt < CACHE_TTL && record(parsed.snapshot)) {
        return parsed.snapshot as PurchasingPowerSnapshot;
      }
    }
  } catch { /* Ignore unavailable or malformed browser cache. */ }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  const countries = Object.values(COUNTRY_CODES).join(";");
  const pppUrl = `https://api.worldbank.org/v2/country/${countries}/indicator/PA.NUS.PRVT.PP?format=json&per_page=200`;
  const ppp = selectCommonPppYear(await requestJson(pppUrl, fetchImpl, timeoutMs));
  // Match PPP's annual period using the arithmetic mean of that calendar year's daily USD/local observations.
  const fxUrl = new URL("https://api.frankfurter.dev/v2/rates");
  fxUrl.searchParams.set("base", "USD"); fxUrl.searchParams.set("quotes", "TRY,GBP,EUR");
  fxUrl.searchParams.set("from", `${ppp.year}-01-01`); fxUrl.searchParams.set("to", `${ppp.year}-12-31`);
  const fx = averageAnnualFrankfurterFx(await requestJson(fxUrl.toString(), fetchImpl, timeoutMs), ppp.year);
  const factors = calculateRelativePriceLevelFactors(ppp.values, fx);
  const provenance = {} as Record<MarketId, Provenance>;
  for (const id of Object.keys(COUNTRY_CODES) as MarketId[]) provenance[id] = {
    status: "sourced", source: "World Bank PA.NUS.PRVT.PP + Frankfurter annual average FX", observedAt: String(ppp.year),
  };
  const snapshot = { year: ppp.year, factors, provenance };
  try { cache?.setItem(CACHE_KEY, JSON.stringify({ cachedAt: now().getTime(), snapshot })); } catch { /* Cache is an optimization only. */ }
  return snapshot;
}
