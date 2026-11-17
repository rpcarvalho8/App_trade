/**
 * Contas (prop firm ou corretora) e custos por trade (funções puras, usáveis no cliente e no servidor).
 */

import type { PropRules } from "@/lib/prop-rules";

export type AccountKind = "prop" | "broker";
export type AccountCurrency = "EUR" | "USD";

/** Conta onde operas: prop firm (ex.: FundingPips) ou corretora (ex.: Kraken). Regras de prop firm em PropRules. */
export interface Account extends Partial<PropRules> {
  /** Nome único da conta, ex.: "FundingPips" ou "Kraken". */
  name: string;
  kind: AccountKind;
  currency: AccountCurrency;
  /** Activos operados nesta conta (cada activo pertence a uma só conta). */
  symbols: string[];
  /** Capital actual, na moeda da conta. */
  equity: number;
  /** Maior capital já registado (base do drawdown total da Fase 3). */
  peak_equity: number;
  updated_at?: string;
}

export const KIND_LABEL: Record<AccountKind, string> = { prop: "Prop firm", broker: "Corretora" };

/** Contas iniciais: ouro no desafio FundingPips, SOL na Kraken. */
export const DEFAULT_ACCOUNTS: Array<Pick<Account, "name" | "kind" | "currency" | "symbols">> = [
  { name: "FundingPips", kind: "prop", currency: "USD", symbols: ["XAUUSD"] },
  { name: "Kraken", kind: "broker", currency: "USD", symbols: ["SOLUSD"] },
];

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** "XAUUSD, solusd" → ["XAUUSD","SOLUSD"] (também aceita array). */
export function parseSymbols(v: unknown): string[] {
  const list = Array.isArray(v) ? v : String(v ?? "").split(/[,\s]+/);
  return [...new Set(list.map((x) => String(x).trim().toUpperCase()).filter(Boolean))];
}

export function isAccountKind(v: unknown): v is AccountKind {
  return v === "prop" || v === "broker";
}

/** Conta a que o activo está atribuído. */
export function accountForSymbolIn<T extends Pick<Account, "symbols">>(accounts: T[], symbol: string): T | null {
  const s = String(symbol || "").toUpperCase();
  return accounts.find((a) => a.symbols.includes(s)) ?? null;
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

export interface AccountCostSummary {
  account: string;
  trades: number;
  fees: number;
  avgCostR: number | null;
  netPnl: number;
  grossPnl: number;
}

/** Custos agregados por conta (a partir do par da trade e da atribuição activo → conta). */
export function costsByAccount(
  rows: Array<CostFields & { pair?: unknown }>,
  accounts: Array<Pick<Account, "name" | "symbols">>
): AccountCostSummary[] {
  const map = new Map<string, { trades: number; fees: number; rSum: number; rN: number; net: number; gross: number }>();
  for (const t of rows) {
    const key = accountForSymbolIn(accounts, String(t.pair ?? ""))?.name ?? "Outra";
    const cur = map.get(key) ?? { trades: 0, fees: 0, rSum: 0, rN: 0, net: 0, gross: 0 };
    cur.trades++;
    cur.fees += tradeFees(t);
    cur.gross += num(t.pnl);
    cur.net += netPnl(t);
    const c = costInR(t);
    if (c != null) {
      cur.rSum += c;
      cur.rN++;
    }
    map.set(key, cur);
  }
  return [...map.entries()].map(([account, v]) => ({
    account,
    trades: v.trades,
    fees: v.fees,
    avgCostR: v.rN ? v.rSum / v.rN : null,
    netPnl: v.net,
    grossPnl: v.gross,
  }));
}
