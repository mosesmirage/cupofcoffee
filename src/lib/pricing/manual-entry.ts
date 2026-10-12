import type { CurrencyCode } from "./config.ts";

export type PricingJourney = "discover" | "manual" | "app";
export type ManualEntryState = { journey: PricingJourney; amount: string; currency: CurrencyCode };
export type ManualEntryAction =
  | { type: "open-manual" }
  | { type: "return-to-search" }
  | { type: "select-app"; amount: string; currency: CurrencyCode }
  | { type: "set-amount"; amount: string }
  | { type: "set-currency"; currency: CurrencyCode };

export function manualEntryReducer(state: ManualEntryState, action: ManualEntryAction): ManualEntryState {
  switch (action.type) {
    case "open-manual": return { ...state, journey: "manual" };
    case "return-to-search": return { ...state, journey: "discover" };
    case "select-app": return { ...state, journey: "app", amount: action.amount, currency: action.currency };
    case "set-amount": return { ...state, amount: action.amount };
    case "set-currency": return { ...state, currency: action.currency };
  }
}
