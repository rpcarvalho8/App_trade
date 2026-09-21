import type { Candle } from "@/lib/strategies/types";
import { tfToMs, floorTime } from "./candle-buffer";

/**
 * Upsert de uma vela OHLC completa no buffer (substitui tick sintético).
 */
export function upsertCandle(bars: Candle[], candle: Candle, maxBars: number): Candle[] {
  if (!candle || !Number.isFinite(candle.time) || !Number.isFinite(candle.close)) return bars;
  const next = bars.slice();
  const i = next.findIndex((b) => b.time === candle.time);
  if (i >= 0) next[i] = { ...candle };
  else {
    next.push({ ...candle });
    next.sort((a, b) => a.time - b.time);
  }
  return next.length > maxBars ? next.slice(-maxBars) : next;
}

/** Agrega velas de TF menor para TF maior (ex.: M1 → M5). Usa OHLC reais. */
export function aggregateCandles(source: Candle[], targetTf: string): Candle[] {
  const tfMs = tfToMs(targetTf);
  if (!source.length || !tfMs) return [];
  const map = new Map<number, Candle>();
  for (const c of source) {
    const t0 = floorTime(c.time, tfMs);
    const prev = map.get(t0);
    if (!prev) {
      map.set(t0, { time: t0, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
    } else {
      prev.high = Math.max(prev.high, c.high);
      prev.low = Math.min(prev.low, c.low);
      prev.close = c.close;
      prev.volume += c.volume;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

export { tfToMs, floorTime };
