/** Símbolos canónicos usados em journal, stats, alertas e sessão. */

export const JOURNAL_PAIRS = [
  "XAUUSD",
  "SOLUSD",
  "BTCUSD",
  "ETHUSD",
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "GBPJPY",
  "USDCHF",
  "AUDUSD",
  "NZDUSD",
  "EURGBP",
  "EURJPY",
  "USDCAD",
  "NAS100",
  "US500",
  "GER40",
  "XRPUSD",
  "Outro",
] as const;

const ALIASES: Record<string, string> = {
  GOLD: "XAUUSD",
  XAUUSD: "XAUUSD",
  "XAU/USD": "XAUUSD",
  XAUUSDT: "XAUUSD",
  "XAU/USDT": "XAUUSD",
  SOLUSD: "SOLUSD",
  "SOL/USD": "SOLUSD",
  SOLUSDT: "SOLUSD",
  "SOL/USDT": "SOLUSD",
  BTCUSD: "BTCUSD",
  "BTC/USD": "BTCUSD",
  BTCUSDT: "BTCUSD",
  "BTC/USDT": "BTCUSD",
  ETHUSD: "ETHUSD",
  "ETH/USD": "ETHUSD",
  ETHUSDT: "ETHUSD",
  "ETH/USDT": "ETHUSD",
  XRPUSD: "XRPUSD",
  "XRP/USD": "XRPUSD",
  EURUSD: "EURUSD",
  "EUR/USD": "EURUSD",
  GBPUSD: "GBPUSD",
  "GBP/USD": "GBPUSD",
  USDJPY: "USDJPY",
  "USD/JPY": "USDJPY",
  GBPJPY: "GBPJPY",
  "GBP/JPY": "GBPJPY",
  USDCHF: "USDCHF",
  "USD/CHF": "USDCHF",
  AUDUSD: "AUDUSD",
  "AUD/USD": "AUDUSD",
  NZDUSD: "NZDUSD",
  "NZD/USD": "NZDUSD",
  EURGBP: "EURGBP",
  "EUR/GBP": "EURGBP",
  EURJPY: "EURJPY",
  "EUR/JPY": "EURJPY",
  USDCAD: "USDCAD",
  "USD/CAD": "USDCAD",
};

export function canonicalizePair(raw: string | null | undefined): string {
  const t = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!t) return "";
  if (ALIASES[t]) return ALIASES[t];
  const compact = t.replace(/\//g, "");
  if (ALIASES[compact]) return ALIASES[compact];
  return compact;
}

export function isSessionPair(pair: string): pair is "XAUUSD" | "SOLUSD" {
  const p = canonicalizePair(pair);
  return p === "XAUUSD" || p === "SOLUSD";
}
