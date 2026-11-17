/**
 * Sinal do motor → linha "Pendente de Validação" no journal, e contra-triggers.
 * Funções puras (sem DB): testadas em lib/__tests__/signal-journal.test.ts.
 */
import { INSTRUMENTS, RISK_RULES, positionSize, validateLevels, type Side } from "@/lib/risk";
import { tfMs } from "@/lib/strategies/engine";
import type { EngineSignal, StrategyDefinition } from "@/lib/strategies/types";

/** Nome do setup no catálogo (/setups) para cada estratégia do motor. */
export const STRATEGY_SETUP_NAME: Record<string, string> = {
  "xauusd-london-structure": "XAUUSD — London Structure",
  "solusd-smc-3step": "SMC 3-Step Scalping",
  "xauusd-htf-rotation": "HTF Imbalance Rotation",
  "solusd-htf-rotation": "HTF Imbalance Rotation",
};

/** Velas do TF de entrada durante as quais o sinal continua válido. */
export const SIGNAL_VALIDITY_CANDLES = 3;

export interface AccountForSizing {
  /** Capital na moeda da conta; 0/null = desconhecido. */
  equity: number | null;
  /** USD por 1 unidade da moeda da conta (1 se a conta for em USD). */
  usdPerAccountUnit?: number | null;
  riskPct?: number;
}

export interface PendingTrade {
  date: string;
  pair: string;
  direction: Side;
  setup: string;
  session: string;
  entry: number;
  stop_loss: number;
  take_profit: number;
  tp1: number;
  rr_planned: number;
  risk_percent: number;
  outcome: "PENDING";
  signal_status: "pending";
  lot_suggested: number | null;
  max_stop: number | null;
  executable: number | null;
  expires_at: string;
  invalidation_price: number;
  confluences: string;
  entry_reason: string;
  notes: string;
  tags: string;
}

const round = (n: number, d: number) => Number(n.toFixed(d));

/** Sessão a partir da hora UTC (aprox., sem horário de verão). */
export function sessionForUtcHour(h: number): string {
  if (h >= 7 && h < 12) return "London";
  if (h >= 12 && h < 16) return "London+NY";
  if (h >= 16 && h < 21) return "NY";
  return "Asia";
}

/** Data local (Lisboa) do sinal, AAAA-MM-DD. */
export function lisbonDate(ts: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(ts)
  );
}

/**
 * Distância máxima do SL (em preço) que o lote mínimo permite com o risco dado.
 * Ex.: 142 € a 0,5% = 0,71 €; ouro 0,01 lote = 1 oz → stop máx. ≈ 0,8 pts.
 */
export function maxStopDistance(symbol: string, acct: AccountForSizing): number | null {
  const spec = INSTRUMENTS[symbol as keyof typeof INSTRUMENTS];
  const equity = Number(acct.equity);
  if (!spec || !Number.isFinite(equity) || equity <= 0) return null;
  const fx = Number(acct.usdPerAccountUnit) > 0 ? Number(acct.usdPerAccountUnit) : 1;
  const riskPct = acct.riskPct ?? RISK_RULES.riskPct;
  const riskMoneyUsd = ((equity * riskPct) / 100) * fx;
  return riskMoneyUsd / (spec.minLot * spec.contractSize);
}

/** Constrói a linha pendente. Devolve null se o sinal não tiver níveis válidos. */
export function buildPendingTrade(
  signal: EngineSignal,
  strategy: Pick<StrategyDefinition, "id" | "name" | "timeframes" | "sequence">,
  signalId: number,
  acct: AccountForSizing
): PendingTrade | null {
  const side: Side = signal.direction === "long" ? "LONG" : "SHORT";
  const entry = Number(signal.entry);
  const sl = Number(signal.stopLoss);
  const tp = Number(signal.takeProfit);
  if (validateLevels(side, entry, sl, tp).length) return null;

  const d = signal.symbol === "XAUUSD" ? 2 : 4;
  const dist = Math.abs(entry - sl);
  const tp1 = side === "LONG" ? entry + dist : entry - dist;
  const riskPct = acct.riskPct ?? RISK_RULES.riskPct;
  const spec = INSTRUMENTS[signal.symbol as keyof typeof INSTRUMENTS];

  const equity = Number(acct.equity);
  const size =
    spec && Number.isFinite(equity) && equity > 0
      ? positionSize({ equity, riskPct, entry, sl, spec, usdPerAccountUnit: acct.usdPerAccountUnit ?? 1 })
      : null;
  const maxStop = maxStopDistance(signal.symbol, { ...acct, riskPct });
  const executable = size == null ? null : size.ok ? 1 : 0;

  const steps = signal.confirmedSteps.map((s) => `${s.step}:${s.type}`).join(" → ");
  const setupName = STRATEGY_SETUP_NAME[strategy.id] || strategy.name;
  const expiresAt = new Date(signal.emittedAt + SIGNAL_VALIDITY_CANDLES * tfMs(strategy.timeframes.entry)).toISOString();

  const notes: string[] = [
    `[AUTO] Sinal #${signalId} do motor (${strategy.id}). Valida os números antes de pôr a ordem.`,
    `TP1 ${tp1.toFixed(d)} (1R: fecha 50% e SL para BE) · TP2 ${tp.toFixed(d)} (${signal.rr.toFixed(2)}R).`,
  ];
  if (size == null) notes.push("Capital desconhecido: define o capital na Mesa para o lote ser calculado.");
  else if (!size.ok) notes.push(`NÃO EXECUTÁVEL: ${size.reason} Stop máximo permitido: ${maxStop?.toFixed(d)}.`);
  else notes.push(`Lote sugerido ${size.lots} ${spec?.lotLabel} (risco ${size.actualRisk.toFixed(2)}).`);

  return {
    date: lisbonDate(signal.emittedAt),
    pair: signal.symbol,
    direction: side,
    setup: setupName,
    session: sessionForUtcHour(new Date(signal.emittedAt).getUTCHours()),
    entry: round(entry, d),
    stop_loss: round(sl, d),
    take_profit: round(tp, d),
    tp1: round(tp1, d),
    rr_planned: round(signal.rr, 2),
    risk_percent: riskPct,
    outcome: "PENDING",
    signal_status: "pending",
    lot_suggested: size?.ok ? size.lots : size ? 0 : null,
    max_stop: maxStop == null ? null : round(maxStop, d),
    executable,
    expires_at: expiresAt,
    invalidation_price: round(sl, d),
    confluences: signal.confluencesValidated.join(", "),
    entry_reason: `${strategy.name}: ${steps}`,
    notes: notes.join("\n"),
    tags: `auto,signal:${signalId},strategy:${strategy.id}`,
  };
}

export type ContraTrigger = { type: "invalidated" | "expired" | "reversal"; reason: string };

export interface ActiveSignal {
  id: number;
  symbol: string;
  direction: "long" | "short";
  invalidationPrice: number;
  expiresAt: number;
}

/**
 * Contra-trigger de um sinal ainda por executar: o preço passou o nível de invalidação (o SL,
 * antes de a ordem estar posta) ou a validade acabou. Devolve null enquanto o sinal está vivo.
 */
export function checkContraTrigger(sig: ActiveSignal, price: number, now: number): ContraTrigger | null {
  if (Number.isFinite(price) && Number.isFinite(sig.invalidationPrice)) {
    if (sig.direction === "long" && price <= sig.invalidationPrice)
      return { type: "invalidated", reason: `preço ${price} abaixo da invalidação ${sig.invalidationPrice}` };
    if (sig.direction === "short" && price >= sig.invalidationPrice)
      return { type: "invalidated", reason: `preço ${price} acima da invalidação ${sig.invalidationPrice}` };
  }
  if (now > sig.expiresAt) return { type: "expired", reason: `${SIGNAL_VALIDITY_CANDLES} velas sem execução` };
  return null;
}
