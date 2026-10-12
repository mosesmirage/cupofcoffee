"use client";

import { useState } from "react";
import { APPLE_STOREFRONTS, type AppleApp, type ApplePriceComparison, type AppleSearchResult, type AppleStorefrontId } from "@/lib/apple-app-store/client.ts";
import { formatFetchTime } from "@/lib/exchange-rates/format.ts";

type SearchState = "idle" | "loading" | "ready" | "error";
type PriceState = "idle" | "loading" | "ready" | "error";
const storefrontFlags: Record<AppleStorefrontId, string> = { US: "🇺🇸", TR: "🇹🇷", UK: "🇬🇧", DE: "🇩🇪" };

function formatRetrievedAt(value: string | null | undefined): string {
  return value ? formatFetchTime(value) : "No successful storefront lookup yet.";
}

function errorCopy(code: unknown): string {
  if (code === "invalid_search_term") return "Enter 2–80 characters to search the US App Store.";
  if (code === "timeout") return "Apple’s search took too long. Try again shortly.";
  if (code === "malformed_response") return "Apple returned data CupOfCoffee could not safely read.";
  if (code === "http_error" || code === "network") return "Could not retrieve App Store data from Apple. Try again shortly.";
  return "The Apple App Store request could not be completed. Try again.";
}

type Props = {
  onAppSelected: (app: AppleApp, comparison: ApplePriceComparison | null, error: string) => void;
  onEnterManual: () => void;
};

export default function CompetitorPriceResearch({ onAppSelected, onEnterManual }: Props) {
  const [term, setTerm] = useState("");
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [searchError, setSearchError] = useState("");
  const [searchResult, setSearchResult] = useState<AppleSearchResult | null>(null);
  const [priceState, setPriceState] = useState<PriceState>("idle");
  const [priceError, setPriceError] = useState("");
  const [selectedApp, setSelectedApp] = useState<AppleApp | null>(null);

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTerm = term.trim();
    if (normalizedTerm.length < 2) {
      setSearchError("Enter at least 2 characters to search the US App Store.");
      setSearchState("error");
      return;
    }
    if (searchState === "loading" || priceState === "loading") return;
    setSearchState("loading");
    setSearchError("");
    setSearchResult(null);
    setSelectedApp(null);
    setPriceState("idle");
    const query = new URLSearchParams({ q: normalizedTerm });
    try {
      const response = await fetch(`/api/apple-app-store/search?${query.toString()}`, { cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const error = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>).error : undefined;
        setSearchError(errorCopy(error));
        setSearchState("error");
        return;
      }
      if (!payload || typeof payload !== "object" || !Array.isArray((payload as AppleSearchResult).apps)) {
        setSearchError(errorCopy("malformed_response"));
        setSearchState("error");
        return;
      }
      setSearchResult(payload as AppleSearchResult);
      setSearchState("ready");
    } catch {
      setSearchError(errorCopy("network"));
      setSearchState("error");
    }
  }

  async function selectApp(app: AppleApp) {
    setSelectedApp(app);
    setPriceState("loading");
    setPriceError("");
    try {
      const response = await fetch("/api/apple-app-store/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ trackId: app.trackId }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const error = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>).error : undefined;
        setPriceError(errorCopy(error));
        setPriceState("error");
        onAppSelected(app, null, errorCopy(error));
        return;
      }
      if (!payload || typeof payload !== "object" || !Array.isArray((payload as ApplePriceComparison).storefronts)) {
        setPriceError(errorCopy("malformed_response"));
        setPriceState("error");
        onAppSelected(app, null, errorCopy("malformed_response"));
        return;
      }
      const result = payload as ApplePriceComparison;
      if (result.trackId !== app.trackId) {
        setPriceError("Apple returned an identifier that does not match the selected app. No prices were substituted.");
        setPriceState("error");
        onAppSelected(app, null, "Apple returned a different app identifier. No prices were substituted.");
        return;
      }
      setPriceState("ready");
      onAppSelected(app, result, "");
    } catch {
      setPriceError(errorCopy("network"));
      setPriceState("error");
      onAppSelected(app, null, errorCopy("network"));
    }
  }

  return (
    <section className="competitor-research app-discovery" aria-labelledby="competitor-price-title">
      <div className="competitor-research-header">
        <div>
          <span className="section-eyebrow">APP PRICING INTELLIGENCE</span>
          <h1 id="competitor-price-title">Price your app across four markets.</h1>
          <p>One app. Smarter local pricing.</p>
        </div>
      </div>

      <form className="competitor-search-form discovery-search-form" onSubmit={search} aria-busy={searchState === "loading"}>
        <label className="sr-only" htmlFor="competitor-search-term">Search the App Store</label>
        <div className="competitor-search-controls">
          <input id="competitor-search-term" type="search" value={term} maxLength={80} placeholder="Search the App Store…" onChange={(event) => setTerm(event.target.value)} />
          <button type="submit" disabled={searchState === "loading" || priceState === "loading"}>{searchState === "loading" ? <><span className="competitor-spinner" aria-hidden="true" />Searching…</> : "Search apps"}</button>
        </div>
        <button className="discovery-manual-link" type="button" onClick={onEnterManual}>Enter price manually</button>
      </form>

      {searchError && <p className="competitor-message error" role="alert">{searchError}</p>}
      {searchState === "ready" && searchResult?.apps.length === 0 && <p className="competitor-message" role="status">No matching apps were found in the US App Store. Try another name.</p>}

      {searchResult && searchResult.apps.length > 0 && <div className="competitor-results" aria-label="US App Store search results">
        <div className="competitor-results-heading"><strong>Search results</strong><span>{searchResult.apps.length} {searchResult.apps.length === 1 ? "app" : "apps"} · US storefront</span></div>
        {searchResult.apps.map((app) => (
          <button className={`competitor-app-option${selectedApp?.trackId === app.trackId ? " selected" : ""}`} type="button" key={app.trackId} onClick={() => void selectApp(app)} disabled={priceState === "loading"} aria-pressed={selectedApp?.trackId === app.trackId}>
            {app.artworkUrl
              ? <span className="competitor-app-icon" role="img" aria-label={`${app.name} app icon`} style={{ backgroundImage: `url("${app.artworkUrl}")` }} />
              : <span className="competitor-app-icon icon-placeholder" aria-hidden="true">▦</span>}
            <span className="competitor-app-details"><strong>{app.name}</strong><span className="competitor-app-developer">{app.developer}</span><span className="competitor-app-metadata">US APP STORE · ID {app.trackId}{app.bundleId ? ` · ${app.bundleId}` : ""}</span></span>
            <span className="competitor-app-price-wrap"><span className="competitor-app-price-label">DOWNLOAD</span><span className="competitor-app-us-price">{app.price ? app.price.isFree ? "Free" : app.price.formattedPrice : "Price unavailable"}</span></span>
          </button>
        ))}
      </div>}

      {priceState === "loading" && <p className="competitor-message loading" role="status" aria-live="polite"><span className="competitor-spinner dark" aria-hidden="true" />Checking storefront prices for {selectedApp?.name}…</p>}
      {priceError && <p className="competitor-message error" role="alert">{priceError}</p>}

    </section>
  );
}

export function SelectedAppStorefronts({
  app,
  comparison,
  lookupError,
  onChooseAnother,
}: {
  app: AppleApp;
  comparison: ApplePriceComparison | null;
  lookupError: string;
  onChooseAnother: () => void;
}) {
  return (
    <section className="competitor-research selected-app-panel" aria-labelledby="selected-app-heading">
      <div className="competitor-comparison-heading">
        <div className="selected-app-identity">
          {app.artworkUrl ? <span className="competitor-app-icon" role="img" aria-label={`${app.name} app icon`} style={{ backgroundImage: `url("${app.artworkUrl}")` }} /> : null}
          <div><span className="competitor-selected-label">SELECTED APP · APP DOWNLOAD</span><h2 id="selected-app-heading">{app.name}</h2><p>{app.developer}</p></div>
        </div>
        <div className="selected-app-actions">
          {app.trackViewUrl && <a href={app.trackViewUrl} target="_blank" rel="noreferrer">View on App Store</a>}
          <button type="button" onClick={onChooseAnother}>Choose another app</button>
        </div>
      </div>
      <div className="competitor-store-grid">
        {APPLE_STOREFRONTS.map((market) => {
          const result = comparison?.storefronts.find(({ storefrontId }) => storefrontId === market.id);
          const price = result?.status === "available" ? result.app?.price : undefined;
          return <article className="competitor-store-card" key={market.id}>
            <span className="competitor-store-name"><span className="competitor-country-flag" role="img" aria-label={`${market.name} flag`}>{storefrontFlags[market.id]}</span>{market.name}</span>
            {price ? <><strong>{price.isFree ? "Free" : price.formattedPrice}</strong><span className="competitor-store-currency">{price.currency} <i>{price.isFree ? "Free download" : "App download"}</i></span></> : <><strong className="unavailable-price">Price unavailable</strong><span>{result?.message ?? "Storefront price could not be checked."}</span></>}
          </article>;
        })}
      </div>
      {lookupError && <p className="competitor-message error" role="status">{lookupError}</p>}
      <p className="competitor-retrieved-at"><span>Source: Apple App Store</span><span>Last checked: {formatRetrievedAt(comparison?.lastSuccessfulRetrievalAt)}</span><span>In-app purchases and subscriptions are not included.</span></p>
    </section>
  );
}
