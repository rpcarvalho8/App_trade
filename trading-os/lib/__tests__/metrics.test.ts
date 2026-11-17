import { describe, it, expect } from "vitest";
import { computeMetrics, equityCurve, isClosedOutcome } from "@/lib/metrics";

describe("computeMetrics", () => {
  const rows = [
    { pnl: 100, outcome: "WIN", rr_real: 2 },
    { pnl: -50, outcome: "LOSS", rr_real: -1 },
    { pnl: -50, outcome: "LOSS", rr_real: 1 }, // R antigo sem sinal: corrigido pelo P&L
    { pnl: 300, outcome: "WIN", rr_real: 3 },
    { pnl: 999, outcome: "RUNNING" },
    { pnl: 999, outcome: "PENDING" },
  ];
  const m = computeMetrics(rows);

  it("Profit Factor = soma dos ganhos / soma das perdas (não é o payoff)", () => {
    expect(m.grossProfit).toBe(400);
    expect(m.grossLoss).toBe(100);
    expect(m.profitFactor).toBeCloseTo(4);
    expect(m.payoff).toBeCloseTo(200 / 50);
  });

  it("PF e payoff divergem quando o win rate não é 50%", () => {
    const x = computeMetrics([
      { pnl: 100, outcome: "WIN" },
      { pnl: -50, outcome: "LOSS" },
      { pnl: -50, outcome: "LOSS" },
      { pnl: -50, outcome: "LOSS" },
    ]);
    expect(x.payoff).toBeCloseTo(2);
    expect(x.profitFactor).toBeCloseTo(100 / 150);
  });

  it("ignora RUNNING e PENDING", () => {
    expect(m.trades).toBe(4);
    expect(isClosedOutcome("PENDING")).toBe(false);
  });

  it("expectância em R com sinal e sequência de perdas", () => {
    expect(m.expectancyR).toBeCloseTo((2 - 1 - 1 + 3) / 4);
    expect(m.maxLosingStreak).toBe(2);
    expect(m.smallSample).toBe(true);
  });
});

describe("equityCurve", () => {
  it("drawdown em % do pico de capital, não do P&L acumulado", () => {
    const c = equityCurve(
      [
        { label: "d1", pnl: 5 },
        { label: "d2", pnl: -10 },
      ],
      1000
    );
    // Pico 1005 → 995: -0,995%, e não -300% como no cálculo antigo.
    expect(c.maxDrawdownPct).toBeCloseTo((10 / 1005) * 100);
    expect(c.maxDrawdownMoney).toBe(10);
  });

  it("sem capital conhecido só dá o drawdown em dinheiro", () => {
    const c = equityCurve([{ label: "d1", pnl: 5 }, { label: "d2", pnl: -10 }], 0);
    expect(c.maxDrawdownPct).toBe(0);
    expect(c.maxDrawdownMoney).toBe(10);
  });
});
