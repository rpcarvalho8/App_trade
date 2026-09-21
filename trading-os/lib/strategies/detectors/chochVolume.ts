import type { BiasDirection, Candle, DetectionResult } from "../types";

export interface ChochVolumeDetails {
  direction: BiasDirection;
  brokenLevel: number | null;
  volume: number | null;
  avgVolume: number | null;
  volumeMultipleActual: number | null;
  index: number | null;
  reason: string;
}

/**
 * Change of Character com spike de volume.
 * Bullish ChoCH: close acima do último LH + volume > média × multiple.
 * Bearish ChoCH: close abaixo do último HL + volume > média × multiple.
 */
export function chochVolume(
  candles: Candle[],
  volumeMultiple = 1.5,
  lookback = 20
): DetectionResult<ChochVolumeDetails> {
  const empty = (reason: string): DetectionResult<ChochVolumeDetails> => ({
    detected: false,
    details: {
      direction: "neutral",
      brokenLevel: null,
      volume: null,
      avgVolume: null,
      volumeMultipleActual: null,
      index: null,
      reason,
    },
  });

  if (!candles || candles.length < lookback + 3) return empty("insufficient_candles");

  const i = candles.length - 1;
  const c = candles[i];
  const hist = candles.slice(Math.max(0, i - lookback), i);
  const avgVol = hist.reduce((s, x) => s + (x.volume || 0), 0) / Math.max(1, hist.length);
  const volMult = avgVol > 0 ? c.volume / avgVol : 0;

  // Pivots no lookback
  const highs: number[] = [];
  const lows: number[] = [];
  for (let j = 1; j < hist.length - 1; j++) {
    if (hist[j].high >= hist[j - 1].high && hist[j].high >= hist[j + 1].high) highs.push(hist[j].high);
    if (hist[j].low <= hist[j - 1].low && hist[j].low <= hist[j + 1].low) lows.push(hist[j].low);
  }

  const volumeOk = volMult >= volumeMultiple;

  if (highs.length > 0 && c.close > highs[highs.length - 1]) {
    if (!volumeOk) {
      return {
        detected: false,
        details: {
          direction: "bullish",
          brokenLevel: highs[highs.length - 1],
          volume: c.volume,
          avgVolume: avgVol,
          volumeMultipleActual: volMult,
          index: i,
          reason: "choch_no_volume",
        },
      };
    }
    return {
      detected: true,
      details: {
        direction: "bullish",
        brokenLevel: highs[highs.length - 1],
        volume: c.volume,
        avgVolume: avgVol,
        volumeMultipleActual: volMult,
        index: i,
        reason: "bullish_choch_volume",
      },
    };
  }

  if (lows.length > 0 && c.close < lows[lows.length - 1]) {
    if (!volumeOk) {
      return {
        detected: false,
        details: {
          direction: "bearish",
          brokenLevel: lows[lows.length - 1],
          volume: c.volume,
          avgVolume: avgVol,
          volumeMultipleActual: volMult,
          index: i,
          reason: "choch_no_volume",
        },
      };
    }
    return {
      detected: true,
      details: {
        direction: "bearish",
        brokenLevel: lows[lows.length - 1],
        volume: c.volume,
        avgVolume: avgVol,
        volumeMultipleActual: volMult,
        index: i,
        reason: "bearish_choch_volume",
      },
    };
  }

  return empty("no_choch");
}
