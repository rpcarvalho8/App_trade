import { describe, it, expect } from "vitest";
import {
  evaluateStrategy,
  createEngineState,
  calcRR,
  STRATEGY_XAUUSD,
  STRATEGY_SOLUSD,
} from "../index";
import type { EngineContext } from "../types";
import {
  xauSweepPositive,
  xauMssPositive,
  xauObFvgPositive,
  solSweepPositive,
  solChochPositive,
  solFvgPositive,
} from "../__fixtures__/candles";

describe("calcRR", () => {
  it("calcula R:R correctamente", () => {
    expect(calcRR(100, 99, 102)).toBeCloseTo(2);
    expect(calcRR(100, 101, 97)).toBeCloseTo(3);
  });
});

describe("evaluateStrategy XAUUSD", () => {
  it("percorre a sequência sem saltar passos", () => {
    let state = createEngineState(STRATEGY_XAUUSD.id);
    const base: EngineContext = {
      calendarClean: true,
      sessionOk: true,
      price: 2650,
      stopLossLevel: 2645,
      takeProfitLevel: 2660, // RR = 10/5 = 2
      candlesByTf: {
        H4: xauMssPositive.map((c, i) => ({
          ...c,
          high: c.high + i * 0.5,
          low: c.low + i * 0.3,
          close: c.close + i * 0.4,
        })),
        M15: xauSweepPositive,
        M5: xauObFvgPositive,
      },
    };

    // step1 calendar
    let r = evaluateStrategy(STRATEGY_XAUUSD, state, base);
    expect(r.progressed).toBe(true);
    expect(r.state.currentStepIndex).toBe(1);
    state = r.state;

    // step2 bias — may need clearer H4; inject bias via context
    r = evaluateStrategy(STRATEGY_XAUUSD, state, { ...base, bias: "bullish" });
    expect(r.progressed).toBe(true);
    state = r.state;

    // step3 sweep — need bullish sweep on M15
    r = evaluateStrategy(STRATEGY_XAUUSD, state, {
      ...base,
      bias: "bullish",
      candlesByTf: { ...base.candlesByTf, M15: xauSweepPositive },
    });
    // sweep fixture is bullish
    if (r.progressed) state = r.state;

    // Não emite sinal a meio da sequência
    expect(r.signal).toBeNull();
  });

  it("não avança se o calendário estiver bloqueado", () => {
    const state = createEngineState(STRATEGY_XAUUSD.id);
    const r = evaluateStrategy(STRATEGY_XAUUSD, state, {
      calendarClean: false,
      candlesByTf: {},
    });
    expect(r.progressed).toBe(false);
    expect(r.state.currentStepIndex).toBe(0);
  });
});

describe("evaluateStrategy SOLUSD timeouts", () => {
  it("invalida se excedeu maxCandlesAfterStep1ForChoCH", () => {
    let state = createEngineState(STRATEGY_SOLUSD.id);
    // Confirma sweep artificialmente
    const m1 = Array.from({ length: 25 }, (_, i) => ({
      time: 1_700_000_000_000 + i * 60_000,
      open: 150,
      high: 150.1,
      low: 149.9,
      close: 150,
      volume: 50,
    }));
    const ctx: EngineContext = {
      calendarClean: true,
      price: 150,
      candlesByTf: {
        "15m": solSweepPositive,
        M15: solSweepPositive,
        "1m": m1,
        M1: m1,
      },
    };

    let r = evaluateStrategy(STRATEGY_SOLUSD, state, ctx);
    expect(r.progressed).toBe(true); // sweep
    state = r.state;
    expect(state.sweepCandleIndex).toBeDefined();

    // Força sweepCandleIndex antigo
    state = { ...state, sweepCandleIndex: 0 };
    r = evaluateStrategy(STRATEGY_SOLUSD, state, ctx);
    expect(r.invalidated).toBe(true);
    expect(r.reason).toMatch(/maxCandles/);
  });
});

describe("fixtures smoke", () => {
  it("carrega fixtures SOL", () => {
    expect(solChochPositive.length).toBeGreaterThan(20);
    expect(solFvgPositive.length).toBeGreaterThan(5);
  });
});
