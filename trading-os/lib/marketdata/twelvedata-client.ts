/**
 * Twelve Data — fonte PRIMÁRIA de OHLC real para XAU/USD.
 * Nunca reconstrói candles a partir de um spot único.
 * Docs: https://twelvedata.com/docs#time-series
 *
 * Basic free: 8 créditos/min · 800/dia · time_series = 1 crédito.
 */
import type { Candle } from "@/lib/strategies/types";
import {
  recordTwelveDataCredit,
  wouldExceedDailyLimit,
  getTwelveDataCreditStats,
} from "./twelve-data-credits";

const BASE = "https://api.twelvedata.com";

const TF_TO_INTERVAL: Record<string, string> = {
  H4: "4h",
  M15: "15min",
  M5: "5min",
  M1: "1min",
};

export async function fetchTwelveDataOhlc(
  tf: string,
  outputsize: number,
  apiKey = process.env.TWELVE_DATA_API_KEY || ""
): Promise<Candle[]> {
  if (!apiKey) throw new Error("TWELVE_DATA_API_KEY em falta");
  const interval = TF_TO_INTERVAL[tf] || TF_TO_INTERVAL[tf.toUpperCase()];
  if (!interval) throw new Error(`TF não suportado: ${tf}`);

  if (wouldExceedDailyLimit(1)) {
    const s = getTwelveDataCreditStats();
    throw new Error(
      `Twelve Data quota diária esgotada (${s.used}/${s.limit} em ${s.day}) — a saltar pedido ${tf}`
    );
  }

  const url =
    `${BASE}/time_series?symbol=${encodeURIComponent("XAU/USD")}` +
    `&interval=${interval}&outputsize=${outputsize}&order=ASC&apikey=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`TwelveData HTTP ${res.status}`);
  const j = await res.json();
  if (j?.status === "error" || j?.code) {
    throw new Error(j?.message || `TwelveData error ${j?.code}`);
  }

  recordTwelveDataCredit(tf, 1);

  const values: any[] = j?.values || [];
  return values
    .map((v) => ({
      time: Date.parse(String(v.datetime).replace(" ", "T") + "Z") || Date.parse(v.datetime),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: parseFloat(v.volume || "0") || 0,
    }))
    .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.close))
    .sort((a, b) => a.time - b.time);
}

export { getTwelveDataCreditStats };
