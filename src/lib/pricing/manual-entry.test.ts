import assert from "node:assert/strict";
import test from "node:test";
import { manualEntryReducer, type ManualEntryState } from "./manual-entry.ts";

const initial: ManualEntryState = { journey: "discover", amount: "4.99", currency: "USD" };

test("manual entry opens with editable reference amount and currency, then returns to App Store search", () => {
  const opened = manualEntryReducer(initial, { type: "open-manual" });
  assert.equal(opened.journey, "manual");

  const withAmount = manualEntryReducer(opened, { type: "set-amount", amount: "12.50" });
  const withCurrency = manualEntryReducer(withAmount, { type: "set-currency", currency: "EUR" });
  assert.equal(withCurrency.amount, "12.50");
  assert.equal(withCurrency.currency, "EUR");

  const searching = manualEntryReducer(withCurrency, { type: "return-to-search" });
  assert.equal(searching.journey, "discover");
  assert.equal(searching.amount, "12.50");
  assert.equal(searching.currency, "EUR");
});

test("selecting an App Store app switches to app mode and uses its reference price", () => {
  assert.deepEqual(
    manualEntryReducer(initial, { type: "select-app", amount: "2.99", currency: "GBP" }),
    { journey: "app", amount: "2.99", currency: "GBP" },
  );
});
