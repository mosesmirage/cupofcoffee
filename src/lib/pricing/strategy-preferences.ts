import { DEFAULT_STRATEGY_FACTORS, type StrategyId } from "./config.ts";

export const STRATEGY_PREFERENCES_STORAGE_KEY = "cupofcoffee.strategy-factors.v1";

export const DEFAULT_STRATEGY_FACTOR_TEXT: Record<StrategyId, string> = {
  accessible: DEFAULT_STRATEGY_FACTORS.accessible.toFixed(2),
  balanced: DEFAULT_STRATEGY_FACTORS.balanced.toFixed(2),
  premium: DEFAULT_STRATEGY_FACTORS.premium.toFixed(2),
};

/** Read editable values without replacing valid strings such as a just-entered decimal. */
export function parseStrategyPreferences(raw: string | null): Record<StrategyId, string> | undefined {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return undefined;
    const candidate = value as Record<string, unknown>;
    if (["accessible", "balanced", "premium"].some((id) => typeof candidate[id] !== "string")) return undefined;
    return {
      accessible: candidate.accessible as string,
      balanced: candidate.balanced as string,
      premium: candidate.premium as string,
    };
  } catch {
    return undefined;
  }
}
