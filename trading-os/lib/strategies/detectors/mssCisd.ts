import type { BiasDirection, Candle, DetectionResult } from "../types";

export interface MssCisdDetails {
  direction: BiasDirection;
  brokenLevel: number | null;
  breakIndex: number | null;
  alignedWithBias: boolean;
  reason: string;
}

/**
 * Deteta Market Structure Shift / CISD alinhado com o bias.
 * Bullish: close acima do último swing high (quebra de estrutura baixista).
 * Bearish: close abaixo do último swing low (quebra de estrutura altista).
 */
export function mssCisd(
  candles: Candle[],
  biasDirection: BiasDirection
): DetectionResult<MssCisdDetails> {
  const empty = (reason: string, aligned = false): DetectionResult<MssCisdDetails> => ({
    detected: false,
    details: {
      direction: "neutral",
      brokenLevel: null,
      breakIndex: null,
      alignedWithBias: aligned,
      reason,
    },
  });

  if (!candles || candles.length < 6) return empty("insufficient_candles");
  if (biasDirection === "neutral") return empty("bias_neutral");

  const lookback = Math.min(20, candles.length - 1);
  const window = candles.slice(-lookback - 1, -1);
  const last = candles[candles.length - 1];

  // Pivots de 1 vela (>= nos vizinhos) mantidos de propósito. Testado com swingPivots(side=2) num replay de
  // 45 dias do XAUUSD (Nov 2026): menos sinais (−11% London, −17% rotação) e sem melhoria de resultado que
  // se distinga do ruído (n≈30–60, R médio dentro de ±0,3). Reabrir só com mais dados.
  // Swing pivots (high/low locais) — se não houver pivots, usa max/min da janela
  const highs: { i: number; v: number }[] = [];
  const lows: { i: number; v: number }[] = [];
  for (let i = 1; i < window.length - 1; i++) {
    if (window[i].high >= window[i - 1].high && window[i].high >= window[i + 1].high) {
      highs.push({ i, v: window[i].high });
    }
    if (window[i].low <= window[i - 1].low && window[i].low <= window[i + 1].low) {
      lows.push({ i, v: window[i].low });
    }
  }

  if (biasDirection === "bullish") {
    const level =
      highs.length > 0
        ? highs[highs.length - 1].v
        : Math.max(...window.map((w) => w.high));
    if (last.close > level) {
      return {
        detected: true,
        details: {
          direction: "bullish",
          brokenLevel: level,
          breakIndex: candles.length - 1,
          alignedWithBias: true,
          reason: "bullish_mss",
        },
      };
    }
    return empty("no_bullish_break", true);
  }

  const level =
    lows.length > 0 ? lows[lows.length - 1].v : Math.min(...window.map((w) => w.low));
  if (last.close < level) {
    return {
      detected: true,
      details: {
        direction: "bearish",
        brokenLevel: level,
        breakIndex: candles.length - 1,
        alignedWithBias: true,
        reason: "bearish_mss",
      },
    };
  }
  return empty("no_bearish_break", true);
}
