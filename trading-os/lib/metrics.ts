/**
 * Métricas de performance (funções puras, testáveis).
 *
 * Definições usadas:
 *   - Profit Factor  = soma dos ganhos / |soma das perdas|
 *   - Payoff         = ganho médio / |perda média|  (NÃO é o Profit Factor)
 *   - Expectância R  = média do R realizado por trade fechada
 *   - Drawdown máx.  = maior queda desde um pico, medida sobre o CAPITAL (não sobre o P&L acumulado)
 */

export interface ClosedTrade {
  pnl: number | null;
  outcome?: string | null;
  rr_real?: number | null;
  date?: string | null;
}

export interface PerformanceMetrics {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  payoff: number | null;
  expectancyR: number | null;
  expectancyMoney: number | null;
  maxLosingStreak: number;
  /** n < 30: os números ainda não são estatisticamente fiáveis. */
  smallSample: boolean;
}

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Só trades fechadas contam (exclui RUNNING e PENDING). */
export function isClosedOutcome(outcome: unknown): boolean {
  return outcome === "WIN" || outcome === "LOSS" || outcome === "BE";
}

export function computeMetrics(rows: ClosedTrade[]): PerformanceMetrics {
  const closed = rows.filter((t) => isClosedOutcome(t.outcome) && isNum(Number(t.pnl)) && t.pnl != null);
  const pnls = closed.map((t) => Number(t.pnl));
  const winsArr = pnls.filter((p) => p > 0);
  const lossArr = pnls.filter((p) => p < 0);
  const grossProfit = winsArr.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(lossArr.reduce((a, b) => a + b, 0));
  const avgWin = winsArr.length ? grossProfit / winsArr.length : null;
  const avgLoss = lossArr.length ? grossLoss / lossArr.length : null;
  const decided = winsArr.length + lossArr.length;

  // rr_real é guardado com sinal (realizedR); trades antigas podem ter só o valor absoluto.
  const signedR = closed
    .map((t) => {
      const r = Number(t.rr_real);
      if (!isNum(r) || t.rr_real == null) return null;
      const p = Number(t.pnl);
      return p < 0 && r > 0 ? -r : r;
    })
    .filter((r): r is number => r != null);

  let streak = 0;
  let maxStreak = 0;
  for (const p of pnls) {
    if (p < 0) {
      streak++;
      maxStreak = Math.max(maxStreak, streak);
    } else if (p > 0) streak = 0;
  }

  return {
    trades: closed.length,
    wins: winsArr.length,
    losses: lossArr.length,
    winRate: decided ? (winsArr.length / decided) * 100 : null,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null,
    avgWin,
    avgLoss,
    payoff: avgWin != null && avgLoss != null && avgLoss > 0 ? avgWin / avgLoss : null,
    expectancyR: signedR.length ? signedR.reduce((a, b) => a + b, 0) / signedR.length : null,
    expectancyMoney: closed.length ? pnls.reduce((a, b) => a + b, 0) / closed.length : null,
    maxLosingStreak: maxStreak,
    smallSample: closed.length < 30,
  };
}

export interface EquityPoint {
  label: string;
  pnl: number;
  equity: number;
  /** Drawdown em % do pico de capital (≤ 0). */
  ddPct: number;
}

export interface EquityCurve {
  points: EquityPoint[];
  startEquity: number;
  maxDrawdownPct: number;
  maxDrawdownMoney: number;
}

/**
 * Curva de capital e drawdown máximo.
 * `startEquity` = capital antes da primeira trade da série. Sem capital conhecido o DD em % não tem
 * significado; nesse caso passar 0 e usar só `maxDrawdownMoney`.
 */
export function equityCurve(series: Array<{ label: string; pnl: number }>, startEquity: number): EquityCurve {
  let equity = isNum(startEquity) && startEquity > 0 ? startEquity : 0;
  const start = equity;
  let peak = equity;
  let maxDdPct = 0;
  let maxDdMoney = 0;
  const points: EquityPoint[] = [];
  for (const s of series) {
    const pnl = isNum(Number(s.pnl)) ? Number(s.pnl) : 0;
    equity += pnl;
    peak = Math.max(peak, equity);
    const ddMoney = peak - equity;
    const ddPct = peak > 0 ? (ddMoney / peak) * 100 : 0;
    maxDdMoney = Math.max(maxDdMoney, ddMoney);
    maxDdPct = Math.max(maxDdPct, ddPct);
    points.push({ label: s.label, pnl, equity: Number(equity.toFixed(2)), ddPct: -Number(ddPct.toFixed(2)) });
  }
  return { points, startEquity: start, maxDrawdownPct: start > 0 ? maxDdPct : 0, maxDrawdownMoney: maxDdMoney };
}

/** Filtro SQL para trades fechadas (exclui RUNNING e sinais PENDING). */
export const CLOSED_SQL = "outcome IN ('WIN','LOSS','BE')";
