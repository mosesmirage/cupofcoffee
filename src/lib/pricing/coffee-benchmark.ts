import { INITIAL_MARKET_IDENTITIES, type CurrencyCode, type MarketId, type Money, type Provenance } from "./config.ts";

export type CoffeeBenchmarkStatus = "verified" | "candidate-unverified" | "user-entered" | "illustrative";
export type CoffeeBenchmarkFreshness = "current" | "stale" | "undated" | "invalid-date";
export type CoffeePriceType = "reported-in-store" | "delivery" | "unknown";
export type CoffeeBenchmarkSource = { name: string; url: string };

/** Provider-agnostic normalized record. No active external provider is configured in this MVP. */
export type CoffeeBenchmark = {
  id: string;
  marketId: MarketId;
  city?: string;
  coffeeType: string;
  productSize?: string;
  price: Money;
  priceType?: CoffeePriceType;
  sourceName?: string;
  sourceUrl?: string;
  additionalSources?: CoffeeBenchmarkSource[];
  /** Source-reported period; this is not an observation or verification date. */
  sourceReportedAt?: string;
  observedAt?: string;
  verifiedAt?: string;
  retrievedAt?: string;
  status: CoffeeBenchmarkStatus;
  retrieval: "live" | "cached" | "manual";
  notes: string[];
};

export type CoffeeBenchmarkOverrideDraft = {
  amount: string;
  coffeeType: string;
  city: string;
  sourceNote: string;
  observedAt: string;
};

export type CoffeeBenchmarkResolution = {
  benchmark?: CoffeeBenchmark;
  status: "verified" | "candidate-unverified" | "user-entered" | "illustrative" | "needs-review";
  errors: string[];
  freshness: CoffeeBenchmarkFreshness;
};

export type CoffeeComparisonDisplay =
  | { status: "available"; cups: number; price: Money; coffeeType: string; provenance: "verified" | "user-entered" | "candidate-demo" }
  | { status: "unavailable" };

export const COFFEE_BENCHMARK_MAX_AGE_DAYS = 90;
export const COFFEE_OVERRIDE_STORAGE_KEY = "cupofcoffee:coffee-benchmark-overrides:v1";

/** No market currently has a verified record with suitable source, price, and reuse evidence. */
export const VERIFIED_COFFEE_BENCHMARKS: readonly CoffeeBenchmark[] = [];

/** Candidate observations supplied for product context; none is verified or ratio-eligible. */
export const CANDIDATE_COFFEE_BENCHMARKS: readonly CoffeeBenchmark[] = [
  {
    id: "candidate-starbucks-cappuccino-us-nyc",
    marketId: "US",
    city: "New York City",
    coffeeType: "Starbucks Cappuccino",
    productSize: "Tall · 12 fl oz (approximately 355 ml)",
    price: { amount: 5.25, currency: "USD" },
    priceType: "reported-in-store",
    sourceName: "My Starbucks Calorie Calculator (third-party menu-price site)",
    sourceUrl: "https://mystarbuckscaloriecalculator.com/starbucks-menu/",
    status: "candidate-unverified",
    retrieval: "manual",
    notes: ["Candidate report of an in-store price; not independently verified against an official Starbucks source."],
  },
  {
    id: "candidate-starbucks-cappuccino-tr",
    marketId: "TR",
    coffeeType: "Starbucks Cappuccino",
    productSize: "Tall",
    price: { amount: 235, currency: "TRY" },
    priceType: "unknown",
    sourceName: "Yemek.com (third-party price source)",
    sourceUrl: "https://yemek.com/starbucks-kahve-fiyatlari/",
    additionalSources: [{ name: "Yemeksepeti listing", url: "https://www.yemeksepeti.com/restaurant/z4tz/starbucks-coffee-z4tz" }],
    status: "candidate-unverified",
    retrieval: "manual",
    notes: ["City is unknown. Price type is unknown; do not assume this is an in-store price."],
  },
  {
    id: "candidate-starbucks-cappuccino-uk",
    marketId: "UK",
    coffeeType: "Starbucks Cappuccino",
    productSize: "Tall",
    price: { amount: 4.3, currency: "GBP" },
    priceType: "unknown",
    sourceName: "Meaningful Vision (third-party pricing report)",
    sourceUrl: "https://meaningfulvision.com/uk-cappuccino-prices-rise-27-in-four-years/",
    sourceReportedAt: "2026-06",
    status: "candidate-unverified",
    retrieval: "manual",
    notes: ["City is unknown. The report references a June 2026 price; this is not a currently verified in-store price."],
  },
  {
    id: "candidate-starbucks-cappuccino-de",
    marketId: "DE",
    coffeeType: "Starbucks Cappuccino",
    productSize: "Tall · reported as 12 oz (approximately 354 ml)",
    price: { amount: 5.2, currency: "EUR" },
    priceType: "unknown",
    sourceName: "Burgerpreise.de (third-party price site)",
    sourceUrl: "https://burgerpreise.de/starbucks-preise/",
    status: "candidate-unverified",
    retrieval: "manual",
    notes: ["City is unknown. Not confirmed as an official or currently verified in-store price."],
  },
];

const marketFor = (marketId: MarketId) => INITIAL_MARKET_IDENTITIES.find(({ id }) => id === marketId)!;
const currencies: readonly CurrencyCode[] = ["USD", "TRY", "GBP", "EUR"];

function validObservationDate(value: string): boolean {
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function observationStart(value: string): number {
  if (/^\d{4}-\d{2}$/.test(value)) return Date.parse(`${value}-01T00:00:00.000Z`);
  return Date.parse(`${value}T00:00:00.000Z`);
}

export function coffeeBenchmarkFreshness(
  observedAt: string | undefined,
  now = Date.now(),
): CoffeeBenchmarkFreshness {
  if (!observedAt) return "undated";
  if (!validObservationDate(observedAt)) return "invalid-date";
  const age = now - observationStart(observedAt);
  if (age < 0) return "invalid-date";
  return age <= COFFEE_BENCHMARK_MAX_AGE_DAYS * 24 * 60 * 60 * 1000 ? "current" : "stale";
}

export function validateCoffeeBenchmarkRecord(record: unknown): string[] {
  if (typeof record !== "object" || record === null || Array.isArray(record)) return ["Benchmark record must be an object."];
  const value = record as Partial<CoffeeBenchmark>;
  const errors: string[] = [];
  const market = INITIAL_MARKET_IDENTITIES.find(({ id }) => id === value.marketId);
  if (!market) errors.push("Benchmark market is unsupported.");
  if (typeof value.id !== "string" || !value.id.trim()) errors.push("Benchmark record needs a stable ID.");
  if (typeof value.coffeeType !== "string" || !value.coffeeType.trim()) errors.push("Coffee type is required.");
  if (!value.price || typeof value.price.amount !== "number" || !Number.isFinite(value.price.amount) || value.price.amount <= 0) {
    errors.push("Coffee price must be a positive finite amount.");
  }
  if (!value.price || !currencies.includes(value.price.currency)) errors.push("Benchmark currency is unsupported.");
  else if (market && market.currency !== value.price.currency) errors.push("Benchmark currency must match its market.");
  if (!["verified", "candidate-unverified", "user-entered", "illustrative"].includes(value.status ?? "")) errors.push("Benchmark status is unsupported.");
  if (!["live", "cached", "manual"].includes(value.retrieval ?? "")) errors.push("Benchmark retrieval status is unsupported.");
  if (value.city !== undefined && typeof value.city !== "string") errors.push("City must be text.");
  if (value.productSize !== undefined && typeof value.productSize !== "string") errors.push("Product size must be text.");
  if (value.priceType !== undefined && !["reported-in-store", "delivery", "unknown"].includes(value.priceType)) errors.push("Price type is unsupported.");
  if (value.sourceUrl !== undefined) {
    try {
      if (!["http:", "https:"].includes(new URL(value.sourceUrl).protocol)) errors.push("Source URL must use HTTP or HTTPS.");
    } catch {
      errors.push("Source URL must be a valid URL.");
    }
  }
  if (value.additionalSources !== undefined) {
    if (!Array.isArray(value.additionalSources)) {
      errors.push("Additional sources must be a list.");
    } else {
      for (const source of value.additionalSources) {
        if (!source || typeof source.name !== "string" || !source.name.trim() || typeof source.url !== "string") {
          errors.push("Each additional source needs a name and URL.");
          continue;
        }
        try {
          if (!["http:", "https:"].includes(new URL(source.url).protocol)) errors.push("Additional source URLs must use HTTP or HTTPS.");
        } catch {
          errors.push("Additional source URL must be valid.");
        }
      }
    }
  }
  if (value.observedAt !== undefined && (typeof value.observedAt !== "string" || !validObservationDate(value.observedAt))) {
    errors.push("Observation date must use YYYY-MM-DD or YYYY-MM format.");
  }
  if (value.verifiedAt !== undefined && (typeof value.verifiedAt !== "string" || !validObservationDate(value.verifiedAt))) {
    errors.push("Verification date must use YYYY-MM-DD or YYYY-MM format.");
  }
  if (value.sourceReportedAt !== undefined && (typeof value.sourceReportedAt !== "string" || !validObservationDate(value.sourceReportedAt))) {
    errors.push("Source-reported period must use YYYY-MM-DD or YYYY-MM format.");
  }
  if (value.status === "verified") {
    if (typeof value.sourceName !== "string" || !value.sourceName.trim()) errors.push("Verified records require a source name.");
    if (!value.sourceUrl) errors.push("Verified records require a source URL.");
    if (!value.observedAt) errors.push("Verified records require an observation date.");
    if (!value.verifiedAt) errors.push("Verified records require a verification date.");
  } else if (value.verifiedAt !== undefined) {
    errors.push("Only independently verified records may have a verification date.");
  }
  if (value.status === "candidate-unverified") {
    if (typeof value.sourceName !== "string" || !value.sourceName.trim()) errors.push("Candidate records require a source name.");
    if (!value.sourceUrl) errors.push("Candidate records require a source URL.");
    if (typeof value.priceType !== "string") errors.push("Candidate records must identify whether price type is known.");
    if (!Array.isArray(value.notes) || !value.notes.some((note) => typeof note === "string" && note.trim())) errors.push("Candidate records require a limitation note.");
    if (value.verifiedAt !== undefined || value.observedAt !== undefined) errors.push("Candidate records cannot claim verification or observation dates without evidence.");
  }
  if (value.status !== "verified" && value.retrieval !== "manual") {
    errors.push("Candidate, user-entered, and illustrative records must use manual retrieval status.");
  }
  return errors;
}

export function makeIllustrativeCoffeeBenchmark(
  marketId: MarketId,
  amount: number,
  currency: CurrencyCode,
): CoffeeBenchmark {
  return {
    id: `illustrative-${marketId.toLowerCase()}`,
    marketId,
    coffeeType: "Illustrative local coffee reference (type not specified)",
    price: { amount, currency },
    sourceName: "CupOfCoffee demo configuration",
    status: "illustrative",
    retrieval: "manual",
    notes: ["Illustrative value only; not observed or verified market data."],
  };
}

export function makeUserCoffeeBenchmark(
  marketId: MarketId,
  draft: CoffeeBenchmarkOverrideDraft,
  now = Date.now(),
): CoffeeBenchmarkResolution {
  const market = marketFor(marketId);
  const errors: string[] = [];
  const amount = Number(draft.amount);
  if (draft.amount.trim() === "" || !Number.isFinite(amount) || amount <= 0) errors.push("Enter a coffee price greater than zero.");
  if (!draft.coffeeType.trim()) errors.push("Enter the type of coffee this price describes.");
  if (draft.observedAt && !validObservationDate(draft.observedAt)) errors.push("Use an observation date in YYYY-MM-DD or YYYY-MM format.");

  const benchmark: CoffeeBenchmark | undefined = errors.length ? undefined : {
    id: `user-${marketId.toLowerCase()}`,
    marketId,
    ...(draft.city.trim() ? { city: draft.city.trim() } : {}),
    coffeeType: draft.coffeeType.trim(),
    price: { amount, currency: market.currency },
    ...(draft.sourceNote.trim() ? { sourceName: draft.sourceNote.trim() } : {}),
    ...(draft.observedAt ? { observedAt: draft.observedAt } : {}),
    retrievedAt: new Date(now).toISOString(),
    status: "user-entered",
    retrieval: "manual",
    notes: ["Entered by the user; not independently verified."],
  };
  const freshness = coffeeBenchmarkFreshness(benchmark?.observedAt, now);
  return { ...(benchmark ? { benchmark } : {}), status: benchmark ? "user-entered" : "needs-review", errors, freshness };
}

/** Only current, dated verified or user-entered records can support a ratio. */
export function coffeeEquivalentForBenchmark(
  appPrice: Money,
  benchmark: CoffeeBenchmark,
  now = Date.now(),
  options: { allowCandidateDemo?: boolean } = {},
): number | undefined {
  const eligible = canShowCoffeeEquivalent(benchmark, now)
    || (options.allowCandidateDemo === true
      && benchmark.status === "candidate-unverified"
      && validateCoffeeBenchmarkRecord(benchmark).length === 0);
  if (!eligible) return undefined;
  const market = marketFor(benchmark.marketId);
  if (appPrice.currency !== benchmark.price.currency || appPrice.currency !== market.currency
    || !Number.isFinite(appPrice.amount) || appPrice.amount <= 0) return undefined;
  if (benchmark.status !== "candidate-unverified" && coffeeBenchmarkFreshness(benchmark.observedAt, now) !== "current") return undefined;
  const equivalent = appPrice.amount / benchmark.price.amount;
  return Number.isFinite(equivalent) ? equivalent : undefined;
}

/** UI view of the existing eligibility rule; never relaxes benchmark or currency validation. */
export function coffeeComparisonForDisplay(
  appPrice: Money,
  resolution: CoffeeBenchmarkResolution,
  now = Date.now(),
): CoffeeComparisonDisplay {
  const benchmark = resolution.benchmark;
  if (resolution.status === "candidate-unverified" && benchmark) {
    const cups = coffeeEquivalentForBenchmark(appPrice, benchmark, now, { allowCandidateDemo: true });
    return cups === undefined ? { status: "unavailable" } : {
      status: "available",
      cups,
      price: benchmark.price,
      coffeeType: benchmark.coffeeType,
      provenance: "candidate-demo",
    };
  }
  if (!benchmark || (resolution.status !== "verified" && resolution.status !== "user-entered")) {
    return { status: "unavailable" };
  }
  const cups = coffeeEquivalentForBenchmark(appPrice, benchmark, now);
  if (cups === undefined) return { status: "unavailable" };
  return {
    status: "available",
    cups,
    price: benchmark.price,
    coffeeType: benchmark.coffeeType,
    provenance: resolution.status,
  };
}

export function canShowCoffeeEquivalent(benchmark: CoffeeBenchmark, now = Date.now()): boolean {
  return !validateCoffeeBenchmarkRecord(benchmark).length
    && (benchmark.status === "verified" || benchmark.status === "user-entered")
    && coffeeBenchmarkFreshness(benchmark.observedAt, now) === "current";
}

/** Adapter boundary: candidate and illustrative observations never enter pricing-engine inputs. */
export function coffeePricingContext(
  benchmark: CoffeeBenchmark | undefined,
  now = Date.now(),
): { coffeePrice?: Money; coffeeProvenance?: Provenance } {
  if (!benchmark || !canShowCoffeeEquivalent(benchmark, now)) return {};
  if (benchmark.status === "verified") {
    return {
      coffeePrice: benchmark.price,
      coffeeProvenance: {
        status: "sourced",
        source: `${benchmark.sourceName} (${benchmark.sourceUrl})`,
        observedAt: benchmark.observedAt,
      },
    };
  }
  return {
    coffeePrice: benchmark.price,
    coffeeProvenance: { status: "user-configured", note: "User-entered coffee benchmark; not independently verified." },
  };
}

export function resolveCoffeeBenchmark(
  marketId: MarketId,
  demoBenchmark: CoffeeBenchmark,
  draft: CoffeeBenchmarkOverrideDraft | undefined,
  references: readonly CoffeeBenchmark[] = VERIFIED_COFFEE_BENCHMARKS,
  now = Date.now(),
): CoffeeBenchmarkResolution {
  if (draft) return makeUserCoffeeBenchmark(marketId, draft, now);
  const reference = references.find((record) => record.marketId === marketId);
  if (reference) {
    const errors = validateCoffeeBenchmarkRecord(reference);
    if (errors.length || (reference.status !== "verified" && reference.status !== "candidate-unverified")) {
      return {
        status: "needs-review",
        errors: errors.length ? errors : ["Reference dataset contains a record that is not independently verified."],
        freshness: coffeeBenchmarkFreshness(reference.observedAt, now),
      };
    }
    return {
      benchmark: reference,
      status: reference.status,
      errors: [],
      freshness: coffeeBenchmarkFreshness(reference.observedAt, now),
    };
  }
  const errors = validateCoffeeBenchmarkRecord(demoBenchmark);
  return errors.length
    ? { status: "needs-review", errors, freshness: "undated" }
    : { benchmark: demoBenchmark, status: "illustrative", errors: [], freshness: "undated" };
}

export function updateCoffeeOverrideDraft(
  current: Partial<Record<MarketId, CoffeeBenchmarkOverrideDraft>>,
  marketId: MarketId,
  field: keyof CoffeeBenchmarkOverrideDraft,
  value: string,
): Partial<Record<MarketId, CoffeeBenchmarkOverrideDraft>> {
  const existing = current[marketId] ?? { amount: "", coffeeType: "", city: "", sourceNote: "", observedAt: "" };
  return { ...current, [marketId]: { ...existing, [field]: value } };
}

export function clearCoffeeOverrideDraft(
  current: Partial<Record<MarketId, CoffeeBenchmarkOverrideDraft>>,
  marketId: MarketId,
): Partial<Record<MarketId, CoffeeBenchmarkOverrideDraft>> {
  const next = { ...current };
  delete next[marketId];
  return next;
}

export function parseCoffeeOverrideDrafts(value: string | null): Partial<Record<MarketId, CoffeeBenchmarkOverrideDraft>> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const result: Partial<Record<MarketId, CoffeeBenchmarkOverrideDraft>> = {};
    for (const market of INITIAL_MARKET_IDENTITIES) {
      const draft = (parsed as Record<string, unknown>)[market.id];
      if (typeof draft !== "object" || draft === null || Array.isArray(draft)) continue;
      const fields = draft as Record<string, unknown>;
      const keys: (keyof CoffeeBenchmarkOverrideDraft)[] = ["amount", "coffeeType", "city", "sourceNote", "observedAt"];
      if (keys.every((key) => typeof fields[key] === "string")) {
        result[market.id] = Object.fromEntries(keys.map((key) => [key, fields[key]])) as unknown as CoffeeBenchmarkOverrideDraft;
      }
    }
    return result;
  } catch {
    return {};
  }
}
