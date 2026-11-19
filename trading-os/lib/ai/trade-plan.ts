/**
 * Plano de trade proposto pela IA (motor de sinais e análise visual com zoom).
 *
 * A IA PROPÕE, o código DECIDE: nenhum plano chega à Mesa sem passar por
 * `validateTradePlan` (lado do SL, R:R mínimo, distância de stop por activo/horizonte,
 * checklist obrigatória). Funções puras — sem DB nem fetch — para poderem ser testadas.
 */
import { suggestTakeProfit, type Side } from "@/lib/risk";

export type AiAsset = "XAUUSD" | "SOLUSD";
export type Horizon = "day" | "swing";
export type Direction = "long" | "short";

/** Timeframes aceites. Day = M5/M15/H1 (M1/M30 tolerados); Swing = H4/D1/W1. */
export const DAY_TFS = ["M1", "M5", "M15", "M30", "H1"] as const;
export const SWING_TFS = ["H4", "D1", "W1"] as const;

export function normalizeTimeframe(tf: string | null | undefined): string | null {
  if (!tf) return null;
  const s = String(tf).trim().toUpperCase().replace(/\s+/g, "");
  const map: Record<string, string> = {
    "1M": "M1", "5M": "M5", "15M": "M15", "30M": "M30", "1H": "H1", "60": "H1", "60M": "H1",
    "4H": "H4", "240": "H4", "1D": "D1", "D": "D1", "DAILY": "D1", "1W": "W1", "W": "W1", "WEEKLY": "W1",
  };
  const v = map[s] ?? s;
  return [...DAY_TFS, ...SWING_TFS].includes(v as never) ? v : null;
}

/** Horizonte a partir do timeframe de setup. Desconhecido → null (a IA decide e o validador confirma). */
export function horizonForTimeframe(tf: string | null | undefined): Horizon | null {
  const n = normalizeTimeframe(tf);
  if (!n) return null;
  return (SWING_TFS as readonly string[]).includes(n) ? "swing" : "day";
}

/**
 * Limites por activo e horizonte, em % do preço de entrada.
 * - minStopPct: abaixo disto o stop está dentro do ruído (spread + wick médio).
 * - maxStopPct: acima disto o lote mínimo rebenta o risco por trade numa conta prop.
 * - rrMin: R:R mínimo ao TP1 calculado do PIOR extremo da zona de entrada.
 */
export const PLAN_LIMITS: Record<AiAsset, Record<Horizon, { minStopPct: number; maxStopPct: number; rrMin: number }>> = {
  XAUUSD: {
    day: { minStopPct: 0.08, maxStopPct: 0.6, rrMin: 2 },
    swing: { minStopPct: 0.3, maxStopPct: 3, rrMin: 2.5 },
  },
  SOLUSD: {
    day: { minStopPct: 0.35, maxStopPct: 3, rrMin: 2 },
    swing: { minStopPct: 1.5, maxStopPct: 12, rrMin: 2.5 },
  },
};

/** Itens da checklist que têm de estar a `true` para o plano ser executável. */
export const REQUIRED_CHECKLIST = [
  "htf_bias_aligned",
  "liquidity_taken",
  "structure_shift_confirmed",
  "entry_at_poi",
  "sl_beyond_invalidation",
  "rr_ok",
  "no_high_impact_news",
] as const;

export const CHECKLIST_LABELS: Record<string, string> = {
  htf_bias_aligned: "Bias do timeframe superior alinhado",
  liquidity_taken: "Liquidez capturada (sweep de BSL/SSL, Spring/UTAD)",
  structure_shift_confirmed: "Mudança de estrutura confirmada (CHoCH/MSS/BOS com corpo)",
  entry_at_poi: "Entrada num POI válido (OB/FVG/zona de oferta-procura, desconto/prémio)",
  sl_beyond_invalidation: "SL técnico além do ponto de invalidação estrutural",
  rr_ok: "R:R mínimo cumprido do pior preço da zona",
  no_high_impact_news: "Sem notícia de alto impacto na janela da trade",
};

export interface PlanTarget {
  price: number;
  label?: string;
}

export interface TradePlan {
  asset: AiAsset;
  direction: Direction;
  horizon: Horizon;
  setupTimeframe?: string | null;
  entryZone: { low: number; high: number };
  stopLoss: number;
  stopLogic?: string;
  targets: PlanTarget[];
  confluences: string[];
  checklist: Record<string, boolean>;
  invalidation?: string;
  confidence?: number;
}

export type PlanStatus = "valid" | "watch" | "rejected";

export interface PlanValidation {
  status: PlanStatus;
  errors: string[];
  warnings: string[];
  /** Entrada de referência = meio da zona. */
  entryMid: number;
  /** Pior entrada possível dentro da zona (topo num long, fundo num short). */
  entryWorst: number;
  stopPct: number;
  /** R:R ao TP1 a partir do pior extremo da zona (é este que decide). */
  rrWorst: number | null;
  rrMid: number | null;
  /** R:R de cada alvo, calculado do meio da zona. */
  targetsRR: { price: number; label?: string; rr: number }[];
  /** true quando o TP foi gerado pelo código porque a IA não deu nenhum válido. */
  autoTarget: boolean;
  missingChecklist: string[];
  limits: { minStopPct: number; maxStopPct: number; rrMin: number };
}

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const r2 = (n: number) => Math.round(n * 100) / 100;

function rr(direction: Direction, entry: number, sl: number, tp: number): number {
  const risk = Math.abs(entry - sl);
  if (risk <= 0) return 0;
  const reward = direction === "long" ? tp - entry : entry - tp;
  return reward / risk;
}

/**
 * Gate matemático do plano.
 * - rejected: erro estrutural (SL do lado errado, stop fora dos limites, R:R abaixo do mínimo).
 * - watch: plano coerente mas a checklist ainda não fechou (esperar gatilho).
 * - valid: executável.
 */
export function validateTradePlan(plan: TradePlan): PlanValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const limits = PLAN_LIMITS[plan.asset]?.[plan.horizon] ?? PLAN_LIMITS.XAUUSD.day;
  const side: Side = plan.direction === "long" ? "LONG" : "SHORT";

  let low = Number(plan.entryZone?.low);
  let high = Number(plan.entryZone?.high);
  if (isNum(low) && isNum(high) && low > high) [low, high] = [high, low];
  if (!isNum(low) || !isNum(high) || low <= 0) errors.push("Zona de entrada em falta ou inválida.");
  const sl = Number(plan.stopLoss);

  const entryMid = isNum(low) && isNum(high) ? (low + high) / 2 : NaN;
  const entryWorst = plan.direction === "long" ? high : low;
  // O SL tem de ficar fora da zona inteira: valida-se contra o extremo MAIS PRÓXIMO do SL.
  const entryNearSl = plan.direction === "long" ? low : high;

  if (!isNum(sl) || sl <= 0) errors.push("Stop Loss em falta.");
  else if (isNum(entryNearSl)) {
    // Mesma regra da Mesa (validateLevels), aplicada ao extremo da zona mais próximo do SL.
    if (plan.direction === "long" && sl >= entryNearSl) errors.push("Num LONG o Stop Loss tem de estar abaixo de toda a zona de entrada.");
    if (plan.direction === "short" && sl <= entryNearSl) errors.push("Num SHORT o Stop Loss tem de estar acima de toda a zona de entrada.");
  }

  const stopPct = isNum(entryMid) && isNum(sl) && entryMid > 0 ? (Math.abs(entryMid - sl) / entryMid) * 100 : NaN;
  if (isNum(stopPct) && !errors.length) {
    if (stopPct < limits.minStopPct)
      errors.push(`Stop a ${stopPct.toFixed(2)}% do preço: abaixo do mínimo de ${limits.minStopPct}% para ${plan.asset} ${plan.horizon}. É ruído, não invalidação.`);
    if (stopPct > limits.maxStopPct)
      errors.push(`Stop a ${stopPct.toFixed(2)}% do preço: acima do máximo de ${limits.maxStopPct}% para ${plan.asset} ${plan.horizon}. Reduz o horizonte ou espera um POI mais preciso.`);
  }

  // Alvos: só os que estão do lado certo, ordenados do mais próximo para o mais longe.
  let autoTarget = false;
  let targets = (plan.targets || []).filter((t) => isNum(Number(t?.price)) && Number(t.price) > 0);
  const wrongSide = targets.filter((t) => (plan.direction === "long" ? t.price <= high : t.price >= low));
  if (wrongSide.length) warnings.push(`${wrongSide.length} alvo(s) do lado errado da zona foram descartados.`);
  targets = targets
    .filter((t) => !wrongSide.includes(t))
    .sort((a, b) => (plan.direction === "long" ? a.price - b.price : b.price - a.price));

  if (!targets.length && isNum(entryMid) && isNum(sl) && !errors.length) {
    const tp = suggestTakeProfit(side, entryWorst, sl, limits.rrMin);
    if (tp != null) {
      targets = [{ price: tp, label: `TP automático ${limits.rrMin}R` }];
      autoTarget = true;
      warnings.push(`Sem alvo técnico válido: TP gerado a ${limits.rrMin}R do pior preço da zona. Confirma que não há liquidez oposta antes.`);
    }
  }
  if (!targets.length && !errors.length) errors.push("Take Profit em falta.");

  const targetsRR = isNum(entryMid) && isNum(sl)
    ? targets.map((t) => ({ price: t.price, label: t.label, rr: r2(rr(plan.direction, entryMid, sl, t.price)) }))
    : [];
  const tp1 = targets[0]?.price;
  const rrWorst = isNum(tp1) && isNum(entryWorst) && isNum(sl) ? r2(rr(plan.direction, entryWorst, sl, tp1)) : null;
  const rrMid = isNum(tp1) && isNum(entryMid) && isNum(sl) ? r2(rr(plan.direction, entryMid, sl, tp1)) : null;
  if (rrWorst != null && !errors.length && rrWorst < limits.rrMin) {
    errors.push(`R:R ao TP1 de ${rrWorst} a partir do pior preço da zona (mínimo ${limits.rrMin}). Aperta a zona ou não entres.`);
  }

  const zoneWidthPct = isNum(entryMid) && entryMid > 0 ? ((high - low) / entryMid) * 100 : 0;
  if (isNum(stopPct) && stopPct > 0 && zoneWidthPct > stopPct * 0.6) {
    warnings.push("Zona de entrada larga face ao stop: usa ordem limite no meio da zona ou divide a entrada.");
  }

  const checklist = plan.checklist || {};
  const missingChecklist = REQUIRED_CHECKLIST.filter((k) => checklist[k] !== true);
  if (!plan.confluences?.length) warnings.push("Nenhuma confluência listada.");
  else if (plan.confluences.length < 2) warnings.push("Só 1 confluência: o mínimo profissional são 2 independentes (estrutura + liquidez/POI).");

  const status: PlanStatus = errors.length ? "rejected" : missingChecklist.length ? "watch" : "valid";
  return {
    status,
    errors,
    warnings,
    entryMid: isNum(entryMid) ? entryMid : 0,
    entryWorst: isNum(entryWorst) ? entryWorst : 0,
    stopPct: isNum(stopPct) ? r2(stopPct) : 0,
    rrWorst,
    rrMid,
    targetsRR,
    autoTarget,
    missingChecklist,
    limits,
  };
}
