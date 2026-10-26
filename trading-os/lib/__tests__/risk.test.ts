import { describe, it, expect } from "vitest";
import {
  INSTRUMENTS,
  dailyGuard,
  deriveOutcome,
  positionSize,
  realizedR,
  suggestTakeProfit,
  validateLevels,
  validateTrade,
} from "@/lib/risk";

describe("validateLevels", () => {
  it("aceita LONG e SHORT coerentes", () => {
    expect(validateLevels("LONG", 4000, 3990, 4025)).toEqual([]);
    expect(validateLevels("SHORT", 80, 81, 77.5)).toEqual([]);
  });

  it("rejeita SL do lado errado (caso #11 do histórico)", () => {
    const errs = validateLevels("LONG", 2291.7, 2334.96, 2400);
    expect(errs.some((e) => e.includes("Stop Loss tem de estar abaixo"))).toBe(true);
  });

  it("rejeita TP em falta, zero ou do lado errado", () => {
    expect(validateLevels("LONG", 4000, 3990, null)).toContain("Take Profit em falta.");
    expect(validateLevels("LONG", 4000, 3990, 0)).toContain("Take Profit em falta.");
    expect(validateLevels("SHORT", 80, 81, 82).some((e) => e.includes("abaixo da entrada"))).toBe(true);
  });
});

describe("suggestTakeProfit / realizedR", () => {
  it("TP a 2,5R do lado certo", () => {
    expect(suggestTakeProfit("LONG", 4000, 3990)).toBe(4025);
    expect(suggestTakeProfit("SHORT", 80, 81)).toBe(77.5);
  });

  it("R realizado contra o SL inicial", () => {
    expect(realizedR("LONG", 4000, 3990, 4015)).toBeCloseTo(1.5);
    expect(realizedR("SHORT", 80, 81, 81)).toBeCloseTo(-1);
    expect(realizedR("LONG", 4000, 4000, 4010)).toBeNull();
  });
});

describe("deriveOutcome", () => {
  it("segue o sinal do P&L", () => {
    expect(deriveOutcome(5)).toBe("WIN");
    expect(deriveOutcome(-0.4)).toBe("LOSS");
    expect(deriveOutcome(0)).toBe("BE");
    expect(deriveOutcome(-0.4, 0.5)).toBe("BE");
  });
});

describe("positionSize", () => {
  it("bloqueia GOLD numa conta de 142 com SL de 11,3 USD", () => {
    const r = positionSize({ equity: 142, riskPct: 0.5, entry: 4065.65, sl: 4054.35, spec: INSTRUMENTS.XAUUSD });
    expect(r?.ok).toBe(false);
    expect(r?.minLotRisk).toBeCloseTo(11.3, 1);
    expect(r?.minLotRiskPct).toBeGreaterThan(7);
  });

  it("calcula lotes arredondados para baixo numa conta de 10 000", () => {
    const r = positionSize({ equity: 10000, riskPct: 0.5, entry: 4000, sl: 3990, spec: INSTRUMENTS.XAUUSD });
    // 50 de risco / (10 USD × 100 oz) = 0,05 lotes
    expect(r?.ok).toBe(true);
    expect(r?.lots).toBeCloseTo(0.05);
    expect(r?.actualRisk).toBeCloseTo(50);
  });

  it("converte a moeda da conta", () => {
    // Conta em EUR, 1 EUR = 1,10 USD → 50 EUR = 55 USD de risco
    const r = positionSize({ equity: 10000, riskPct: 0.5, entry: 80, sl: 79, spec: INSTRUMENTS.SOLUSD, usdPerAccountUnit: 1.1 });
    expect(r?.lots).toBeCloseTo(55);
  });
});

describe("dailyGuard", () => {
  it("fecha ao atingir a perda diária máxima", () => {
    const g = dailyGuard([-1.2, -1], 142);
    expect(g.dayLossPct).toBeCloseTo(1.549, 2);
    expect(g.blocked).toBe(true);
  });

  it("fecha com 2 perdas seguidas mesmo com perda pequena", () => {
    const g = dailyGuard([5, -0.1, -0.1], 10000);
    expect(g.consecutiveLosses).toBe(2);
    expect(g.blocked).toBe(true);
  });

  it("um ganho repõe a sequência", () => {
    expect(dailyGuard([-0.1, 2, -0.1], 10000).blocked).toBe(false);
  });
});

describe("validateTrade", () => {
  it("apanha preço incompatível com o activo (EUR/USD a 76 653)", () => {
    const errs = validateTrade({ pair: "EUR/USD", direction: "LONG", entry: 76653, stop_loss: 75745.9, take_profit: 80371 });
    expect(errs.some((e) => e.includes("fora do intervalo plausível de EURUSD"))).toBe(true);
  });

  it("aceita uma trade válida em GOLD", () => {
    expect(validateTrade({ pair: "GOLD", direction: "SHORT", entry: 4100, stop_loss: 4110, take_profit: 4075 })).toEqual([]);
  });
});
