import type { Candle, DetectionResult } from "../types";

export interface LiquiditySweepParams {
  /** Exige fecho de volta para dentro do nível (default true). */
  requireCloseBackInside?: boolean;
  /** Desvio máximo do preço em % (ex.: 0.2 = 0.2%). */
  maxDeviationPct?: number;
  /** Lookback para encontrar o swing high/low a varrer. */
  swingLookback?: number;
}

export interface LiquiditySweepDetails {
  direction: "bullish" | "bearish" | null;
  sweptLevel: number | null;
  extreme: number | null;
  sweepIndex: number | null;
  deviationPct: number | null;
  reason: string;
}

/**
 * Deteta violação de máximo/mínimo com wick e fecho de volta para dentro.
 * - Bearish sweep (BSL): high fura swing high, close fica abaixo do nível.
 * - Bullish sweep (SSL): low fura swing low, close fica acima do nível.
 */
export function liquiditySweep(
  candles: Candle[],
  params: LiquiditySweepParams = {}
): DetectionResult<LiquiditySweepDetails> {
  const requireCloseBack = params.requireCloseBackInside !== false;
  const maxDev = params.maxDeviationPct ?? Infinity;
  const lookback = params.swingLookback ?? 10;

  const empty = (reason: string): DetectionResult<LiquiditySweepDetails> => ({
    detected: false,
    details: {
      direction: null,
      sweptLevel: null,
      extreme: null,
      sweepIndex: null,
      deviationPct: null,
      reason,
    },
  });

  if (!candles || candles.length < lookback + 2) {
    return empty("insufficient_candles");
  }

  const i = candles.length - 1;
  const c = candles[i];
  const prior = candles.slice(Math.max(0, i - lookback), i);
  if (prior.length < 3) return empty("insufficient_lookback");

  const swingHigh = Math.max(...prior.map((p) => p.high));
  const swingLow = Math.min(...prior.map((p) => p.low));

  // Bearish liquidity sweep (took buy-side liquidity above highs)
  if (c.high > swingHigh) {
    const deviationPct = ((c.high - swingHigh) / swingHigh) * 100;
    const closedBack = c.close < swingHigh;
    if (deviationPct > maxDev) {
      return {
        detected: false,
        details: {
          direction: "bearish",
          sweptLevel: swingHigh,
          extreme: c.high,
          sweepIndex: i,
          deviationPct,
          reason: "deviation_too_large",
        },
      };
    }
    if (requireCloseBack && !closedBack) {
      return {
        detected: false,
        details: {
          direction: "bearish",
          sweptLevel: swingHigh,
          extreme: c.high,
          sweepIndex: i,
          deviationPct,
          reason: "no_close_back_inside",
        },
      };
    }
    if (!requireCloseBack || closedBack) {
      return {
        detected: true,
        details: {
          direction: "bearish",
          sweptLevel: swingHigh,
          extreme: c.high,
          sweepIndex: i,
          deviationPct,
          reason: "bearish_sweep",
        },
      };
    }
  }

  // Bullish liquidity sweep (took sell-side liquidity below lows)
  if (c.low < swingLow) {
    const deviationPct = ((swingLow - c.low) / swingLow) * 100;
    const closedBack = c.close > swingLow;
    if (deviationPct > maxDev) {
      return {
        detected: false,
        details: {
          direction: "bullish",
          sweptLevel: swingLow,
          extreme: c.low,
          sweepIndex: i,
          deviationPct,
          reason: "deviation_too_large",
        },
      };
    }
    if (requireCloseBack && !closedBack) {
      return {
        detected: false,
        details: {
          direction: "bullish",
          sweptLevel: swingLow,
          extreme: c.low,
          sweepIndex: i,
          deviationPct,
          reason: "no_close_back_inside",
        },
      };
    }
    if (!requireCloseBack || closedBack) {
      return {
        detected: true,
        details: {
          direction: "bullish",
          sweptLevel: swingLow,
          extreme: c.low,
          sweepIndex: i,
          deviationPct,
          reason: "bullish_sweep",
        },
      };
    }
  }

  return empty("no_sweep");
}
