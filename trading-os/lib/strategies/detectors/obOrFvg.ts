import type { BiasDirection, Candle, DetectionResult } from "../types";

export interface ObOrFvgDetails {
  kind: "order_block" | "fvg" | null;
  direction: BiasDirection;
  zoneHigh: number | null;
  zoneLow: number | null;
  index: number | null;
  reason: string;
}

/**
 * Identifica Order Block ou Fair Value Gap recente na direção do impulso.
 * Sem side effects — analisa as últimas velas.
 */
export function obOrFvg(
  candles: Candle[],
  _timeframe?: string,
  preferredDirection?: BiasDirection
): DetectionResult<ObOrFvgDetails> {
  const empty = (reason: string): DetectionResult<ObOrFvgDetails> => ({
    detected: false,
    details: {
      kind: null,
      direction: "neutral",
      zoneHigh: null,
      zoneLow: null,
      index: null,
      reason,
    },
  });

  if (!candles || candles.length < 4) return empty("insufficient_candles");

  // Procura FVG de 3 velas (gap entre candle[i-2] e candle[i])
  for (let i = candles.length - 1; i >= 2; i--) {
    const c0 = candles[i];
    const c2 = candles[i - 2];

    // Bullish FVG: low[i] > high[i-2]
    if (c0.low > c2.high) {
      const dir: BiasDirection = "bullish";
      if (preferredDirection && preferredDirection !== "neutral" && preferredDirection !== dir) {
        continue;
      }
      return {
        detected: true,
        details: {
          kind: "fvg",
          direction: dir,
          zoneHigh: c0.low,
          zoneLow: c2.high,
          index: i,
          reason: "bullish_fvg",
        },
      };
    }

    // Bearish FVG: high[i] < low[i-2]
    if (c0.high < c2.low) {
      const dir: BiasDirection = "bearish";
      if (preferredDirection && preferredDirection !== "neutral" && preferredDirection !== dir) {
        continue;
      }
      return {
        detected: true,
        details: {
          kind: "fvg",
          direction: dir,
          zoneHigh: c2.low,
          zoneLow: c0.high,
          index: i,
          reason: "bearish_fvg",
        },
      };
    }
  }

  // Order block: última vela oposta antes de um impulso de 2+ velas
  for (let i = candles.length - 1; i >= 2; i--) {
    const impulse = candles[i];
    const body = Math.abs(impulse.close - impulse.open);
    const range = impulse.high - impulse.low || 1e-9;
    if (body / range < 0.55) continue;

    const prev = candles[i - 1];
    // Bullish OB: vela bearish seguida de impulso bullish
    if (impulse.close > impulse.open && prev.close < prev.open) {
      const dir: BiasDirection = "bullish";
      if (preferredDirection && preferredDirection !== "neutral" && preferredDirection !== dir) {
        continue;
      }
      return {
        detected: true,
        details: {
          kind: "order_block",
          direction: dir,
          zoneHigh: prev.high,
          zoneLow: prev.low,
          index: i - 1,
          reason: "bullish_ob",
        },
      };
    }
    // Bearish OB: vela bullish seguida de impulso bearish
    if (impulse.close < impulse.open && prev.close > prev.open) {
      const dir: BiasDirection = "bearish";
      if (preferredDirection && preferredDirection !== "neutral" && preferredDirection !== dir) {
        continue;
      }
      return {
        detected: true,
        details: {
          kind: "order_block",
          direction: dir,
          zoneHigh: prev.high,
          zoneLow: prev.low,
          index: i - 1,
          reason: "bearish_ob",
        },
      };
    }
  }

  return empty("no_ob_or_fvg");
}
