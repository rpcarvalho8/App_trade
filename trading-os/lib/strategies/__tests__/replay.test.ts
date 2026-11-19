import { describe, expect, it } from "vitest";
import { replayStrategies } from "@/lib/strategies/replay";
import { STRATEGIES_BY_SYMBOL } from "@/lib/strategies";
import { aggregateCandles } from "@/lib/marketdata/ohlc-utils";
import type { Candle } from "@/lib/strategies/types";

/** Random walk determinístico tipo ouro (M5), com mercado 24/5. */
function walk(days: number, end: number): Candle[] {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out: Candle[] = [];
  let p = 4000;
  const start = Math.floor((end - days * 86_400_000) / 300_000) * 300_000;
  for (let t = start; t < end; t += 300_000) {
    const d = new Date(t).getUTCDay();
    if (d === 6 || d === 0) continue;
    const o = p;
    const c = o + (rnd() - 0.5) * 6;
    out.push({ time: t, open: o, high: Math.max(o, c) + rnd() * 2, low: Math.min(o, c) - rnd() * 2, close: c, volume: 100 });
    p = c;
  }
  return out;
}

describe("replay do motor XAU", () => {
  it("corre sobre histórico e conta onde a sequência pára", () => {
    const end = Date.UTC(2026, 10, 19, 16, 0);
    const M5 = walk(40, end);
    const data = { M5, M15: aggregateCandles(M5, "M15"), H4: aggregateCandles(M5, "H4") };
    const reports = replayStrategies(STRATEGIES_BY_SYMBOL.XAUUSD, data, end - 3 * 86_400_000, end);
    expect(reports).toHaveLength(2);
    for (const r of reports) {
      expect(r.cycles).toBeGreaterThan(500);
      expect(Object.keys(r.waiting).length + r.signals.length).toBeGreaterThan(0);
    }
    console.log(JSON.stringify(reports.map((r) => ({ id: r.strategyId, signals: r.signals.length, confirmed: r.confirmed, waiting: r.waiting, invalidated: r.invalidated })), null, 1));
  });
});

describe("replay com janela horária", () => {
  it("fora da janela não avalia", () => {
    const end = Date.UTC(2026, 10, 19, 16, 0);
    const M5 = walk(40, end);
    const data = { M5, M15: aggregateCandles(M5, "M15"), H4: aggregateCandles(M5, "H4") };
    const all = replayStrategies(STRATEGIES_BY_SYMBOL.XAUUSD, data, end - 3 * 86_400_000, end);
    const win = replayStrategies(STRATEGIES_BY_SYMBOL.XAUUSD, data, end - 3 * 86_400_000, end, { utcHours: [7, 20] });
    expect(win[1].cycles).toBeLessThan(all[1].cycles);
    for (const sg of win.flatMap((r) => r.signals)) {
      const h = Number(sg.at.slice(11, 13));
      expect(h >= 7 && h < 20).toBe(true);
    }
  });
});

describe("velas fechadas", () => {
  it("a vela em formação não entra no buffer", async () => {
    const { onlyClosed } = await import("@/lib/marketdata/xtb-client");
    const t = Date.UTC(2026, 10, 18, 15, 0);
    const bars = [0, 1, 2].map((i) => ({ time: t + i * 900_000, open: 1, high: 1, low: 1, close: 1, volume: 0 }));
    // pedido às 15:30:10 → a vela das 15:30 está em formação
    expect(onlyClosed(bars, "M15", t + 1_800_000 + 10_000).map((b) => b.time)).toEqual([t, t + 900_000]);
  });
});
