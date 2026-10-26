/**
 * Regras de risco partilhadas (Mesa de Operação, journal e API de trades).
 * Funções puras: sem DB nem fetch, para poderem ser testadas e usadas no cliente.
 */
import { canonicalizePair } from "@/lib/pairs";

export type Side = "LONG" | "SHORT";

/** Regras de risco da conta (estilo prop firm). Valores em % do capital. */
export const RISK_RULES = {
  /** Risco normal por trade. */
  riskPct: 0.5,
  /** Acima disto a Mesa não autoriza a entrada. */
  maxRiskPct: 2,
  /** Perda máxima do dia, somando todos os activos. */
  maxDailyLossPct: 1.5,
  /** Perdas seguidas (no mesmo dia) que fecham a sessão. */
  maxConsecutiveLosses: 2,
  /** R:R usado para sugerir o TP. */
  targetRR: 2.5,
  /** Factor aplicado ao risco quando o estado declarado é ansioso. */
  anxietyFactor: 0.5,
} as const;

export interface InstrumentSpec {
  symbol: string;
  broker: string;
  /** Unidades do activo por 1 lote. */
  contractSize: number;
  minLot: number;
  lotStep: number;
  /** Nome da unidade de tamanho mostrada na UI. */
  lotLabel: string;
}

/**
 * Especificações dos instrumentos operados na Mesa.
 * XTB GOLD: 1 lote = 100 oz, mínimo 0,01 (1 oz ≈ 1 USD por cada 1 USD de movimento).
 * Kraken SOL perp: tamanho em SOL. Confirmar o mínimo no ticket da Kraken.
 */
export const INSTRUMENTS: Record<"XAUUSD" | "SOLUSD", InstrumentSpec> = {
  XAUUSD: { symbol: "XAUUSD", broker: "XTB", contractSize: 100, minLot: 0.01, lotStep: 0.01, lotLabel: "lotes" },
  SOLUSD: { symbol: "SOLUSD", broker: "Kraken Perp", contractSize: 1, minLot: 0.01, lotStep: 0.01, lotLabel: "SOL" },
};

/** Intervalos de preço plausíveis — apanham trades gravados no activo errado. */
export const PRICE_RANGES: Record<string, [number, number]> = {
  XAUUSD: [1000, 10000],
  SOLUSD: [1, 2000],
  BTCUSD: [1000, 1000000],
  ETHUSD: [50, 50000],
  XRPUSD: [0.05, 100],
  EURUSD: [0.5, 2],
  GBPUSD: [0.5, 2.5],
  AUDUSD: [0.3, 1.5],
  NZDUSD: [0.3, 1.5],
  EURGBP: [0.5, 1.5],
  USDCHF: [0.5, 2],
  USDCAD: [0.8, 2],
  USDJPY: [50, 300],
  GBPJPY: [80, 400],
  EURJPY: [80, 300],
};

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Erros de coerência entre entrada, SL e TP. Lista vazia = válido. */
export function validateLevels(side: Side, entry: number, sl: number, tp?: number | null): string[] {
  const errors: string[] = [];
  if (!isNum(entry) || entry <= 0) errors.push("Entrada em falta.");
  if (!isNum(sl) || sl <= 0) errors.push("Stop Loss em falta.");
  if (errors.length) return errors;
  if (side === "LONG" && sl >= entry) errors.push("Num LONG o Stop Loss tem de estar abaixo da entrada.");
  if (side === "SHORT" && sl <= entry) errors.push("Num SHORT o Stop Loss tem de estar acima da entrada.");
  if (tp == null || !isNum(tp) || tp <= 0) {
    errors.push("Take Profit em falta.");
  } else {
    if (side === "LONG" && tp <= entry) errors.push("Num LONG o Take Profit tem de estar acima da entrada.");
    if (side === "SHORT" && tp >= entry) errors.push("Num SHORT o Take Profit tem de estar abaixo da entrada.");
  }
  return errors;
}

/** TP à distância de `rr` vezes o risco, do lado certo da entrada. */
export function suggestTakeProfit(side: Side, entry: number, sl: number, rr: number = RISK_RULES.targetRR): number | null {
  if (!isNum(entry) || !isNum(sl) || entry <= 0) return null;
  const dist = Math.abs(entry - sl);
  if (dist <= 0) return null;
  return side === "LONG" ? entry + dist * rr : entry - dist * rr;
}

/** R realizado de uma trade fechada, medido contra o SL inicial. */
export function realizedR(side: Side, entry: number, sl: number, exit: number): number | null {
  if (![entry, sl, exit].every(isNum) || entry <= 0 || exit <= 0) return null;
  const dist = Math.abs(entry - sl);
  if (dist <= 0) return null;
  const move = side === "LONG" ? exit - entry : entry - exit;
  return move / dist;
}

/** Resultado derivado do P&L, para nunca contradizer o dinheiro. */
export function deriveOutcome(pnl: number, beTolerance = 0): "WIN" | "LOSS" | "BE" {
  if (Math.abs(pnl) <= beTolerance) return "BE";
  return pnl > 0 ? "WIN" : "LOSS";
}

export interface PositionSizeInput {
  /** Capital da conta, na moeda da conta. */
  equity: number;
  riskPct: number;
  entry: number;
  sl: number;
  spec: InstrumentSpec;
  /** Quantos USD vale 1 unidade da moeda da conta (1 se a conta for em USD). */
  usdPerAccountUnit?: number;
}

export interface PositionSize {
  /** Lotes arredondados para baixo ao passo do instrumento. */
  lots: number;
  /** Risco permitido, na moeda da conta. */
  riskMoney: number;
  /** Risco efectivo com os lotes arredondados, na moeda da conta. */
  actualRisk: number;
  /** Risco do lote mínimo, na moeda da conta. */
  minLotRisk: number;
  minLotRiskPct: number;
  /** false quando nem o lote mínimo cabe no risco permitido. */
  ok: boolean;
  reason?: string;
}

/** Calculadora de lote: risco fixo em dinheiro a partir da distância ao SL. */
export function positionSize(input: PositionSizeInput): PositionSize | null {
  const { equity, riskPct, entry, sl, spec } = input;
  const fx = isNum(input.usdPerAccountUnit) && input.usdPerAccountUnit > 0 ? input.usdPerAccountUnit : 1;
  if (![equity, riskPct, entry, sl].every(isNum) || equity <= 0 || riskPct <= 0 || entry <= 0) return null;
  const dist = Math.abs(entry - sl);
  if (dist <= 0) return null;

  const riskMoney = (equity * riskPct) / 100;
  // Risco de 1 lote em USD, convertido para a moeda da conta.
  const riskPerLot = (dist * spec.contractSize) / fx;
  const rawLots = riskMoney / riskPerLot;
  const steps = Math.floor(rawLots / spec.lotStep + 1e-9);
  const lots = Number((steps * spec.lotStep).toFixed(6));
  const minLotRisk = riskPerLot * spec.minLot;
  const minLotRiskPct = (minLotRisk / equity) * 100;

  if (lots < spec.minLot) {
    return {
      lots: 0,
      riskMoney,
      actualRisk: 0,
      minLotRisk,
      minLotRiskPct,
      ok: false,
      reason: `O lote mínimo (${spec.minLot} ${spec.lotLabel}) arrisca ${minLotRisk.toFixed(2)} (${minLotRiskPct.toFixed(1)}% da conta), acima dos ${riskPct}% permitidos. Conta pequena demais para este Stop Loss.`,
    };
  }
  return { lots, riskMoney, actualRisk: lots * riskPerLot, minLotRisk, minLotRiskPct, ok: true };
}

export interface DailyGuard {
  dayPnl: number;
  dayLossPct: number;
  consecutiveLosses: number;
  blocked: boolean;
  reason?: string;
}

/**
 * Travão diário da conta, a partir do P&L real (não do risco % declarado).
 * `pnls` = P&L das trades fechadas de hoje, por ordem cronológica.
 */
export function dailyGuard(
  pnls: number[],
  equity: number,
  rules: { maxDailyLossPct: number; maxConsecutiveLosses: number } = RISK_RULES
): DailyGuard {
  const closed = pnls.filter(isNum);
  const dayPnl = closed.reduce((s, p) => s + p, 0);
  const dayLossPct = isNum(equity) && equity > 0 ? (Math.max(0, -dayPnl) / equity) * 100 : 0;
  let consecutiveLosses = 0;
  for (let i = closed.length - 1; i >= 0 && closed[i] < 0; i--) consecutiveLosses++;

  if (dayLossPct >= rules.maxDailyLossPct) {
    return { dayPnl, dayLossPct, consecutiveLosses, blocked: true, reason: `Perda do dia de ${dayLossPct.toFixed(2)}% atingiu o limite de ${rules.maxDailyLossPct}%. Sessão fechada até amanhã.` };
  }
  if (consecutiveLosses >= rules.maxConsecutiveLosses) {
    return { dayPnl, dayLossPct, consecutiveLosses, blocked: true, reason: `${consecutiveLosses} perdas seguidas hoje. Sessão fechada até amanhã.` };
  }
  return { dayPnl, dayLossPct, consecutiveLosses, blocked: false };
}

export interface TradeLike {
  pair?: unknown;
  direction?: unknown;
  entry?: unknown;
  stop_loss?: unknown;
  take_profit?: unknown;
  exit_price?: unknown;
}

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Validação obrigatória de uma trade antes de entrar no journal. */
export function validateTrade(t: TradeLike): string[] {
  const errors: string[] = [];
  const side = String(t.direction || "").toUpperCase();
  if (side !== "LONG" && side !== "SHORT") errors.push("Direcção tem de ser LONG ou SHORT.");
  const entry = toNum(t.entry);
  const sl = toNum(t.stop_loss);
  const tp = toNum(t.take_profit);
  if (side === "LONG" || side === "SHORT") {
    errors.push(...validateLevels(side, entry ?? NaN, sl ?? NaN, tp));
  }

  const pair = canonicalizePair(String(t.pair || ""));
  const range = PRICE_RANGES[pair];
  if (range) {
    const prices: Array<[string, number | null]> = [["Entrada", entry], ["Stop Loss", sl], ["Take Profit", tp], ["Saída", toNum(t.exit_price)]];
    for (const [label, p] of prices) {
      if (p != null && p > 0 && (p < range[0] || p > range[1])) {
        errors.push(`${label} ${p} fora do intervalo plausível de ${pair} (${range[0]}–${range[1]}). Activo errado?`);
      }
    }
  }
  return errors;
}
