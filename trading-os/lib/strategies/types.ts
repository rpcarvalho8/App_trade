/** Tipos partilhados do motor de sinais (StrategyDefinition + candles). */

export type BiasDirection = "bullish" | "bearish" | "neutral";

export type TimeframeKey =
  | "H4"
  | "H1"
  | "M15"
  | "M5"
  | "M1"
  | "15m"
  | "1m"
  | string;

export interface Candle {
  /** Epoch ms do open da vela. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DetectionResult<T = Record<string, unknown>> {
  detected: boolean;
  details: T;
}

export type SequenceStepType =
  | "calendar_clean"
  | "bias_h4"
  | "liquidity_sweep"
  | "mss_cisd"
  | "ob_or_fvg"
  | "choch_volume"
  | "fvg_golden_ratio"
  | string;

export interface SequenceStep {
  step: number;
  type: SequenceStepType;
  params: Record<string, unknown>;
}

export interface StrategySession {
  allowed?: string[];
  preferred?: string[];
  avoidIf?: string;
  newsBlackoutMinutes?: number;
  newsImpact?: string[];
  maxCandlesAfterSweep?: number;
  maxCandlesAfterStep1ForChoCH?: number;
}

export interface StrategyTimeframes {
  bias: TimeframeKey;
  trigger?: TimeframeKey;
  entry: TimeframeKey;
}

export interface PartialAt1R {
  closePct: number;
  moveSlToBE: boolean;
}

export interface SlAggressive {
  condition: string;
  offset: string;
}

export interface StrategyRisk {
  normalPct: number;
  reducedPct: number;
  reduceIfMentalScoreBelow?: number;
  slLogic?: string;
  tpLogic?: string;
  rrMin: number;
  partialAt1R?: PartialAt1R;
  slAggressive?: SlAggressive;
  slConservative?: string;
}

export interface KillBlockIf {
  mentalNote?: string;
  sleepHours?: number;
  stressAbove?: number;
}

export interface StrategyKill {
  consecutiveLosses: number;
  pauseMinutes: number;
  maxTradesPerDay: number;
  maxDailyDrawdownPct: number;
  blockIf: KillBlockIf;
}

export interface StrategyDefinition {
  id: string;
  symbol: string;
  name: string;
  category: string;
  timeframes: StrategyTimeframes;
  session: StrategySession;
  sequence: SequenceStep[];
  confluences: string[];
  invalidation: string[];
  risk: StrategyRisk;
  kill: StrategyKill;
}

export interface StrategiesFile {
  strategies: StrategyDefinition[];
}

/** Resultado de um passo confirmado na sequência. */
export interface ConfirmedStep {
  step: number;
  type: SequenceStepType;
  confluenceKeys: string[];
  details: Record<string, unknown>;
  confirmedAt: number;
  candleIndex?: number;
}

export type SignalDirection = "long" | "short";

export interface EngineSignal {
  strategyId: string;
  symbol: string;
  direction: SignalDirection;
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  rr: number;
  rrMin: number;
  confirmedSteps: ConfirmedStep[];
  confluencesValidated: string[];
  emittedAt: number;
  /** Payload de auditoria — qual passo validou cada confluência. */
  audit: Record<string, { step: number; type: string; details: Record<string, unknown> }>;
}

export interface EngineContext {
  now?: number;
  /** Bias HTF já conhecido (ex.: do detector bias_h4). */
  bias?: BiasDirection;
  /** Calendário limpo? (passo calendar_clean). */
  calendarClean?: boolean;
  /** Sessão válida (London / NY / …). */
  sessionOk?: boolean;
  /** Spread atual (para gate SOL). */
  spread?: number;
  /** Preço de referência para R:R / entrada. */
  price?: number;
  /** Nível de TP sugerido (liquidez oposta). */
  takeProfitLevel?: number;
  /** Nível de SL sugerido. */
  stopLossLevel?: number;
  /** Candles por timeframe (chave normalizada: H4, M15, M5, 15m, 1m). */
  candlesByTf: Record<string, Candle[]>;
}

export interface EngineState {
  strategyId: string;
  currentStepIndex: number;
  confirmed: ConfirmedStep[];
  /** Índice da vela (no TF de entry/trigger) quando o passo 1 (sweep) confirmou. */
  sweepCandleIndex?: number;
  sweepConfirmedAt?: number;
  bias?: BiasDirection;
  sweepDirection?: BiasDirection;
  lastInvalidation?: string;
  lastSignalAt?: number;
}

export interface EngineEvaluation {
  state: EngineState;
  signal: EngineSignal | null;
  progressed: boolean;
  invalidated: boolean;
  reason?: string;
}
