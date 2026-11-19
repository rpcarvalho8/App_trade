import { describe, expect, it } from "vitest";
import { horizonForTimeframe, normalizeTimeframe, validateTradePlan, REQUIRED_CHECKLIST, type TradePlan } from "../trade-plan";

const allChecks = Object.fromEntries(REQUIRED_CHECKLIST.map((k) => [k, true]));

const base: TradePlan = {
  asset: "XAUUSD",
  direction: "long",
  horizon: "day",
  entryZone: { low: 2380, high: 2382 },
  stopLoss: 2376,
  targets: [{ price: 2400, label: "BSL" }],
  confluences: ["Spring", "OB M15"],
  checklist: allChecks,
};

describe("timeframes", () => {
  it("normaliza e classifica Day vs Swing", () => {
    expect(normalizeTimeframe("15m")).toBe("M15");
    expect(normalizeTimeframe("4H")).toBe("H4");
    expect(normalizeTimeframe("daily")).toBe("D1");
    expect(normalizeTimeframe("2H")).toBeNull();
    expect(horizonForTimeframe("M5")).toBe("day");
    expect(horizonForTimeframe("H1")).toBe("day");
    expect(horizonForTimeframe("H4")).toBe("swing");
    expect(horizonForTimeframe("W1")).toBe("swing");
    expect(horizonForTimeframe(null)).toBeNull();
  });
});

describe("validateTradePlan", () => {
  it("aceita um long coerente e calcula R:R do pior preço", () => {
    const v = validateTradePlan(base);
    expect(v.status).toBe("valid");
    expect(v.entryMid).toBe(2381);
    // pior entrada 2382, risco 6, recompensa 18 → 3R
    expect(v.rrWorst).toBe(3);
    expect(v.targetsRR[0].rr).toBe(3.8);
  });

  it("rejeita SL do lado errado num long (dentro ou acima da zona)", () => {
    expect(validateTradePlan({ ...base, stopLoss: 2381 }).status).toBe("rejected");
    expect(validateTradePlan({ ...base, stopLoss: 2390 }).errors.join()).toMatch(/abaixo de toda a zona/);
  });

  it("rejeita SL do lado errado num short", () => {
    const v = validateTradePlan({ ...base, direction: "short", stopLoss: 2381, targets: [{ price: 2360 }] });
    expect(v.status).toBe("rejected");
    expect(v.errors.join()).toMatch(/acima de toda a zona/);
  });

  it("rejeita R:R abaixo do mínimo", () => {
    const v = validateTradePlan({ ...base, targets: [{ price: 2388 }] });
    expect(v.status).toBe("rejected");
    expect(v.errors.join()).toMatch(/R:R/);
  });

  it("rejeita stop curto demais (ruído) e largo demais (prop)", () => {
    expect(validateTradePlan({ ...base, entryZone: { low: 2380, high: 2380.5 }, stopLoss: 2379.5, targets: [{ price: 2390 }] }).errors.join()).toMatch(/ruído/);
    expect(validateTradePlan({ ...base, stopLoss: 2350, targets: [{ price: 2500 }] }).errors.join()).toMatch(/máximo/);
  });

  it("descarta alvos do lado errado e gera TP automático quando não sobra nenhum", () => {
    const v = validateTradePlan({ ...base, targets: [{ price: 2370 }] });
    expect(v.autoTarget).toBe(true);
    expect(v.targetsRR[0].price).toBe(2382 + 6 * 2);
    expect(v.warnings.join()).toMatch(/lado errado/);
  });

  it("fica em 'watch' quando a checklist não está completa", () => {
    const v = validateTradePlan({ ...base, checklist: { ...allChecks, structure_shift_confirmed: false } });
    expect(v.status).toBe("watch");
    expect(v.missingChecklist).toEqual(["structure_shift_confirmed"]);
  });

  it("aceita zona invertida (low > high) e usa limites de swing na Solana", () => {
    const v = validateTradePlan({
      ...base,
      asset: "SOLUSD",
      horizon: "swing",
      entryZone: { low: 152, high: 148 },
      stopLoss: 144,
      targets: [{ price: 190 }, { price: 175 }],
    });
    expect(v.status).toBe("valid");
    expect(v.targetsRR.map((t) => t.price)).toEqual([175, 190]);
    expect(v.limits.rrMin).toBe(2.5);
  });
});
