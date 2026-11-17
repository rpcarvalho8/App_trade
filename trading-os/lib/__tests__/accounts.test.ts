import { describe, expect, it } from "vitest";
import { brokerForSymbol, costInR, costsByBroker, netPnl, nextPeak, toEur, tradeFees, usdPerAccountUnit } from "@/lib/accounts";

describe("contas", () => {
  it("corretora por activo", () => {
    expect(brokerForSymbol("XAUUSD")).toBe("XTB");
    expect(brokerForSymbol("solusd")).toBe("Kraken");
    expect(brokerForSymbol("EURUSD")).toBeNull();
  });

  it("USD por unidade da conta", () => {
    expect(usdPerAccountUnit("EUR", 1.08)).toBe(1.08);
    expect(usdPerAccountUnit("EUR", null)).toBe(1);
    expect(usdPerAccountUnit("USD", 1.08)).toBe(1);
  });

  it("pico nunca desce", () => {
    expect(nextPeak(1000, 900)).toBe(1000);
    expect(nextPeak(1000, 1100)).toBe(1100);
    expect(nextPeak(null, 500)).toBe(500);
  });

  it("converte para EUR", () => {
    expect(toEur(108, "USD", 1.08)).toBeCloseTo(100);
    expect(toEur(100, "EUR", 1.08)).toBe(100);
    expect(toEur(100, "USD", null)).toBe(100);
  });
});

describe("custos", () => {
  it("P&L líquido desconta comissão e swap", () => {
    expect(tradeFees({ commission: 2, swap_funding: -0.5 })).toBeCloseTo(1.5);
    expect(netPnl({ pnl: 10, commission: 2, swap_funding: 1 })).toBe(7);
    expect(netPnl({ pnl: -5, commission: "", swap_funding: null })).toBe(-5);
  });

  it("custo em R", () => {
    // spread 0,2 com SL a 2 pontos = 0,1R; taxas 1 com risco 10 (20/2R) = 0,1R
    expect(costInR({ entry: 100, stop_loss: 98, spread_pts: 0.2, commission: 1, pnl: 20, rr_real: 2 })).toBeCloseTo(0.2);
    expect(costInR({ entry: 100, stop_loss: 98 })).toBeNull();
  });

  it("agrega por corretora", () => {
    const out = costsByBroker([
      { pair: "XAUUSD", pnl: 10, commission: 1 },
      { pair: "XAUUSD", pnl: -5, commission: 1 },
      { pair: "SOLUSD", pnl: 4, swap_funding: 0.5 },
      { pair: "EURUSD", pnl: 1 },
    ]);
    const xtb = out.find((b) => b.broker === "XTB")!;
    expect(xtb.trades).toBe(2);
    expect(xtb.fees).toBe(2);
    expect(xtb.netPnl).toBe(3);
    expect(xtb.grossPnl).toBe(5);
    expect(out.find((b) => b.broker === "Kraken")!.netPnl).toBe(3.5);
    expect(out.find((b) => b.broker === "Outra")!.trades).toBe(1);
  });
});
