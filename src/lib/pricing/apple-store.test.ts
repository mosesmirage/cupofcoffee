import assert from "node:assert/strict";
import test from "node:test";
import {
  APPLE_STOREFRONTS,
  AppleStoreApiError,
  lookupAppleAppAcrossStorefronts,
  searchAppleApps,
  toAppleStorePublicError,
} from "../apple-app-store/client.ts";
import { getAppReferencePrice } from "../apple-app-store/workflow.ts";

function jsonResponse(status: number, payload: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => payload } as Response;
}

function app(trackId: number, country: string, price: number, currency: string) {
  return {
    wrapperType: "software",
    kind: "software",
    trackId,
    trackName: "Example App",
    artistName: "Example Developer",
    bundleId: "com.example.app",
    artworkUrl100: "https://is1-ssl.mzstatic.com/image/app.png",
    trackViewUrl: "https://apps.apple.com/us/app/example/id812300003",
    price,
    formattedPrice: price === 0 ? "Free" : `${price.toFixed(2)} ${currency}`,
    currency,
    country,
  };
}

test("searches only the US software storefront and returns safe app fields", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const result = await searchAppleApps("  Example App  ", {
    now: () => Date.parse("2026-01-02T03:04:05.000Z"),
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return jsonResponse(200, {
        resultCount: 2,
        results: [
          { ...app(812300001, "USA", 0, "USD"), internal: "not returned" },
          { ...app(812300002, "USA", 2.99, "USD"), wrapperType: "track", kind: "song" },
        ],
      });
    },
  });
  const url = new URL(requestUrl);
  assert.equal(url.origin, "https://itunes.apple.com");
  assert.equal(url.pathname, "/search");
  assert.equal(url.searchParams.get("term"), "Example App");
  assert.equal(url.searchParams.get("media"), "software");
  assert.equal(url.searchParams.get("entity"), "software");
  assert.equal(url.searchParams.get("country"), "us");
  assert.equal(url.searchParams.get("limit"), "10");
  assert.equal(new Headers(requestInit?.headers).get("accept"), "application/json");
  assert.equal(requestInit?.cache, "no-store");
  assert.deepEqual(result.apps, [{
    trackId: 812300001,
    name: "Example App",
    developer: "Example Developer",
    bundleId: "com.example.app",
    artworkUrl: "https://is1-ssl.mzstatic.com/image/app.png",
    trackViewUrl: "https://apps.apple.com/us/app/example/id812300003",
    price: { amount: 0, currency: "USD", formattedPrice: "Free", isFree: true },
  }]);
  assert.equal(JSON.stringify(result).includes("internal"), false);
  assert.equal(result.retrievedAt, "2026-01-02T03:04:05.000Z");
});

test("initializes the reference price only from the selected app's valid paid US listing", async () => {
  const appResult = await searchAppleApps("Reference initialization 80513", {
    fetchImpl: async () => jsonResponse(200, { resultCount: 1, results: [app(812300013, "USA", 4.99, "USD")] }),
  });
  const result = await lookupAppleAppAcrossStorefronts(812300013, {
    fetchImpl: async (input) => {
      const country = new URL(String(input)).searchParams.get("country");
      return country === "us"
        ? jsonResponse(200, { resultCount: 1, results: [app(812300013, "USA", 4.99, "USD")] })
        : jsonResponse(200, { resultCount: 0, results: [] });
    },
  });
  const selectedApp = appResult.apps[0]!;
  assert.deepEqual(getAppReferencePrice(selectedApp, result), {
    amount: 4.99, currency: "USD", sourceLabel: "US App Store download price",
  });
});

test("does not use a free or unavailable US listing as a paid app reference price", () => {
  const selectedApp = { trackId: 812300014, name: "Free App", developer: "Example" };
  const freeComparison = {
    trackId: selectedApp.trackId,
    storefronts: [{ storefrontId: "US", status: "available", app: { ...selectedApp, price: { amount: 0, currency: "USD", formattedPrice: "Free", isFree: true } } }],
    lastSuccessfulRetrievalAt: null,
    source: "Apple iTunes Search API",
  } as unknown as import("../apple-app-store/client.ts").ApplePriceComparison;
  const unavailableComparison = {
    ...freeComparison,
    storefronts: [{ storefrontId: "US", status: "unavailable" }],
  } as unknown as import("../apple-app-store/client.ts").ApplePriceComparison;
  const mismatchedComparison = { ...freeComparison, trackId: 912300014 };
  const wrongCurrencyComparison = {
    ...freeComparison,
    storefronts: [{ storefrontId: "US", status: "available", app: { ...selectedApp, price: { amount: 9.99, currency: "TRY", formattedPrice: "₺9.99", isFree: false } } }],
  } as unknown as import("../apple-app-store/client.ts").ApplePriceComparison;
  const substitutedAppComparison = {
    ...freeComparison,
    storefronts: [{ storefrontId: "US", status: "available", app: { ...selectedApp, trackId: 999, price: { amount: 9.99, currency: "USD", formattedPrice: "$9.99", isFree: false } } }],
  } as unknown as import("../apple-app-store/client.ts").ApplePriceComparison;
  const freeReference = getAppReferencePrice(selectedApp, freeComparison);
  const unavailableReference = getAppReferencePrice(selectedApp, unavailableComparison);
  assert.equal(freeReference.amount, null);
  assert.equal(freeReference.amount === null && /free to download/.test(freeReference.message), true);
  assert.equal(unavailableReference.amount, null);
  assert.equal(unavailableReference.amount === null && /unavailable/.test(unavailableReference.message), true);
  assert.equal(getAppReferencePrice(selectedApp, null).amount, null);
  assert.equal(getAppReferencePrice(selectedApp, mismatchedComparison).amount, null);
  assert.equal(getAppReferencePrice(selectedApp, wrongCurrencyComparison).amount, null);
  assert.equal(getAppReferencePrice(selectedApp, substitutedAppComparison).amount, null);
});

test("returns an empty search result without treating it as malformed", async () => {
  const result = await searchAppleApps("No App Matches 981", {
    fetchImpl: async () => jsonResponse(200, { resultCount: 0, results: [] }),
  });
  assert.deepEqual(result.apps, []);
});

test("looks up all four country codes and returns free and paid download prices in local currencies", async () => {
  const countryValues: Record<string, { price: number; currency: string; country: string }> = {
    us: { price: 0, currency: "USD", country: "USA" },
    tr: { price: 19.99, currency: "TRY", country: "TUR" },
    gb: { price: 4.99, currency: "GBP", country: "GBR" },
    de: { price: 5.99, currency: "EUR", country: "DEU" },
  };
  const calls: string[] = [];
  const result = await lookupAppleAppAcrossStorefronts(812300003, {
    now: () => Date.parse("2026-02-03T04:05:06.000Z"),
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      calls.push(url.searchParams.get("country") ?? "");
      const country = url.searchParams.get("country") ?? "us";
      const item = countryValues[country];
      return jsonResponse(200, { resultCount: 1, results: [app(812300003, item.country, item.price, item.currency)] });
    },
  });
  assert.deepEqual([...calls].sort(), ["de", "gb", "tr", "us"]);
  assert.deepEqual(APPLE_STOREFRONTS.map(({ countryCode }) => countryCode), ["us", "tr", "gb", "de"]);
  assert.deepEqual(result.storefronts.map(({ countryCode, status, currency, app: found }) => ({
    countryCode, status, currency, amount: found?.price?.amount, isFree: found?.price?.isFree,
  })), [
    { countryCode: "us", status: "available", currency: "USD", amount: 0, isFree: true },
    { countryCode: "tr", status: "available", currency: "TRY", amount: 19.99, isFree: false },
    { countryCode: "gb", status: "available", currency: "GBP", amount: 4.99, isFree: false },
    { countryCode: "de", status: "available", currency: "EUR", amount: 5.99, isFree: false },
  ]);
  assert.equal(result.lastSuccessfulRetrievalAt, "2026-02-03T04:05:06.000Z");
});

test("shows unavailable when an app is missing from a storefront", async () => {
  const result = await lookupAppleAppAcrossStorefronts(812300004, {
    fetchImpl: async (input) => {
      const country = new URL(String(input)).searchParams.get("country");
      return jsonResponse(200, country === "tr"
        ? { resultCount: 0, results: [] }
        : { resultCount: 1, results: [app(812300004, country ?? "USA", 1.99, country === "gb" ? "GBP" : country === "de" ? "EUR" : "USD")] });
    },
  });
  const turkey = result.storefronts.find(({ countryCode }) => countryCode === "tr");
  assert.equal(turkey?.status, "unavailable");
  assert.match(turkey?.message ?? "", /Price unavailable/);
  assert.equal(turkey?.app, undefined);
});

test("does not substitute a lookup result whose trackId differs from the selected app", async () => {
  const result = await lookupAppleAppAcrossStorefronts(812300005, {
    fetchImpl: async () => jsonResponse(200, { resultCount: 1, results: [app(999999999, "USA", 2.99, "USD")] }),
  });
  assert.ok(result.storefronts.every(({ status, app: found }) => status === "unavailable" && found === undefined));
});

test("maps malformed responses and filters unexpected app records safely", async () => {
  await assert.rejects(searchAppleApps("Malformed response 74921", {
    fetchImpl: async () => jsonResponse(200, { results: "unexpected" }),
  }), (error: unknown) => error instanceof AppleStoreApiError && error.code === "malformed_response");

  const result = await searchAppleApps("Unexpected records 74922", {
    fetchImpl: async () => jsonResponse(200, {
      resultCount: 1,
      results: [{ trackId: "not numeric", trackName: "Injected", artistName: "Unknown", wrapperType: "software", kind: "software" }],
    }),
  });
  assert.deepEqual(result.apps, []);
});

test("classifies timeouts, network errors, HTTP errors, and invalid inputs without provider details", async () => {
  await assert.rejects(searchAppleApps("Timeout check 28191", {
    fetchImpl: async () => { throw new DOMException("private provider detail", "TimeoutError"); },
  }), (error: unknown) => error instanceof AppleStoreApiError && error.code === "timeout");
  await assert.rejects(searchAppleApps("Network check 28192", {
    fetchImpl: async () => { throw new Error("private provider detail"); },
  }), (error: unknown) => error instanceof AppleStoreApiError && error.code === "network");
  await assert.rejects(searchAppleApps("HTTP check 28193", {
    fetchImpl: async () => jsonResponse(429, { detail: "sensitive provider response" }),
  }), (error: unknown) => error instanceof AppleStoreApiError && error.code === "http_error");
  await assert.rejects(searchAppleApps("x"), (error: unknown) => error instanceof AppleStoreApiError && error.code === "invalid_search_term");
  await assert.rejects(lookupAppleAppAcrossStorefronts(0), (error: unknown) => error instanceof AppleStoreApiError && error.code === "invalid_track_id");
  assert.deepEqual(toAppleStorePublicError(new Error("sensitive detail")), { status: 502, error: "network" });
});

test("caches a successful search briefly to limit repeated upstream calls", async () => {
  let calls = 0;
  const options = {
    now: () => Date.parse("2026-03-04T05:06:07.000Z"),
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(200, { resultCount: 0, results: [] });
    },
  };
  const term = "Cache check 10073";
  const first = await searchAppleApps(term, options);
  const second = await searchAppleApps(term, options);
  assert.equal(calls, 1);
  assert.equal(first.retrievedAt, second.retrievedAt);
});
