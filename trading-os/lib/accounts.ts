/**
 * Contas por corretora e custos por trade (funções puras, usáveis no cliente e no servidor).
 */

export type Broker = "XTB" | "Kraken";
export type AccountCurrency = "EUR" | "USD";

export interface Account {
  broker: Broker;
  currency: AccountCurrency;
  /** Capital actual, na moeda da conta. */
  equity: number;
  /** Maior capital já registado (base do drawdown total da Fase 3). */
  peak_equity: number;
  updated_at?: string;
}

/** Corretora onde cada activo é operado. */
export const BROKER_FOR_SYMBOL: Record<string, Broker> = {
  XAUUSD: "XTB",
  SOLUSD: "Kraken",
};

export const DEFAULT_ACCOUNTS: Array<Pick<Account, "broker" | "currency">> = [
  { broker: "XTB", currency: "EUR" },
  { broker: "Kraken", currency: "USD" },
];

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function brokerForSymbol(symbol: string): Broker | null {
  return BROKER_FOR_SYMBOL[String(symbol || "").toUpperCase()] ?? null;
}

/** USD por 1 unidade da moeda da conta (o que o positionSize espera). */
export function usdPerAccountUnit(currency: AccountCurrency | string | null | undefined, eurusd: number | null): number {
  if (currency === "EUR") return isNum(eurusd) && eurusd > 0 ? eurusd : 1;
  return 1;
}

/** Novo pico: nunca desce. */
export function nextPeak(prevPeak: number | null | undefined, equity: number): number {
  const p = isNum(Number(prevPeak)) ? Number(prevPeak) : 0;
  return Math.max(p, isNum(equity) ? equity : 0);
}

/** Converte um valor da moeda da conta para EUR (moeda de referência da barra de risco). */
export function toEur(value: number, currency: AccountCurrency | string, eurusd: number | null): number {
  if (currency === "USD" && isNum(eurusd) && eurusd > 0) return value / eurusd;
  return value;
}

export interface CostFields {
  pnl?: unknown;
  commission?: unknown;
  swap_funding?: unknown;
  spread_pts?: unknown;
  entry?: unknown;
  stop_loss?: unknown;
  rr_real?: unknown;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return v == null || v === "" || !Number.isFinite(n) ? 0 : n;
};

/** Custos pagos na trade (comissão + swap/funding; positivo = pagaste, negativo = recebeste). */
export function tradeFees(t: CostFields): number {
  return num(t.commission) + num(t.swap_funding);
}

/** P&L líquido = P&L − comissão − swap/funding. O spread já está nos preços de execução. */
export function netPnl(t: CostFields): number {
  return num(t.pnl) - tradeFees(t);
}

/**
 * Custo da trade em R (fracção do risco inicial):
 *   spread em preço / distância do SL  +  taxas / risco em dinheiro (estimado por |P&L| / |R realizado|).
 * Devolve null quando não há dados para estimar.
 */
export function costInR(t: CostFields): number | null {
  const dist = Math.abs(num(t.entry) - num(t.stop_loss));
  const spread = num(t.spread_pts);
  const fees = tradeFees(t);
  let total = 0;
  let known = false;
  if (spread > 0 && dist > 0) {
    total += spread / dist;
    known = true;
  }
  if (fees !== 0) {
    const r = Math.abs(num(t.rr_real));
    const p = Math.abs(num(t.pnl));
    if (r > 0 && p > 0) {
      total += fees / (p / r);
      known = true;
    }
  }
  return known ? total : null;
}

export interface BrokerCostSummary {
  broker: string;
  trades: number;
  fees: number;
  avgCostR: number | null;
  netPnl: number;
  grossPnl: number;
}

/** Custos agregados por corretora (a partir do par da trade). */
export function costsByBroker(rows: Array<CostFields & { pair?: unknown }>): BrokerCostSummary[] {
  const map = new Map<string, { trades: number; fees: number; rSum: number; rN: number; net: number; gross: number }>();
  for (const t of rows) {
    const broker = brokerForSymbol(String(t.pair ?? "")) ?? "Outra";
    const cur = map.get(broker) ?? { trades: 0, fees: 0, rSum: 0, rN: 0, net: 0, gross: 0 };
    cur.trades++;
    cur.fees += tradeFees(t);
    cur.gross += num(t.pnl);
    cur.net += netPnl(t);
    const c = costInR(t);
    if (c != null) {
      cur.rSum += c;
      cur.rN++;
    }
    map.set(broker, cur);
  }
  return [...map.entries()].map(([broker, v]) => ({
    broker,
    trades: v.trades,
    fees: v.fees,
    avgCostR: v.rN ? v.rSum / v.rN : null,
    netPnl: v.net,
    grossPnl: v.gross,
  }));
}
