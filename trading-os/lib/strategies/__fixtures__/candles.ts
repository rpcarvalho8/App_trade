import type { Candle } from "../types";

/** Helper para gerar candles sintéticos plausíveis. */
export function c(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 100
): Candle {
  return { time, open, high, low, close, volume };
}

const T0 = 1_700_000_000_000;

/** XAUUSD M15 — sweep bullish (wick abaixo do swing low, close de volta). */
export const xauSweepPositive: Candle[] = (() => {
  const bars: Candle[] = [];
  let p = 2650;
  for (let i = 0; i < 12; i++) {
    const o = p;
    const cl = p + (i % 2 === 0 ? 1.2 : -0.8);
    bars.push(c(T0 + i * 900_000, o, Math.max(o, cl) + 0.5, Math.min(o, cl) - 0.5, cl, 80 + i));
    p = cl;
  }
  // swing low ~ min of prior ≈ last lows around 2648
  const swingLow = Math.min(...bars.map((b) => b.low));
  bars.push(
    c(
      T0 + 12 * 900_000,
      p,
      p + 0.3,
      swingLow - 2.5, // pierce
      swingLow + 0.8, // close back inside
      120
    )
  );
  return bars;
})();

/** XAUUSD M15 — quebra verdadeira (fecha abaixo) → invalidação. */
export const xauSweepInvalidation: Candle[] = (() => {
  const bars = xauSweepPositive.slice(0, 12).map((b) => ({ ...b }));
  const swingLow = Math.min(...bars.map((b) => b.low));
  const p = bars[bars.length - 1].close;
  bars.push(
    c(T0 + 12 * 900_000, p, p + 0.2, swingLow - 3, swingLow - 1.5, 110) // close below
  );
  return bars;
})();

/** M15 MSS bullish após estrutura de LHs. */
export const xauMssPositive: Candle[] = (() => {
  const bars: Candle[] = [];
  // Zig-zag com swing highs claros, depois quebra acima do último LH
  const seq = [
    [100, 106, 99, 105], // swing high 106
    [105, 105.5, 102, 103],
    [103, 104, 100, 101],
    [101, 103, 99, 100], // pullback
    [100, 104.5, 99.5, 104], // LH ~104.5
    [104, 104.2, 101, 102],
    [102, 103, 100.5, 101],
    [101, 107, 100.8, 106.5], // close above LH 104.5
  ];
  seq.forEach((s, i) => bars.push(c(T0 + i * 900_000, s[0], s[1], s[2], s[3], 50)));
  return bars;
})();

/** MSS sem quebra — invalidação. */
export const xauMssInvalidation: Candle[] = xauMssPositive.slice(0, -1).concat([
  c(T0 + 7 * 900_000, 101, 104, 100.8, 103.5, 50), // não fecha acima do LH 104.5
]);

/** M5 OB/FVG bullish. */
export const xauObFvgPositive: Candle[] = [
  c(T0, 100, 101, 99.5, 100.2, 40),
  c(T0 + 300_000, 100.2, 100.5, 99.8, 100.0, 35),
  c(T0 + 600_000, 100.0, 100.3, 99.7, 99.9, 30),
  c(T0 + 900_000, 99.9, 100.1, 99.5, 99.6, 28), // bearish OB candle
  c(T0 + 1_200_000, 99.6, 104.0, 99.6, 103.5, 90), // impulso bullish (body forte)
];

/** Sem FVG nem OB claro. */
export const xauObFvgInvalidation: Candle[] = [
  c(T0, 100, 100.4, 99.8, 100.1, 40),
  c(T0 + 300_000, 100.1, 100.5, 99.9, 100.2, 40),
  c(T0 + 600_000, 100.2, 100.6, 100.0, 100.3, 40),
  c(T0 + 900_000, 100.3, 100.7, 100.1, 100.4, 40),
];

/** SOL 1m ChoCH bullish com volume spike. */
export const solChochPositive: Candle[] = (() => {
  const bars: Candle[] = [];
  let p = 150;
  for (let i = 0; i < 22; i++) {
    const o = p;
    const cl = p - 0.15 + (i % 3 === 0 ? 0.05 : 0);
    const hi = Math.max(o, cl) + 0.08;
    const lo = Math.min(o, cl) - 0.08;
    bars.push(c(T0 + i * 60_000, o, hi, lo, cl, 50));
    p = cl;
  }
  // create a clear swing high in the middle of recent bars
  bars[18] = c(bars[18].time, 148.5, 149.2, 148.4, 148.6, 50);
  bars[19] = c(bars[19].time, 148.6, 148.9, 148.3, 148.4, 50);
  bars[20] = c(bars[20].time, 148.4, 148.7, 148.2, 148.3, 50);
  // ChoCH: close above 149.2 with volume spike
  bars.push(c(T0 + 22 * 60_000, 148.3, 149.8, 148.3, 149.5, 200));
  return bars;
})();

/** ChoCH sem volume. */
export const solChochInvalidation: Candle[] = (() => {
  const bars = solChochPositive.slice(0, -1).map((b) => ({ ...b }));
  const last = solChochPositive[solChochPositive.length - 1];
  bars.push({ ...last, volume: 40 }); // no spike
  return bars;
})();

/**
 * SOL 1m — impulso bullish + FVG na zona 0.618–0.786 do fib.
 * Impulse: low 100 → high 110. Fib 0.618 = 103.82, 0.786 = 102.14 from top...
 * Retracement from 110 toward 100: level = (110-mid)/10.
 * For mid in [102.14, 103.82] → fib in zone.
 */
export const solFvgPositive: Candle[] = (() => {
  const bars: Candle[] = [];
  // Build impulse 100 → 110
  for (let i = 0; i < 8; i++) {
    const o = 100 + i * 1.2;
    const cl = o + 1.1;
    bars.push(c(T0 + i * 60_000, o, cl + 0.1, o - 0.1, cl, 60));
  }
  // Pullback candles creating bullish FVG around 103.2
  // Need c2.high < c0.low with mid in golden zone
  // After impulse extreme ~110, start ~100
  bars.push(c(T0 + 8 * 60_000, 109, 109.5, 104.0, 104.2, 55)); // c2 for later — high 109.5 won't work
  // Better: create 3-candle FVG at retracement
  // Candle A (i-2): high = 102.8
  // Candle B (i-1): middle
  // Candle C (i): low = 103.5 → bullish FVG 102.8–103.5, mid≈103.15
  // fib = (110 - 103.15)/10 = 0.685 ✓
  const base = T0 + 10 * 60_000;
  bars.push(c(base, 104, 104.2, 102.5, 102.8, 50)); // will be i-2: high 104.2 — adjust
  // Rebuild cleaner short series ending with FVG
  const clean: Candle[] = [];
  for (let i = 0; i < 6; i++) {
    const o = 100 + i * 1.5;
    clean.push(c(T0 + i * 60_000, o, o + 1.6, o - 0.05, o + 1.4, 60));
  }
  // extreme ~ 100+5*1.5+1.4 = 108.9 — bump last high to 110
  clean[5] = c(clean[5].time, 107.5, 110, 107.4, 109.8, 80);
  // retrace
  clean.push(c(T0 + 6 * 60_000, 109.8, 109.9, 103.0, 103.2, 70)); // i-2 high=109.9 — too high for FVG
  // For bullish FVG we need gap UP. So after pullback, impulse up again leaving gap.
  // Pullback to ~103, then skip:
  clean.push(c(T0 + 7 * 60_000, 103.2, 103.5, 102.6, 102.9, 40)); // i-2: high 103.5? wait
  // Let's set explicitly:
  // i-2: high = 102.9
  // i-1: anything
  // i: low = 103.6 → FVG 102.9-103.6 mid 103.25 → fib (110-103.25)/10 = 0.675
  const out: Candle[] = clean.slice(0, 6);
  out.push(c(T0 + 6 * 60_000, 109.5, 109.8, 105, 105.2, 50));
  out.push(c(T0 + 7 * 60_000, 105.2, 105.4, 102.5, 102.8, 45)); // i-2
  out.push(c(T0 + 8 * 60_000, 102.8, 103.2, 102.4, 103.0, 40)); // i-1
  out.push(c(T0 + 9 * 60_000, 103.5, 104.5, 103.55, 104.2, 55)); // i: low 103.55 > 102.8? need > i-2 high 105.4 — wrong

  // Fix i-2 high to be below i low:
  const final: Candle[] = [];
  for (let i = 0; i < 6; i++) {
    const o = 100 + i * 1.5;
    final.push(c(T0 + i * 60_000, o, o + 1.6, o - 0.05, o + 1.4, 60));
  }
  final[5] = c(final[5].time, 107.5, 110, 107.4, 109.8, 80);
  final.push(c(T0 + 6 * 60_000, 109.5, 109.6, 104, 104.2, 50));
  final.push(c(T0 + 7 * 60_000, 104.2, 104.3, 102.4, 102.7, 40)); // i-2 high=104.3
  final.push(c(T0 + 8 * 60_000, 102.7, 103.0, 102.3, 102.5, 35)); // i-1
  // Need i.low > 104.3 for bullish FVG — that would be mid ~104.5, fib=(110-104.5)/10=0.55 out of zone
  // For golden zone mid needs 102.14–103.82 for 10pt range from 110 to 100.
  // So FVG must be around there with i-2.high < i.low both in that band.
  // Impulse extreme 110, start 100. After pullback, small gap:
  // i-2 high = 102.8, i low = 103.4 → mid 103.1 → fib 0.69 ✓
  // But price had to get there — impulse candles already in final.
  const ok: Candle[] = [];
  ok.push(c(T0, 100, 101, 99.8, 100.5, 50));
  ok.push(c(T0 + 60_000, 100.5, 103, 100.4, 102.8, 60));
  ok.push(c(T0 + 120_000, 102.8, 106, 102.7, 105.5, 70));
  ok.push(c(T0 + 180_000, 105.5, 108, 105.4, 107.5, 70));
  ok.push(c(T0 + 240_000, 107.5, 110, 107.4, 109.5, 80)); // extreme 110, start ~100
  ok.push(c(T0 + 300_000, 109.5, 109.7, 103.5, 103.8, 60)); // pullback
  ok.push(c(T0 + 360_000, 103.8, 103.9, 102.5, 102.7, 40)); // i-2 high 103.9 — slightly high
  ok.push(c(T0 + 420_000, 102.7, 102.9, 102.4, 102.6, 35)); // i-1
  ok.push(c(T0 + 480_000, 104.0, 104.8, 103.95, 104.5, 50)); // i low 103.95 > 103.9? barely — mid~103.92 fib=(110-103.92)/10=0.608 borderline
  // Tighten:
  const good: Candle[] = ok.slice(0, 6);
  good.push(c(T0 + 360_000, 103.8, 103.0, 102.5, 102.7, 40)); // typo high
  // redo last 3
  const g: Candle[] = ok.slice(0, 6);
  g.push(c(T0 + 360_000, 103.8, 102.85, 102.5, 102.7, 40)); // invalid OHLC
  // Proper OHLC:
  const g2: Candle[] = ok.slice(0, 6);
  g2.push(c(T0 + 360_000, 103.8, 103.85, 102.50, 102.70, 40)); // i-2 high=103.85
  g2.push(c(T0 + 420_000, 102.70, 103.20, 102.40, 102.90, 35)); // i-1
  g2.push(c(T0 + 480_000, 104.00, 104.80, 103.90, 104.50, 55)); // i low=103.90 > 103.85, mid=103.875, fib=0.6125 — slightly below 0.618

  const g3: Candle[] = ok.slice(0, 6);
  g3.push(c(T0 + 360_000, 103.8, 103.50, 102.50, 102.70, 40)); // i-2 high=103.50
  g3.push(c(T0 + 420_000, 102.70, 103.00, 102.40, 102.80, 35));
  g3.push(c(T0 + 480_000, 104.00, 104.80, 103.70, 104.40, 55)); // mid=(103.50+103.70)/2=103.6, fib=(110-103.6)/10=0.64 ✓
  return g3;
})();

/** FVG demasiado pequeno ou fora da zona. */
export const solFvgInvalidation: Candle[] = (() => {
  const bars = solFvgPositive.slice(0, -1).map((b) => ({ ...b }));
  // Tiny FVG far from zone (near extreme)
  bars.push(c(T0 + 480_000, 109.2, 109.5, 109.15, 109.4, 40)); // if prior high allows tiny gap near top
  return bars;
})();

/** SOL 15m sweep positive. */
export const solSweepPositive: Candle[] = (() => {
  const bars: Candle[] = [];
  let p = 150;
  for (let i = 0; i < 12; i++) {
    const o = p;
    const cl = p + (i % 2 ? -0.2 : 0.15);
    bars.push(c(T0 + i * 900_000, o, Math.max(o, cl) + 0.1, Math.min(o, cl) - 0.1, cl, 200));
    p = cl;
  }
  const swingHigh = Math.max(...bars.map((b) => b.high));
  bars.push(
    c(T0 + 12 * 900_000, p, swingHigh + 0.15, p - 0.1, swingHigh - 0.05, 250) // bearish sweep, deviation small
  );
  return bars;
})();

export const solSweepInvalidation: Candle[] = (() => {
  const bars = solSweepPositive.slice(0, 12).map((b) => ({ ...b }));
  const swingHigh = Math.max(...bars.map((b) => b.high));
  const p = bars[bars.length - 1].close;
  // Huge deviation > 0.2%
  bars.push(c(T0 + 12 * 900_000, p, swingHigh * 1.005, p - 0.1, swingHigh - 0.02, 250));
  return bars;
})();
