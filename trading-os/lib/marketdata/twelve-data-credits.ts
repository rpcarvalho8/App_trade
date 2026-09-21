/**
 * Contador de créditos Twelve Data usados no dia (UTC).
 * Basic free: 8/min · 800/dia — time_series = 1 crédito.
 */
interface DayCounter {
  day: string; // YYYY-MM-DD UTC
  used: number;
  byTf: Record<string, number>;
}

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function counter(): DayCounter {
  const g = globalThis as any;
  if (!g.__tosTdCredits || g.__tosTdCredits.day !== utcDay()) {
    g.__tosTdCredits = { day: utcDay(), used: 0, byTf: {} } as DayCounter;
  }
  return g.__tosTdCredits as DayCounter;
}

export const TD_DAILY_LIMIT = 800;
export const TD_PER_MINUTE_LIMIT = 8;

export function recordTwelveDataCredit(tf = "unknown", n = 1): number {
  const c = counter();
  c.used += n;
  c.byTf[tf] = (c.byTf[tf] || 0) + n;
  const pct = Math.round((c.used / TD_DAILY_LIMIT) * 100);
  const level = c.used >= TD_DAILY_LIMIT ? "CRIT" : c.used >= TD_DAILY_LIMIT * 0.8 ? "WARN" : "ok";
  console.log(
    `[twelve-data] créditos dia ${c.day}: ${c.used}/${TD_DAILY_LIMIT} (${pct}%) [${level}] · +${n} ${tf} · breakdown=${JSON.stringify(c.byTf)}`
  );
  return c.used;
}

export function getTwelveDataCreditStats(): {
  day: string;
  used: number;
  limit: number;
  remaining: number;
  pct: number;
  byTf: Record<string, number>;
} {
  const c = counter();
  return {
    day: c.day,
    used: c.used,
    limit: TD_DAILY_LIMIT,
    remaining: Math.max(0, TD_DAILY_LIMIT - c.used),
    pct: Math.round((c.used / TD_DAILY_LIMIT) * 100),
    byTf: { ...c.byTf },
  };
}

export function wouldExceedDailyLimit(n = 1): boolean {
  return counter().used + n > TD_DAILY_LIMIT;
}
