export const APPLE_STOREFRONTS = [
  { id: "US", countryCode: "us", name: "United States", currency: "USD" },
  { id: "TR", countryCode: "tr", name: "Türkiye", currency: "TRY" },
  { id: "UK", countryCode: "gb", name: "United Kingdom", currency: "GBP" },
  { id: "DE", countryCode: "de", name: "Germany", currency: "EUR" },
] as const;

export type AppleStorefrontId = typeof APPLE_STOREFRONTS[number]["id"];
export type AppleAppPrice = {
  amount: number;
  currency: string;
  formattedPrice: string;
  isFree: boolean;
};
export type AppleApp = {
  trackId: number;
  name: string;
  developer: string;
  bundleId?: string;
  artworkUrl?: string;
  trackViewUrl?: string;
  price?: AppleAppPrice;
};
export type AppleStorefrontPrice = {
  storefrontId: AppleStorefrontId;
  countryCode: string;
  countryName: string;
  currency: string;
  status: "available" | "unavailable" | "error";
  app?: AppleApp;
  retrievedAt?: string;
  message?: string;
};
export type AppleSearchResult = { apps: AppleApp[]; retrievedAt: string; source: "Apple iTunes Search API" };
export type ApplePriceComparison = {
  trackId: number;
  storefronts: AppleStorefrontPrice[];
  lastSuccessfulRetrievalAt: string | null;
  source: "Apple iTunes Search API";
};

export type AppleStoreErrorCode = "invalid_search_term" | "invalid_track_id" | "timeout" | "network" | "http_error" | "malformed_response";

export class AppleStoreApiError extends Error {
  readonly code: AppleStoreErrorCode;
  constructor(code: AppleStoreErrorCode) {
    super(code);
    this.name = "AppleStoreApiError";
    this.code = code;
  }
}

type FetchOptions = { fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => number };
type CachedResponse = { expiresAt: number; retrievedAt: string; payload: unknown };
const API_ROOT = "https://itunes.apple.com";
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const responseCache = new Map<string, CachedResponse>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validArtworkUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "mzstatic.com" || url.hostname.endsWith(".mzstatic.com"));
  } catch {
    return false;
  }
}

function validAppStoreUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "apps.apple.com" || url.hostname === "itunes.apple.com");
  } catch {
    return false;
  }
}

function parseApp(value: unknown): AppleApp | null {
  if (!isRecord(value) || value.wrapperType !== "software" || value.kind !== "software"
    || !Number.isSafeInteger(value.trackId) || (value.trackId as number) <= 0
    || typeof value.trackName !== "string" || !value.trackName.trim()
    || typeof value.artistName !== "string" || !value.artistName.trim()) return null;

  let price: AppleAppPrice | undefined;
  if (typeof value.price === "number" && Number.isFinite(value.price) && value.price >= 0
    && typeof value.currency === "string" && /^[A-Z]{3}$/.test(value.currency)) {
    price = {
      amount: value.price,
      currency: value.currency,
      formattedPrice: typeof value.formattedPrice === "string" ? value.formattedPrice : `${value.price} ${value.currency}`,
      isFree: value.price === 0,
    };
  }

  return {
    trackId: value.trackId as number,
    name: value.trackName,
    developer: value.artistName,
    ...(typeof value.bundleId === "string" ? { bundleId: value.bundleId } : {}),
    ...(validArtworkUrl(value.artworkUrl100) ? { artworkUrl: value.artworkUrl100 } : {}),
    ...(validAppStoreUrl(value.trackViewUrl) ? { trackViewUrl: value.trackViewUrl } : {}),
    ...(price ? { price } : {}),
  };
}

function parseResponsePayload(payload: unknown): unknown[] {
  if (!isRecord(payload) || !Number.isSafeInteger(payload.resultCount) || !Array.isArray(payload.results)) {
    throw new AppleStoreApiError("malformed_response");
  }
  return payload.results;
}

async function fetchJson(url: URL, options: FetchOptions): Promise<CachedResponse> {
  const now = options.now ?? Date.now;
  const key = url.toString();
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > now()) return cached;
  if (cached) responseCache.delete(key);

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(key, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") throw new AppleStoreApiError("timeout");
    throw new AppleStoreApiError("network");
  }
  if (!response.ok) throw new AppleStoreApiError("http_error");

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AppleStoreApiError("malformed_response");
  }
  const entry = { payload, retrievedAt: new Date(now()).toISOString(), expiresAt: now() + CACHE_TTL_MS };
  if (responseCache.size >= MAX_CACHE_ENTRIES) responseCache.delete(responseCache.keys().next().value as string);
  responseCache.set(key, entry);
  return entry;
}

function validateSearchTerm(term: string): string {
  const normalized = term.trim().replace(/\s+/g, " ");
  if (normalized.length < 2 || normalized.length > 80 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new AppleStoreApiError("invalid_search_term");
  }
  return normalized;
}

export async function searchAppleApps(term: string, options: FetchOptions = {}): Promise<AppleSearchResult> {
  const normalizedTerm = validateSearchTerm(term);
  const url = new URL("/search", API_ROOT);
  url.search = new URLSearchParams({
    term: normalizedTerm,
    media: "software",
    entity: "software",
    country: "us",
    limit: "10",
  }).toString();
  const { payload, retrievedAt } = await fetchJson(url, options);
  const rows = parseResponsePayload(payload);
  const uniqueApps = new Map<number, AppleApp>();
  for (const row of rows) {
    const app = parseApp(row);
    if (app) uniqueApps.set(app.trackId, app);
  }
  return { apps: [...uniqueApps.values()], retrievedAt, source: "Apple iTunes Search API" };
}

async function lookupAppleApp(trackId: number, countryCode: string, options: FetchOptions) {
  const url = new URL("/lookup", API_ROOT);
  url.search = new URLSearchParams({ id: String(trackId), country: countryCode }).toString();
  const { payload, retrievedAt } = await fetchJson(url, options);
  const rows = parseResponsePayload(payload);
  const matching = rows.map(parseApp).find((app) => app?.trackId === trackId);
  return { app: matching ?? null, retrievedAt };
}

export async function lookupAppleAppAcrossStorefronts(trackId: number, options: FetchOptions = {}): Promise<ApplePriceComparison> {
  if (!Number.isSafeInteger(trackId) || trackId <= 0) throw new AppleStoreApiError("invalid_track_id");

  const storefronts = await Promise.all(APPLE_STOREFRONTS.map(async (storefront): Promise<AppleStorefrontPrice> => {
    try {
      const { app, retrievedAt } = await lookupAppleApp(trackId, storefront.countryCode, options);
      if (!app) {
        return {
          storefrontId: storefront.id,
          countryCode: storefront.countryCode,
          countryName: storefront.name,
          currency: storefront.currency,
          status: "unavailable",
          retrievedAt,
          message: "Price unavailable — this app was not returned for this storefront or its identifier did not match.",
        };
      }
      return {
        storefrontId: storefront.id,
        countryCode: storefront.countryCode,
        countryName: storefront.name,
        currency: app.price?.currency ?? storefront.currency,
        status: app.price ? "available" : "unavailable",
        ...(app.price ? { app } : {}),
        retrievedAt,
        ...(!app.price ? { message: "Price unavailable — Apple did not return a valid download price." } : {}),
      };
    } catch (error) {
      return {
        storefrontId: storefront.id,
        countryCode: storefront.countryCode,
        countryName: storefront.name,
        currency: storefront.currency,
        status: "error",
        message: error instanceof AppleStoreApiError && error.code === "timeout"
          ? "Price unavailable — Apple’s lookup timed out."
          : "Price unavailable — Apple’s lookup could not be completed.",
      };
    }
  }));

  const successfulTimes = storefronts.flatMap(({ retrievedAt }) => retrievedAt ? [retrievedAt] : []);
  return {
    trackId,
    storefronts,
    lastSuccessfulRetrievalAt: successfulTimes.length ? successfulTimes.sort().at(-1)! : null,
    source: "Apple iTunes Search API",
  };
}

export function toAppleStorePublicError(error: unknown): { status: number; error: AppleStoreErrorCode } {
  const code = error instanceof AppleStoreApiError ? error.code : "network";
  const status: Record<AppleStoreErrorCode, number> = {
    invalid_search_term: 400,
    invalid_track_id: 400,
    timeout: 504,
    network: 502,
    http_error: 502,
    malformed_response: 502,
  };
  return { status: status[code], error: code };
}
