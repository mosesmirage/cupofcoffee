import { APPLE_STOREFRONTS, type AppleApp, type ApplePriceComparison } from "./client.ts";

export type AppReferencePrice = {
  amount: number;
  currency: "USD";
  sourceLabel: string;
} | {
  amount: null;
  currency: "USD";
  sourceLabel: string;
  message: string;
};

/** Use only the selected app's actual US storefront lookup price as the initial base. */
export function getAppReferencePrice(app: AppleApp, comparison: ApplePriceComparison | null): AppReferencePrice {
  if (!comparison || comparison.trackId !== app.trackId) {
    return { amount: null, currency: "USD", sourceLabel: "No storefront price", message: "No matching storefront price was returned. Enter a reference price to continue." };
  }

  const unitedStates = comparison.storefronts.find(({ storefrontId }) => storefrontId === APPLE_STOREFRONTS[0].id);
  const price = unitedStates?.app?.price;
  if (unitedStates?.status !== "available" || unitedStates.app?.trackId !== app.trackId || !price || price.currency !== "USD"
    || !Number.isFinite(price.amount) || price.amount <= 0) {
    const isFree = unitedStates?.status === "available" && unitedStates.app?.trackId === app.trackId
      && price?.currency === "USD" && price.amount === 0;
    return {
      amount: null,
      currency: "USD",
      sourceLabel: isFree ? "Free US App Store download" : "US App Store price unavailable",
      message: isFree
        ? "This app is free to download in the US. Enter a positive reference price for your paid app to continue."
        : "A usable US storefront price is unavailable. Enter a reference price to continue.",
    };
  }

  return {
    amount: price.amount,
    currency: "USD",
    sourceLabel: "US App Store download price",
  };
}
