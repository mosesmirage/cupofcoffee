import assert from "node:assert/strict";
import test from "node:test";
import {
  averageAnnualFrankfurterFx,
  calculateRelativePriceLevelFactors,
  fetchPurchasingPowerSnapshot,
  selectCommonPppYear,
} from "./purchasing-power.ts";

const pppRows = [
  { countryiso3code: "USA", date: "2022", value: 1 },
  { countryiso3code: "TUR", date: "2022", value: 10 },
  { countryiso3code: "GBR", date: "2022", value: 0.7 },
  { countryiso3code: "DEU", date: "2022", value: 0.8 },
  { countryiso3code: "USA", date: "2023", value: 1.1 },
  { countryiso3code: "TUR", date: "2023", value: null },
  { countryiso3code: "GBR", date: "2023", value: 0.75 },
  { countryiso3code: "DEU", date: "2023", value: 0.85 },
];

test("selects the latest common year with valid non-null PPP observations", () => {
  assert.deepEqual(selectCommonPppYear([{ }, pppRows]), {
    year: 2022, values: { US: 1, TR: 10, UK: 0.7, DE: 0.8 },
  });
});

test("rejects missing common-year data and malformed World Bank responses", () => {
  assert.throws(() => selectCommonPppYear([{}, [{ countryiso3code: "USA", date: "2022", value: 1 }]]), /no common year/i);
  assert.throws(() => selectCommonPppYear({}), /unexpected PPP response/i);
});

test("normalizes country price levels to a fixed US baseline of one", () => {
  const factors = calculateRelativePriceLevelFactors(
    { US: 1, TR: 10, UK: 0.7, DE: 0.8 },
    { US: 1, TR: 20, UK: 0.8, DE: 0.9 },
  );
  assert.equal(factors.US, 1);
  assert.equal(factors.TR, 0.5);
  assert.ok(Math.abs(factors.UK - 0.875) < 1e-12);
  assert.ok(Math.abs(factors.DE - (0.8 / 0.9)) < 1e-12);
  assert.throws(() => calculateRelativePriceLevelFactors({ US: 1, TR: 0, UK: 1, DE: 1 }, { US: 1, TR: 1, UK: 1, DE: 1 }), /invalid comparable/i);
});

test("averages matching-year Frankfurter observations and skips malformed rows", () => {
  assert.deepEqual(averageAnnualFrankfurterFx([
    { date: "2022-01-03", base: "USD", quote: "TRY", rate: 10 },
    { date: "2022-01-03", base: "USD", quote: "GBP", rate: 0.8 },
    { date: "2022-01-03", base: "USD", quote: "EUR", rate: 0.9 },
    { date: "2022-01-04", base: "USD", quote: "TRY", rate: 20 },
    { date: "2021-12-31", base: "USD", quote: "TRY", rate: 99 },
    null,
  ], 2022), { US: 1, TR: 15, UK: 0.8, DE: 0.9 });
  assert.throws(() => averageAnnualFrankfurterFx([], 2022), /No TRY/i);
});

test("returns sourced factors from paired API responses and rejects API failures for UI fallback", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("worldbank.org")) return new Response(JSON.stringify([{}, pppRows.slice(0, 4)]), { status: 200 });
    return new Response(JSON.stringify([
      { date: "2022-01-01", base: "USD", quote: "TRY", rate: 20 },
      { date: "2022-01-01", base: "USD", quote: "GBP", rate: 0.8 },
      { date: "2022-01-01", base: "USD", quote: "EUR", rate: 0.9 },
    ]), { status: 200 });
  };
  const snapshot = await fetchPurchasingPowerSnapshot({ fetchImpl, now: () => new Date("2026-10-12T00:00:00Z"), cache: null });
  assert.equal(snapshot.factors.US, 1);
  assert.equal(snapshot.factors.TR, 0.5);
  assert.equal(snapshot.provenance.TR.status, "sourced");
  await assert.rejects(fetchPurchasingPowerSnapshot({ fetchImpl: async () => new Response("{}", { status: 503 }), cache: null }), /HTTP 503/);
});
