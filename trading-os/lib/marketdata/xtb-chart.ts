/**
 * Conversão RATE_INFO_RECORD (xAPI) → Candle OHLCV.
 * Preços vêm escalados: open / 10^digits; high/low/close são shifts do open.
 * @see http://developers.xstore.pro/documentation/#getChartLastRequest
 */
import type { Candle } from "@/lib/strategies/types";

export interface XtbRateInfoRecord {
  ctm: number;
  open: number;
  high: number;
  low: number;
  close: number;
  vol?: number;
}

export function rateInfoToCandle(r: XtbRateInfoRecord, digits: number): Candle {
  const div = Math.pow(10, digits);
  const open = r.open / div;
  return {
    time: r.ctm,
    open,
    high: open + r.high / div,
    low: open + r.low / div,
    close: open + r.close / div,
    volume: Number(r.vol || 0),
  };
}

export function rateInfosToCandles(rateInfos: XtbRateInfoRecord[], digits: number): Candle[] {
  return (rateInfos || []).map((r) => rateInfoToCandle(r, digits)).sort((a, b) => a.time - b.time);
}

/** STREAMING_CANDLE_RECORD já traz preços absolutos. */
export function streamCandleToCandle(d: {
  ctm: number;
  open: number;
  high: number;
  low: number;
  close: number;
  vol?: number;
}): Candle {
  return {
    time: d.ctm,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: Number(d.vol || 0),
  };
}
