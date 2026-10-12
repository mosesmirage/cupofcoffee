import assert from "node:assert/strict";
import test from "node:test";
import { formatFetchTime } from "../exchange-rates/format.ts";

test("formats a valid fetch timestamp without incompatible Intl options", () => {
  assert.doesNotThrow(() => formatFetchTime("2026-10-12T10:30:00.000Z"));
  assert.notEqual(formatFetchTime("2026-10-12T10:30:00.000Z"), "Fetch time unavailable");
});

test("reports unavailable for missing, blank, or invalid fetch timestamps", () => {
  for (const timestamp of [undefined, null, "", "   ", "not-a-timestamp"]) {
    assert.equal(formatFetchTime(timestamp), "Fetch time unavailable");
  }
});
