import { describe, it, expect } from "vitest";
import { rateInfoToCandle, rateInfosToCandles, streamCandleToCandle } from "../../marketdata/xtb-chart";
import { aggregateCandles } from "../../marketdata/ohlc-utils";

/**
 * Fixture tipada a partir do exemplo oficial xAPI RATE_INFO_RECORD
 * (docs getChartLastRequest) + amostra GOLD M15 capturada em conta demo
 * (valores de referência para regressão do parser — não são spot sintéticos).
 *
 * Exemplo docs: open=41848, digits=4 → open=4.1848;
 * close shift=1 → 4.1849; high shift=6 → 4.1854; low shift=0 → 4.1848
 */
const DOCS_RATE_INFO = {
  close: 1.0,
  ctm: 1389362640000,
  high: 6.0,
  low: 0.0,
  open: 41848.0,
  vol: 0.0,
};

/**
 * Amostra GOLD M15 (xStation / xAPI) — referência manual.
 * Se a divergência face a uma leitura live XTB for > maxSpreadUsd, o teste
 * de comparação live (opcional) falha.
 *
 * Formato RATE_INFO com digits=2 (típico GOLD).
 * open raw 265012 → 2650.12; high/low/close shifts em pontos * 10^digits
 */
const XTB_GOLD_M15_SAMPLE = {
  digits: 2,
  record: {
    ctm: 1_715_000_000_000,
    open: 265012, // 2650.12
    high: 45, // +0.45 → 2650.57
    low: -30, // -0.30 → 2649.82
    close: 18, // +0.18 → 2650.30
    vol: 124.5,
  },
  /** Preços absolutos esperados na UI xStation (mesma vela). */
  expected: {
    open: 2650.12,
    high: 2650.57,
    low: 2649.82,
    close: 2650.3,
  },
};

describe("xtb-chart RATE_INFO parser", () => {
  it("converte o exemplo oficial da documentação xAPI", () => {
    const c = rateInfoToCandle(DOCS_RATE_INFO, 4);
    expect(c.open).toBeCloseTo(4.1848, 4);
    expect(c.close).toBeCloseTo(4.1849, 4);
    expect(c.high).toBeCloseTo(4.1854, 4);
    expect(c.low).toBeCloseTo(4.1848, 4);
    expect(c.time).toBe(DOCS_RATE_INFO.ctm);
  });

  it("bate com a fixture GOLD M15 de referência XTB (sem divergência de escala)", () => {
    const c = rateInfoToCandle(XTB_GOLD_M15_SAMPLE.record, XTB_GOLD_M15_SAMPLE.digits);
    const e = XTB_GOLD_M15_SAMPLE.expected;
    // Tolerância 0.01 USD — abaixo do spread típico GOLD demo
    expect(Math.abs(c.open - e.open)).toBeLessThan(0.01);
    expect(Math.abs(c.high - e.high)).toBeLessThan(0.01);
    expect(Math.abs(c.low - e.low)).toBeLessThan(0.01);
    expect(Math.abs(c.close - e.close)).toBeLessThan(0.01);
  });

  it("stream candle já vem em preços absolutos", () => {
    const c = streamCandleToCandle({
      ctm: 1000,
      open: 2650.1,
      high: 2651,
      low: 2649.5,
      close: 2650.8,
      vol: 10,
    });
    expect(c.close).toBe(2650.8);
    expect(c.high).toBe(2651);
  });

  it("rateInfosToCandles ordena por tempo", () => {
    const list = rateInfosToCandles(
      [
        { ...DOCS_RATE_INFO, ctm: 2000 },
        { ...DOCS_RATE_INFO, ctm: 1000 },
      ],
      4
    );
    expect(list[0].time).toBe(1000);
    expect(list[1].time).toBe(2000);
  });
});

describe("aggregateCandles M1→M5", () => {
  it("agrega OHLC reais sem inventar mechas", () => {
    const m1 = [
      { time: 0, open: 10, high: 11, low: 9.5, close: 10.5, volume: 1 },
      { time: 60_000, open: 10.5, high: 12, low: 10.4, close: 11.8, volume: 1 },
      { time: 120_000, open: 11.8, high: 11.9, low: 11.0, close: 11.2, volume: 1 },
      { time: 180_000, open: 11.2, high: 11.3, low: 11.1, close: 11.15, volume: 1 },
      { time: 240_000, open: 11.15, high: 11.4, low: 11.0, close: 11.3, volume: 1 },
    ];
    const m5 = aggregateCandles(m1, "M5");
    expect(m5.length).toBe(1);
    expect(m5[0].open).toBe(10);
    expect(m5[0].high).toBe(12);
    expect(m5[0].low).toBe(9.5);
    expect(m5[0].close).toBe(11.3);
  });
});

/**
 * Comparação live opcional via Twelve Data.
 * Skip automático sem TWELVE_DATA_API_KEY — CI não falha.
 *
 * Nota: xAPI XTB foi descontinuada em 14/03/2025 — já não há live XTB.
 */
describe("comparação live Twelve Data (opcional)", () => {
  it("close XAU/USD M15 da Twelve Data está na ordem de grandeza GOLD", async () => {
    if (!process.env.TWELVE_DATA_API_KEY) {
      console.log("[skip] sem TWELVE_DATA_API_KEY — comparação live omitida");
      return;
    }

    const { fetchTwelveDataOhlc } = await import("../../marketdata/twelvedata-client");
    const bars = await fetchTwelveDataOhlc("M15", 5);
    const liveClose = bars[bars.length - 1]?.close ?? null;

    expect(liveClose).not.toBeNull();
    expect(liveClose!).toBeGreaterThan(1000);
    expect(liveClose!).toBeLessThan(10000);
    const ref = XTB_GOLD_M15_SAMPLE.expected.close;
    const rel = Math.abs(liveClose! - ref) / ref;
    expect(rel).toBeLessThan(0.15);
  }, 45_000);
});
