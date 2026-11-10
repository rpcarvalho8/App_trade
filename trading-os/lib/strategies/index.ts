import type { StrategyDefinition } from "./types";
import xau from "./xauusd-london-structure.json";
import sol from "./solusd-smc-3step.json";
import xauRot from "./xauusd-htf-rotation.json";
import solRot from "./solusd-htf-rotation.json";

export const STRATEGY_XAUUSD = xau as unknown as StrategyDefinition;
export const STRATEGY_SOLUSD = sol as unknown as StrategyDefinition;
/** Rotação entre imbalances / order blocks H4–H1 com entrada M5. */
export const STRATEGY_XAUUSD_ROTATION = xauRot as unknown as StrategyDefinition;
export const STRATEGY_SOLUSD_ROTATION = solRot as unknown as StrategyDefinition;

export const STRATEGIES: Record<string, StrategyDefinition> = {
  [STRATEGY_XAUUSD.id]: STRATEGY_XAUUSD,
  [STRATEGY_XAUUSD_ROTATION.id]: STRATEGY_XAUUSD_ROTATION,
  [STRATEGY_SOLUSD.id]: STRATEGY_SOLUSD,
  [STRATEGY_SOLUSD_ROTATION.id]: STRATEGY_SOLUSD_ROTATION,
};

/** Estratégias que o motor corre por activo (a primeira é a principal da Mesa). */
export const STRATEGIES_BY_SYMBOL: Record<"XAUUSD" | "SOLUSD", StrategyDefinition[]> = {
  XAUUSD: [STRATEGY_XAUUSD, STRATEGY_XAUUSD_ROTATION],
  SOLUSD: [STRATEGY_SOLUSD, STRATEGY_SOLUSD_ROTATION],
};

export function getStrategyForSymbol(symbol: string): StrategyDefinition | null {
  const s = String(symbol || "").toUpperCase();
  if (s === "XAUUSD") return STRATEGY_XAUUSD;
  if (s === "SOLUSD") return STRATEGY_SOLUSD;
  return STRATEGIES[s] || null;
}

export * from "./types";
export {
  evaluateStrategy,
  runStrategyCycle,
  createEngineState,
  detectBiasH4,
  calcRR,
  normalizeTf,
  closedCandles,
  tfMs,
} from "./engine";
export * from "./detectors";
