/**
 * Regras de prop firm por conta (funções puras, cliente e servidor).
 *
 * Modelo FundingPips (Two Step):
 *  - Perda diária: % do equity no início do dia (reposta à hora de reset do servidor).
 *    Limite diário = equity início do dia × %; saldo mínimo do dia = início − limite.
 *  - Perda total: % do tamanho da conta. Estática: mínimo fixo = tamanho × (1 − %).
 *    Trailing: o mínimo sobe com o maior capital registado (até ao tamanho inicial ser ultrapassado).
 *  - Profit target: % do tamanho da conta.
 */

export type MaxDdType = "static" | "trailing";

export interface PropRules {
  /** Tamanho inicial da conta (ex.: 5000). */
  start_balance: number | null;
  /** Perda diária máxima, % do equity no início do dia. */
  daily_dd_pct: number | null;
  /** Perda total máxima, % do tamanho da conta. */
  max_dd_pct: number | null;
  max_dd_type: MaxDdType;
  /** Profit target, % do tamanho da conta (null = sem objectivo, ex.: conta financiada). */
  profit_target_pct: number | null;
  /** Equity no início do dia (como o dashboard da prop firm mostra). */
  day_start_equity: number | null;
  /** Dia de trading (AAAA-MM-DD) a que day_start_equity se refere. */
  day_start_date: string | null;
  /** Hora UTC a que o dia da prop firm muda (FundingPips: 22h UTC = meia-noite do servidor). */
  reset_hour_utc: number;
  /** Etiqueta livre, ex.: "Fase 1". */
  phase: string | null;
}

export interface PropAccountLike extends Partial<PropRules> {
  name: string;
  kind: string;
  equity: number;
  peak_equity: number;
}

/** Regras FundingPips 5k Two Step, Fase 1 (as do Rui). */
export const FUNDINGPIPS_DEFAULT: Omit<PropRules, "day_start_equity" | "day_start_date"> = {
  start_balance: 5000,
  daily_dd_pct: 5,
  max_dd_pct: 10,
  max_dd_type: "static",
  profit_target_pct: 8,
  reset_hour_utc: 22,
  phase: "Fase 1",
};

const isPos = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Dia de trading da prop firm para o instante dado (muda à hora de reset, em UTC). */
export function propDay(ts: number, resetHourUtc = 22): string {
  const h = Number.isFinite(resetHourUtc) ? resetHourUtc : 0;
  return new Date(ts + ((24 - h) % 24) * 3_600_000).toISOString().slice(0, 10);
}

export function hasPropRules(a: Partial<PropRules> & { kind?: string }): boolean {
  return a.kind === "prop" && isPos(a.start_balance) && (isPos(a.daily_dd_pct) || isPos(a.max_dd_pct));
}

/** Equity no início do dia de hoje: o valor registado se for de hoje, senão o equity actual (dia novo). */
export function dayStartFor(a: Pick<PropAccountLike, "equity" | "day_start_equity" | "day_start_date" | "reset_hour_utc">, now: number): number {
  if (a.day_start_date === propDay(now, a.reset_hour_utc) && isPos(a.day_start_equity)) return a.day_start_equity;
  return a.equity;
}

/**
 * Ao gravar um novo equity: se o dia mudou desde o último registo, o início do dia passa a ser
 * o equity anterior (o que estava na conta quando o dia começou).
 */
export function rollDayStart(
  prev: { equity: number; day_start_equity?: number | null; day_start_date?: string | null; reset_hour_utc?: number },
  now: number
): { day_start_equity: number; day_start_date: string } {
  const today = propDay(now, prev.reset_hour_utc);
  if (prev.day_start_date === today && isPos(prev.day_start_equity)) {
    return { day_start_equity: prev.day_start_equity, day_start_date: today };
  }
  return { day_start_equity: prev.equity, day_start_date: today };
}

export interface PropStatus {
  account: string;
  phase: string | null;
  equity: number;
  dayStart: number;
  /** Perda diária máxima em dinheiro e saldo mínimo de hoje. */
  dailyLimit: number | null;
  dailyFloor: number | null;
  dailyLoss: number;
  dailyRemaining: number | null;
  /** Perda total máxima e saldo mínimo da conta. */
  totalLimit: number | null;
  totalFloor: number | null;
  totalRemaining: number | null;
  /** Profit target. */
  target: number | null;
  profit: number;
  progressPct: number | null;
  passed: boolean;
  /** Quanto ainda podes perder antes de violar uma regra (o menor dos dois). */
  maxRiskMoney: number | null;
  breached: boolean;
  reason?: string;
}

export function propStatus(a: PropAccountLike, now: number): PropStatus | null {
  if (!hasPropRules(a)) return null;
  const start = a.start_balance as number;
  const equity = Number(a.equity) || 0;
  const dayStart = dayStartFor(a, now);

  let dailyLimit: number | null = null;
  let dailyFloor: number | null = null;
  let dailyRemaining: number | null = null;
  if (isPos(a.daily_dd_pct) && dayStart > 0) {
    dailyLimit = r2((dayStart * a.daily_dd_pct) / 100);
    dailyFloor = r2(dayStart - dailyLimit);
    dailyRemaining = r2(equity - dailyFloor);
  }

  let totalLimit: number | null = null;
  let totalFloor: number | null = null;
  let totalRemaining: number | null = null;
  if (isPos(a.max_dd_pct)) {
    totalLimit = r2((start * a.max_dd_pct) / 100);
    const base = a.max_dd_type === "trailing" ? Math.max(start, Number(a.peak_equity) || 0) : start;
    // Trailing: o mínimo sobe com o pico, mas nunca acima do tamanho inicial.
    totalFloor = r2(a.max_dd_type === "trailing" ? Math.min(start, base - totalLimit) : start - totalLimit);
    totalRemaining = r2(equity - totalFloor);
  }

  const target = isPos(a.profit_target_pct) ? r2((start * a.profit_target_pct) / 100) : null;
  const profit = r2(equity - start);
  const progressPct = target ? (profit / target) * 100 : null;
  const passed = target != null && profit >= target;

  const rems = [dailyRemaining, totalRemaining].filter((x): x is number => x != null);
  const maxRiskMoney = rems.length ? Math.max(0, Math.min(...rems)) : null;

  let breached = false;
  let reason: string | undefined;
  if (totalRemaining != null && totalRemaining <= 0) {
    breached = true;
    reason = `${a.name}: perda total máxima atingida (saldo mínimo ${totalFloor}). Conta violada.`;
  } else if (dailyRemaining != null && dailyRemaining <= 0) {
    breached = true;
    reason = `${a.name}: perda diária máxima atingida (saldo mínimo de hoje ${dailyFloor}). Pára até ao reset.`;
  } else if (passed) {
    reason = `${a.name}: profit target atingido (${profit} de ${target}). Não arrisques mais nesta fase.`;
  }

  return {
    account: a.name,
    phase: a.phase ?? null,
    equity,
    dayStart,
    dailyLimit,
    dailyFloor,
    dailyLoss: r2(Math.max(0, dayStart - equity)),
    dailyRemaining,
    totalLimit,
    totalFloor,
    totalRemaining,
    target,
    profit,
    progressPct,
    passed,
    maxRiskMoney,
    breached,
    reason,
  };
}

/**
 * Trava a trade se o risco até ao stop ultrapassar o que sobra até ao limite diário ou total.
 * Devolve a razão do bloqueio, ou null se pode avançar.
 */
export function propRiskBlock(s: PropStatus | null, riskMoney: number | null | undefined): string | null {
  if (!s) return null;
  if (s.breached) return s.reason || "Limite da prop firm atingido.";
  if (s.passed) return s.reason || "Profit target atingido.";
  const risk = Number(riskMoney);
  if (!Number.isFinite(risk) || risk <= 0 || s.maxRiskMoney == null) return null;
  if (risk > s.maxRiskMoney) {
    const which = s.dailyRemaining != null && s.dailyRemaining === Math.min(s.dailyRemaining, s.totalRemaining ?? Infinity) ? "diário" : "total";
    return `O stop arrisca ${risk.toFixed(2)}, mas só faltam ${s.maxRiskMoney.toFixed(2)} até ao limite ${which} da ${s.account}. Reduz o lote ou aperta o stop.`;
  }
  return null;
}
