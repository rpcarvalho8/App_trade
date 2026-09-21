/**
 * Twelve Data — fallback de OHLC real para XAU/USD quando a xAPI XTB
 * não está disponível (sem credenciais ou API indisponível).
 *
 * Nunca reconstrói candles a partir de um spot único.
 * Docs: https://twelvedata.com/docs#time-series
 */
import type { Candle } from "@/lib/strategies/types";

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
