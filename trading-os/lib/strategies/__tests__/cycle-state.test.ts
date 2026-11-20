import { describe, expect, it } from "vitest";
import {
  createEngineState,
  evaluateStrategy,
  runStrategyCycle,
  STRATEGY_SOLUSD,
} from "../index";
import type { Candle, ConfirmedStep, EngineContext, EngineState, StrategyDefinition } from "../types";
import { solChochPositive, solSweepPositive } from "../__fixtures__/candles";

/** Estratégia mínima: calendário → bias → sweep (que nunca confirma com buffers vazios). */
const mini: StrategyDefinition = {
  id: "mini",
  symbol: "TEST",
  name: "mini",
  category: "test",
  timeframes: { bias: "H4", trigger: "M15", entry: "M5" },
  session: {},
  sequence: [
    { step: 1, type: "calendar_clean", params: {} },
    { step: 2, type: "bias_h4", params: {} },
    { step: 3, type: "liquidity_sweep", params: { timeframe: "M15" } },
  ],
  confluences: [],
  invalidation: [],
  risk: { normalPct: 1, reducedPct: 0.5, rrMin: 2 },
  kill: { consecutiveLosses: 2, pauseMinutes: 30, maxTradesPerDay: 2, maxDailyDrawdownPct: 1, blockIf: {} },
};

const ctx = (over: Partial<EngineContext> = {}): EngineContext => ({
  now: 1_800_000_000_000,
  calendarClean: true,
  bias: "bullish",
  candlesByTf: {},
  ...over,
});

const confirmedStep = (step: number, type: string, details: Record<string, unknown> = {}): ConfirmedStep => ({
  step,
  type,
  confluenceKeys: [],
  details,
  confirmedAt: 0,
});

/** Estado com calendário e bias já confirmados (bullish), à espera do sweep. */
const armed = (extra: Partial<EngineState> = {}): EngineState => ({
  ...createEngineState(mini.id),
  currentStepIndex: 2,
  confirmed: [confirmedStep(1, "calendar_clean"), confirmedStep(2, "bias_h4", { bias: "bullish" })],
  bias: "bullish",
  ...extra,
});

describe("runStrategyCycle", () => {
  it("avança vários passos num só ciclo e pára no que ainda não confirma", () => {
    const r = runStrategyCycle(mini, createEngineState(mini.id), ctx());
    expect(r.signal).toBeNull();
    expect(r.state.currentStepIndex).toBe(2);
    expect(r.evaluations).toHaveLength(3);
    expect(r.evaluations.map((e) => e.progressed)).toEqual([true, true, false]);
    expect(r.evaluations[2].reason).toBe("no_sweep");
  });

  it("pára logo na primeira avaliação que invalida", () => {
    const r = runStrategyCycle(mini, armed(), ctx({ calendarClean: false }));
    expect(r.evaluations).toHaveLength(1);
    expect(r.evaluations[0].invalidated).toBe(true);
    expect(r.evaluations[0].reason).toBe("news_blackout");
    expect(r.state.currentStepIndex).toBe(0);
  });

  it("sequência já completa não reavalia nada", () => {
    const done = { ...createEngineState(mini.id), currentStepIndex: 3 };
    const r = evaluateStrategy(mini, done, ctx());
    expect(r.reason).toBe("sequence_complete");
    expect(r.progressed).toBe(false);
    expect(r.state).toBe(done);
  });

  it("ordena a sequência por número de passo, não pela ordem do array", () => {
    const shuffled: StrategyDefinition = { ...mini, sequence: [...mini.sequence].reverse() };
    const r = runStrategyCycle(shuffled, createEngineState(mini.id), ctx());
    expect(r.state.confirmed.map((c) => c.type)).toEqual(["calendar_clean", "bias_h4"]);
  });
});

describe("gateLost (passos porta revalidados)", () => {
  it("o calendário a fechar a meio do setup deita-o abaixo", () => {
    const r = evaluateStrategy(mini, armed(), ctx({ calendarClean: false }));
    expect(r.invalidated).toBe(true);
    expect(r.reason).toBe("news_blackout");
  });

  it("o bias a inverter depois do passo de bias invalida com bias_changed", () => {
    const r = evaluateStrategy(mini, armed(), ctx({ bias: "bearish" }));
    expect(r.invalidated).toBe(true);
    expect(r.reason).toBe("bias_changed");
  });

  it("o bias a ficar neutro também invalida", () => {
    const r = evaluateStrategy(mini, armed(), ctx({ bias: "neutral" }));
    expect(r.reason).toBe("bias_changed");
  });

  it("com as portas intactas não invalida", () => {
    const r = evaluateStrategy(mini, armed(), ctx());
    expect(r.invalidated).toBe(false);
    expect(r.reason).toBe("no_sweep");
  });
});

describe("usedAnchors / pendingAnchors", () => {
  it("motivos duradouros (bias_changed) gastam o gatilho pendente", () => {
    const r = evaluateStrategy(mini, armed({ pendingAnchors: ["sweep:1"], usedAnchors: ["sweep:0"] }), ctx({ bias: "bearish" }));
    expect(r.state.usedAnchors).toEqual(["sweep:0", "sweep:1"]);
    expect(r.state.pendingAnchors).toBeUndefined();
    expect(r.state.lastInvalidation).toBe("bias_changed");
  });

  it("news_blackout não gasta o gatilho: o mesmo sweep pode voltar", () => {
    const r = evaluateStrategy(mini, armed({ pendingAnchors: ["sweep:1"], usedAnchors: ["sweep:0"] }), ctx({ calendarClean: false }));
    expect(r.state.usedAnchors).toEqual(["sweep:0"]);
  });

  it("mantém só os últimos 50 gatilhos usados", () => {
    const many = Array.from({ length: 60 }, (_, i) => `sweep:${i}`);
    const r = evaluateStrategy(mini, armed({ pendingAnchors: ["sweep:new"], usedAnchors: many }), ctx({ bias: "bearish" }));
    expect(r.state.usedAnchors).toHaveLength(50);
    expect(r.state.usedAnchors![49]).toBe("sweep:new");
    expect(r.state.usedAnchors![0]).toBe("sweep:11");
  });

  it("preserva lastSignalAt ao repor o estado", () => {
    const r = evaluateStrategy(mini, armed({ lastSignalAt: 123 }), ctx({ bias: "bearish" }));
    expect(r.state.lastSignalAt).toBe(123);
  });

  it("um sweep invalidado por timeout não volta a gerar setup (SOL)", () => {
    const shift = solChochPositive[0].time - solSweepPositive[solSweepPositive.length - 1].time;
    const sweep: Candle[] = solSweepPositive.map((b) => ({
      time: b.time + shift,
      open: 300 - b.open,
      high: 300 - b.low,
      low: 300 - b.high,
      close: 300 - b.close,
      volume: b.volume,
    }));
    const m1: Candle[] = Array.from({ length: 25 }, (_, i) => ({
      time: 1_700_000_000_000 + i * 60_000,
      open: 150,
      high: 150.1,
      low: 149.9,
      close: 150,
      volume: 50,
    }));
    const c: EngineContext = {
      calendarClean: true,
      price: 150,
      candlesByTf: { "15m": sweep, M15: sweep, "1m": m1, M1: m1 },
    };
    let r = evaluateStrategy(STRATEGY_SOLUSD, createEngineState(STRATEGY_SOLUSD.id), c);
    expect(r.progressed).toBe(true);
    expect(r.state.pendingAnchors).toHaveLength(1);
    const anchor = r.state.pendingAnchors![0];

    r = evaluateStrategy(STRATEGY_SOLUSD, { ...r.state, sweepCandleIndex: 0 }, c);
    expect(r.invalidated).toBe(true);
    expect(r.state.usedAnchors).toContain(anchor);

    // Mesmos dados: o sweep usado é saltado. (O fixture tem outro sweep numa vela anterior da janela,
    // que é um gatilho distinto e pode armar; o que não pode é rearmar o mesmo.)
    r = evaluateStrategy(STRATEGY_SOLUSD, r.state, c);
    expect(r.state.pendingAnchors ?? []).not.toContain(anchor);
    expect(r.state.usedAnchors).toContain(anchor);
  });
});
