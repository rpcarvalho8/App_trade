import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O cliente XAU tem de recuperar sozinho de falhas do Twelve Data.
 * Antes, um erro no backfill do arranque (ex.: limite por minuto) deixava o ouro sem sinais até reiniciar.
 */
const fetchMock = vi.fn();
vi.mock("@/lib/marketdata/twelvedata-client", () => ({
  fetchTwelveDataOhlc: (...a: unknown[]) => fetchMock(...a),
  getTwelveDataCreditStats: () => ({ day: "x", used: 0, limit: 800, remaining: 800, pct: 0, byTf: {} }),
}));
vi.mock("@/lib/marketdata/candle-cache", () => ({
  loadCachedCandles: async () => [],
  saveCandlesToCache: async () => {},
  cacheStats: async () => ({}),
}));

const STEP: Record<string, number> = { H4: 4 * 3600_000, M15: 15 * 60_000, M5: 5 * 60_000 };
const candles = (tf: string, n: number) => {
  const end = Math.floor(Date.now() / STEP[tf]) * STEP[tf];
  return Array.from({ length: n }, (_, i) => {
    const p = 2650 + i * 0.1;
    return { time: end - (n - 1 - i) * STEP[tf], open: p, high: p + 1, low: p - 1, close: p, volume: 0 };
  });
};

describe("polling XAU (Twelve Data)", () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__tosXauClientV3;
    fetchMock.mockReset();
  });

  it("um TF que falha não pára os outros e é tentado de novo no ciclo seguinte", async () => {
    const { pollXauOnce, isXauReady, getXauMarketStatus } = await import("@/lib/marketdata/xtb-client");
    const tuesday = Date.UTC(2026, 10, 17, 10, 0);

    fetchMock.mockImplementation(async (tf: string, size: number) => {
      if (tf === "M15") throw new Error("You have run out of API credits for the current minute");
      return candles(tf, size);
    });
    await pollXauOnce(tuesday);
    expect(isXauReady()).toBe(false);
    expect(getXauMarketStatus().lastError).toMatch(/M15/);

    fetchMock.mockImplementation(async (tf: string, size: number) => candles(tf, size));
    await pollXauOnce(tuesday);
    expect(isXauReady()).toBe(true);
    expect(getXauMarketStatus().lastError).toBeUndefined();
    // Só o M15 voltou a pedir histórico completo; os outros já tinham barras.
    expect(fetchMock).toHaveBeenLastCalledWith("M15", 500);
  });

  it("emite preço para o motor quando os dados chegam", async () => {
    const { pollXauOnce, onXauTick } = await import("@/lib/marketdata/xtb-client");
    fetchMock.mockImplementation(async (tf: string, size: number) => candles(tf, size));
    const prices: number[] = [];
    onXauTick((t) => prices.push(t.price));
    await pollXauOnce(Date.UTC(2026, 10, 17, 10, 0));
    expect(prices.length).toBe(1);
    expect(prices[0]).toBeGreaterThan(2650);
  });

  it("ao fim-de-semana não gasta créditos se já tem histórico", async () => {
    const { pollXauOnce, xauMarketClosed } = await import("@/lib/marketdata/xtb-client");
    expect(xauMarketClosed(Date.UTC(2026, 10, 21, 12))).toBe(true); // sábado
    expect(xauMarketClosed(Date.UTC(2026, 10, 22, 23))).toBe(false); // domingo 23h UTC: já abriu
    fetchMock.mockImplementation(async (tf: string, size: number) => candles(tf, size));
    await pollXauOnce(Date.UTC(2026, 10, 17, 10, 0));
    const calls = fetchMock.mock.calls.length;
    expect(await pollXauOnce(Date.UTC(2026, 10, 21, 12))).toBe(false);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("depois de uma noite desligado pede as velas que faltam, não só 30", async () => {
    const { incrementalSize } = await import("@/lib/marketdata/xtb-client");
    const now = Date.UTC(2026, 10, 19, 8, 0);
    expect(incrementalSize("M5", now - 10 * 60_000, now)).toBe(30);
    // 10 h sem dados: 120 velas M5 + margem
    expect(incrementalSize("M5", now - 10 * 3600_000, now)).toBe(122);
    expect(incrementalSize("M15", now - 10 * 3600_000, now)).toBe(42);
    // nunca mais do que o backfill completo
    expect(incrementalSize("M5", now - 30 * 86400_000, now)).toBe(400);
  });

  it("feed parado com o mercado aberto fica marcado como stale", async () => {
    const { pollXauOnce, getXauFreshness } = await import("@/lib/marketdata/xtb-client");
    fetchMock.mockImplementation(async (tf: string, size: number) => candles(tf, size));
    await pollXauOnce(Date.UTC(2026, 10, 17, 10, 0));
    const last = Math.floor(Date.now() / STEP.M5) * STEP.M5;
    expect(getXauFreshness(last + 10 * 60_000).stale).toBe(false);
    const wed = new Date(last + 3 * 3600_000);
    const h = wed.getUTCHours();
    const closed = wed.getUTCDay() === 6 || wed.getUTCDay() === 0 || h === 21 || h === 22 || (wed.getUTCDay() === 5 && h >= 22);
    const f = getXauFreshness(last + 3 * 3600_000);
    expect(f.stale).toBe(!closed);
    if (!closed) expect(f.reason).toMatch(/feed do ouro parado/);
    // sábado nunca é stale
    expect(getXauFreshness(Date.UTC(2026, 10, 21, 12)).stale).toBe(false);
  });
});
