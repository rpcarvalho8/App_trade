import type { StrategyDefinition } from "./types";
import xau from "./xauusd-london-structure.json";
import sol from "./solusd-smc-3step.json";

export const STRATEGY_XAUUSD = xau as StrategyDefinition;
export const STRATEGY_SOLUSD = sol as StrategyDefinition;

export const STRATEGIES: Record<string, StrategyDefinition> = {
  [STRATEGY_XAUUSD.id]: STRATEGY_XAUUSD,
  [STRATEGY_SOLUSD.id]: STRATEGY_SOLUSD,
};

export function getStrategyForSymbol(symbol: string): StrategyDefinition | null {
  const s = String(symbol || "").toUpperCase();
  if (s === "XAUUSD") return STRATEGY_XAUUSD;
  if (s === "SOLUSD") return STRATEGY_SOLUSD;
  return STRATEGIES[s] || null;
}

export * from "./types";
export { evaluateStrategy, createEngineState, detectBiasH4, calcRR, normalizeTf } from "./engine";
export * from "./detectors";
