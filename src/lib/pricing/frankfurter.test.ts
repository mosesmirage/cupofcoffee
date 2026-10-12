import assert from "node:assert/strict";
import test from "node:test";
import type { CurrencyCode, MarketId } from "./config.ts";
import {
  fetchFrankfurterRates,
  makeFallbackExchangeRates,
  mapFrankfurterRates,
  type DemoFallbackRates,
  type FrankfurterRateRow,
} from "../exchange-rates/frankfurter.ts";

const fallbackRates: DemoFallbackRates = { US: 1, TR: 32, UK: 0.8, DE: 0.92 };
const fetchedAt = "2026-10-12T10:15:00.000Z";

function makeRow(base: CurrencyCode, quote: CurrencyCode, rate: number): FrankfurterRateRow {
  return { date: "2026-10-11", base, quote, rate, providers: ["ecb", "tcmb"] };
}

test("maps live rates and provider/date provenance while using an identity rate for the base market", () => {
  const snapshot = mapFrankfurterRates("USD", [
    makeRow("USD", "TRY", 41.25),
    makeRow("USD", "GBP", 0.74),
    makeRow("USD", "EUR", 0.86),
  ], fallbackRates, fetchedAt);

  assert.equal(snapshot.baseCurrency, "USD");
  assert.equal(snapshot.rates.US.kind, "identity");
  assert.equal(snapshot.rates.US.rateToLocal, 1);
  assert.equal(snapshot.rates.US.provenance.status, "identity");
  assert.equal(snapshot.rates.TR.rateToLocal, 41.25);
  assert.equal(snapshot.rates.TR.kind, "live");
  assert.deepEqual(snapshot.rates.TR.provenance, {
    status: "sourced",
    source: "Frankfurter v2 (ecb, tcmb)",
    observedAt: "2026-10-11",
  });
  assert.equal(snapshot.rates.TR.fetchedAt, fetchedAt);
});

test("uses identity rate for whichever market matches the selected base currency", () => {
  const snapshot = mapFrankfurterRates("TRY", [makeRow("TRY", "USD", 0.024)], fallbackRates, fetchedAt);

  assert.equal(snapshot.rates.TR.kind, "identity");
  assert.equal(snapshot.rates.TR.rateToLocal, 1);
  assert.equal(snapshot.rates.US.kind, "live");
  assert.equal(snapshot.rates.US.rateToLocal, 0.024);
});

test("falls back only for a missing or invalid quote and labels it illustrative", () => {
  const snapshot = mapFrankfurterRates("USD", [
    makeRow("USD", "TRY", 41.25),
    makeRow("USD", "EUR", Number.NaN),
  ], fallbackRates, fetchedAt);

  assert.equal(snapshot.rates.TR.kind, "live");
  assert.equal(snapshot.rates.UK.kind, "fallback");
  assert.equal(snapshot.rates.UK.rateToLocal, fallbackRates.UK);
  assert.equal(snapshot.rates.UK.provenance.status, "illustrative");
  assert.equal("observedAt" in snapshot.rates.UK, false);
  assert.equal("fetchedAt" in snapshot.rates.UK, false);
  assert.equal(snapshot.rates.DE.kind, "fallback");
  assert.equal(snapshot.rates.DE.provenance.status, "illustrative");
});

test("keeps identity rates and uses demo rates after request-wide failures", () => {
  const snapshot = makeFallbackExchangeRates("GBP", fallbackRates, "Frankfurter is unavailable.");

  assert.equal(snapshot.rates.UK.kind, "identity");
  assert.equal(snapshot.rates.UK.rateToLocal, 1);
  for (const marketId of ["US", "TR", "DE"] satisfies MarketId[]) {
    assert.equal(snapshot.rates[marketId].kind, "fallback");
    assert.equal(snapshot.rates[marketId].rateToLocal, fallbackRates[marketId]);
    assert.equal(snapshot.rates[marketId].provenance.status, "illustrative");
    assert.equal("observedAt" in snapshot.rates[marketId], false);
    assert.equal("fetchedAt" in snapshot.rates[marketId], false);
  }
});

test("requests one batched quote set and handles HTTP or network failures", async () => {
  let requestedUrl = "";
  const responseRows = [makeRow("EUR", "USD", 1.16), makeRow("EUR", "TRY", 48), makeRow("EUR", "GBP", 0.86)];
  const snapshot = await fetchFrankfurterRates("EUR", fallbackRates, {
    fetchImpl: async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify(responseRows), { status: 200 });
    },
    now: () => new Date(fetchedAt),
  });
  const url = new URL(requestedUrl);
  assert.equal(url.pathname, "/v2/rates");
  assert.equal(url.searchParams.get("base"), "EUR");
  assert.equal(url.searchParams.get("quotes"), "USD,TRY,GBP");
  assert.equal(url.searchParams.get("expand"), "providers");
  assert.equal(snapshot.rates.DE.kind, "identity");
  assert.equal(snapshot.rates.US.rateToLocal, 1.16);

  await assert.rejects(fetchFrankfurterRates("USD", fallbackRates, {
    fetchImpl: async () => new Response("{}", { status: 503 }),
  }), /HTTP 503/);
  await assert.rejects(fetchFrankfurterRates("USD", fallbackRates, {
    fetchImpl: async () => { throw new Error("network unavailable"); },
  }), /network unavailable/);
});

test("surfaces a timed-out request", async () => {
  const hangingFetch = (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });

  await assert.rejects(fetchFrankfurterRates("USD", fallbackRates, {
    fetchImpl: hangingFetch,
    timeoutMs: 5,
  }), /timed out/);
});
