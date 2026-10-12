import { INITIAL_MARKET_IDENTITIES, type MarketId, type Money, type StrategyId } from "./config.ts";
import type { PriceResult } from "./engine.ts";

/** Return the engine's exact valid final prices for one strategy, indexed by market. */
export function selectStrategyPrices(
  resultsByMarket: Partial<Record<MarketId, PriceResult[]>>,
  strategyId: StrategyId,
): Partial<Record<MarketId, Money>> {
  const prices: Partial<Record<MarketId, Money>> = {};

  for (const market of INITIAL_MARKET_IDENTITIES) {
    const selected = resultsByMarket[market.id]?.find((result) => result.strategyId === strategyId);
    const price = selected?.finalPrice;
    if (price && Number.isFinite(price.amount) && price.amount > 0 && price.currency === market.currency) {
      prices[market.id] = price;
    }
  }

  return prices;
}
