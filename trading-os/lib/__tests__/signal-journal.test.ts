import { describe, it, expect } from "vitest";
import { buildPendingTrade, checkContraTrigger, maxStopDistance } from "@/lib/signal-journal";
import type { EngineSignal } from "@/lib/strategies/types";

const strategy = { id: "xauusd-london-structure", name: "London Structure", timeframes: { bias: "H4", entry: "M5" }, sequence: [] };
const t0 = Date.parse("2026-11-17T09:30:00Z");

const sig = (over: Partial<EngineSignal> = {}): EngineSignal => ({
  strategyId: "xauusd-london-structure",
  symbol: "XAUUSD",
  direction: "long",
  entry: 4065.65,
  stopLoss: 4054.35,
  takeProfit: 4093.9,
  rr: 2.5,
  rrMin: 2,
  confirmedSteps: [
    { step: 3, type: "liquidity_sweep", confluenceKeys: [], details: {}, confirmedAt: t0 },
    { step: 4, type: "mss_cisd", confluenceKeys: [], details: {}, confirmedAt: t0 },
  ],
  confluencesValidated: ["sweep_m15"],
  emittedAt: t0,
  audit: {},
  ...over,
});

describe("buildPendingTrade", () => {
  it("cria a linha pendente com TP1 a 1R, TP2 ao alvo, validade de 3 velas e invalidação no SL", () => {
    const t = buildPendingTrade(sig(), strategy, 7, { equity: 10000, usdPerAccountUnit: 1 })!;
    expect(t.outcome).toBe("PENDING");
    expect(t.setup).toBe("XAUUSD — London Structure");
    expect(t.direction).toBe("LONG");
    expect(t.tp1).toBeCloseTo(4065.65 + 11.3, 2);
    expect(t.take_profit).toBe(4093.9);
    expect(t.invalidation_price).toBe(4054.35);
    expect(Date.parse(t.expires_at) - t0).toBe(3 * 5 * 60_000);
    expect(t.session).toBe("London");
    expect(t.executable).toBe(1);
    // 10 000 × 0,5% = 50 USD ÷ (11,30 × 100 oz) = 0,044 → 0,04 lotes
    expect(t.lot_suggested).toBe(0.04);
    expect(t.tags).toContain("signal:7");
  });

  it("142 € no ouro: stop de 11,3 pts não é executável e o stop máximo é ~0,8 pts", () => {
    const acct = { equity: 142, usdPerAccountUnit: 1.16 };
    const t = buildPendingTrade(sig(), strategy, 8, acct)!;
    expect(t.executable).toBe(0);
    expect(t.lot_suggested).toBe(0);
    expect(t.max_stop).toBeCloseTo(0.82, 2);
    expect(maxStopDistance("XAUUSD", acct)).toBeCloseTo(0.8236, 3);
    expect(t.notes).toContain("NÃO EXECUTÁVEL");
  });

  it("sem capital conhecido não inventa lote", () => {
    const t = buildPendingTrade(sig(), strategy, 9, { equity: null })!;
    expect(t.lot_suggested).toBeNull();
    expect(t.executable).toBeNull();
  });

  it("rejeita sinais com SL do lado errado", () => {
    expect(buildPendingTrade(sig({ stopLoss: 4070 }), strategy, 10, { equity: 1000 })).toBeNull();
  });
});

describe("checkContraTrigger", () => {
  const active = { id: 1, symbol: "XAUUSD", direction: "long" as const, invalidationPrice: 4054.35, expiresAt: t0 + 15 * 60_000 };
  it("vivo enquanto o preço não passa a invalidação e a validade não acaba", () => {
    expect(checkContraTrigger(active, 4060, t0 + 60_000)).toBeNull();
  });
  it("invalida quando o preço passa o SL antes da ordem", () => {
    expect(checkContraTrigger(active, 4054, t0 + 60_000)?.type).toBe("invalidated");
    expect(checkContraTrigger({ ...active, direction: "short", invalidationPrice: 4070 }, 4071, t0)?.type).toBe("invalidated");
  });
  it("expira depois de 3 velas", () => {
    expect(checkContraTrigger(active, 4060, t0 + 16 * 60_000)?.type).toBe("expired");
  });
});
