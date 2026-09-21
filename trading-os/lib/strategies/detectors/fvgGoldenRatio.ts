import type { BiasDirection, Candle, DetectionResult } from "../types";

export interface FvgGoldenRatioParams {
  fibZone?: [number, number];
  minFvgPct?: number;
  /** Extremos do impulso do ChoCH para o Fibonacci. Se omitidos, usa swing recente. */
  impulseStart?: number;
  impulseExtreme?: number;
  direction?: BiasDirection;
}

export interface FvgGoldenRatioDetails {
  direction: BiasDirection;
  fvgHigh: number | null;
  fvgLow: number | null;
  fvgPct: number | null;
  fibLevel: number | null;
  inZone: boolean;
  index: number | null;
  reason: string;
}

/**
 * FVG dentro da zona Fibonacci (default Golden Ratio 0.618–0.786).
 */
export function fvgGoldenRatio(
  candles: Candle[],
  fibZone: [number, number] = [0.618, 0.786],
  minPct = 0.1,
  extras: Omit<FvgGoldenRatioParams, "fibZone" | "minFvgPct"> = {}
): DetectionResult<FvgGoldenRatioDetails> {
  const empty = (reason: string): DetectionResult<FvgGoldenRatioDetails> => ({
    detected: false,
    details: {
      direction: "neutral",
      fvgHigh: null,
      fvgLow: null,
      fvgPct: null,
      fibLevel: null,
      inZone: false,
      index: null,
      reason,
    },
  });

  if (!candles || candles.length < 4) return empty("insufficient_candles");

  const [fibLo, fibHi] = fibZone;
  let start = extras.impulseStart;
  let extreme = extras.impulseExtreme;
  const prefer = extras.direction;

  if (start == null || extreme == null) {
    const look = candles.slice(-30);
    start = look[0].open;
    extreme = prefer === "bearish"
      ? Math.min(...look.map((c) => c.low))
      : Math.max(...look.map((c) => c.high));
    if (prefer === "bearish" || (prefer !== "bullish" && extreme < start)) {
      // bearish impulse: start high → extreme low
      start = Math.max(...look.map((c) => c.high));
      extreme = Math.min(...look.map((c) => c.low));
    } else {
      start = Math.min(...look.map((c) => c.low));
      extreme = Math.max(...look.map((c) => c.high));
    }
  }

  const range = extreme - start;
  if (Math.abs(range) < 1e-12) return empty("zero_impulse_range");

  for (let i = candles.length - 1; i >= 2; i--) {
    const c0 = candles[i];
    const c2 = candles[i - 2];

    // Bullish FVG
    if (c0.low > c2.high) {
      const fvgLow = c2.high;
      const fvgHigh = c0.low;
      const mid = (fvgLow + fvgHigh) / 2;
      const fvgPct = ((fvgHigh - fvgLow) / mid) * 100;
      if (fvgPct < minPct) {
        continue;
      }
      // Fib retracement from extreme back toward start (bullish: retrace down from high)
      const fibLevel = range > 0
        ? (extreme - mid) / range // bullish impulse up: retrace from extreme
        : (mid - extreme) / Math.abs(range);
      const inZone = fibLevel >= fibLo && fibLevel <= fibHi;
      if (!inZone) {
        return {
          detected: false,
          details: {
            direction: "bullish",
            fvgHigh,
            fvgLow,
            fvgPct,
            fibLevel,
            inZone: false,
            index: i,
            reason: "fvg_out_of_zone",
          },
        };
      }
      if (prefer && prefer !== "neutral" && prefer !== "bullish") continue;
      return {
        detected: true,
        details: {
          direction: "bullish",
          fvgHigh,
          fvgLow,
          fvgPct,
          fibLevel,
          inZone: true,
          index: i,
          reason: "bullish_fvg_golden",
        },
      };
    }

    // Bearish FVG
    if (c0.high < c2.low) {
      const fvgHigh = c2.low;
      const fvgLow = c0.high;
      const mid = (fvgLow + fvgHigh) / 2;
      const fvgPct = ((fvgHigh - fvgLow) / mid) * 100;
      if (fvgPct < minPct) continue;
      const fibLevel = range < 0
        ? (mid - extreme) / Math.abs(range)
        : (mid - extreme) / Math.abs(range);
      // For bearish impulse (start high, extreme low): retrace up from extreme
      const impulseDown = extreme < start;
      const level = impulseDown
        ? (mid - extreme) / (start - extreme)
        : (extreme - mid) / (extreme - start);
      const inZone = level >= fibLo && level <= fibHi;
      if (!inZone) {
        return {
          detected: false,
          details: {
            direction: "bearish",
            fvgHigh,
            fvgLow,
            fvgPct,
            fibLevel: level,
            inZone: false,
            index: i,
            reason: "fvg_out_of_zone",
          },
        };
      }
      if (prefer && prefer !== "neutral" && prefer !== "bearish") continue;
      return {
        detected: true,
        details: {
          direction: "bearish",
          fvgHigh,
          fvgLow,
          fvgPct,
          fibLevel: level,
          inZone: true,
          index: i,
          reason: "bearish_fvg_golden",
        },
      };
    }
  }

  return empty("no_fvg");
}
