import { describe, it, expect } from "vitest";
import {
  evaluateStrategy,
  createEngineState,
  calcRR,
  STRATEGY_XAUUSD,
  STRATEGY_SOLUSD,
} from "../index";
import type { Candle, EngineContext } from "../types";
import {
  xauSweepPositive,
  xauMssPositive,
  xauObFvgPositive,
  solSweepPositive,
  solChochPositive,
  solFvgPositive,
} from "../__fixtures__/candles";

/**
 * Sweep 15m de mínimos (bullish), espelho de solSweepPositive, com a vela do sweep a abrir
 * no início do fixture de 1m. O motor exige agora ChoCH na direcção do sweep e depois dele.
 */
const solSweepBullish: Candle[] = (() => {
  const shift = solChochPositive[0].time - solSweepPositive[solSweepPositive.length - 1].time;
  return solSweepPositive.map((b) => ({
    time: b.time + shift,
    open: 300 - b.open,
    high: 300 - b.low,
    low: 300 - b.high,
    close: 300 - b.close,
    volume: b.volume,
  }));
})();

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
        "15m": solSweepBullish,
        M15: solSweepBullish,
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

describe("evaluateStrategy SOLUSD full signal", () => {
  it("emite sinal quando 1→2→3 + R:R≥3 e confluences batem", () => {
    let state = createEngineState(STRATEGY_SOLUSD.id);
    // Keep 1m short so timeouts don't fire (sweep index near end)
    const m1Base = solChochPositive.slice(0, -1);
    const ctxSweep: EngineContext = {
      calendarClean: true,
      sessionOk: true,
      price: 150,
      spread: 0.01,
      stopLossLevel: 149,
      takeProfitLevel: 153, // RR = 3/1 = 3
      candlesByTf: {
        "15m": solSweepBullish,
        M15: solSweepBullish,
        "1m": m1Base,
        M1: m1Base,
      },
    };

    let r = evaluateStrategy(STRATEGY_SOLUSD, state, ctxSweep);
    expect(r.progressed).toBe(true);
    expect(r.signal).toBeNull();
    state = r.state;

    // Step 2: ChoCH with volume — use full choch fixture; keep sweep index recent
    state = { ...state, sweepCandleIndex: solChochPositive.length - 2 };
    r = evaluateStrategy(STRATEGY_SOLUSD, state, {
      ...ctxSweep,
      candlesByTf: {
        ...ctxSweep.candlesByTf,
        "1m": solChochPositive,
        M1: solChochPositive,
      },
    });
    expect(r.progressed).toBe(true);
    state = r.state;

    // Step 3: FVG golden + emit
    state = { ...state, sweepCandleIndex: solFvgPositive.length - 2 };
    r = evaluateStrategy(STRATEGY_SOLUSD, state, {
      ...ctxSweep,
      bias: state.bias || "bearish",
      price: 103.5,
      stopLossLevel: 102.5,
      takeProfitLevel: 106.5, // RR = 3
      candlesByTf: {
        ...ctxSweep.candlesByTf,
        "1m": solFvgPositive,
        M1: solFvgPositive,
      },
    });

    expect(r.signal).not.toBeNull();
    expect(r.signal!.strategyId).toBe("solusd-smc-3step");
    expect(r.signal!.rr).toBeGreaterThanOrEqual(3);
    expect(r.signal!.confluencesValidated.length).toBeGreaterThanOrEqual(
      STRATEGY_SOLUSD.confluences.length
    );
    expect(r.signal!.audit).toBeTruthy();
    expect(Object.keys(r.signal!.audit).length).toBeGreaterThan(0);
  });
});

describe("fixtures smoke", () => {
  it("carrega fixtures SOL", () => {
    expect(solChochPositive.length).toBeGreaterThan(20);
    expect(solFvgPositive.length).toBeGreaterThan(5);
  });
});

describe("evaluateStrategy valida o lado do SL/TP", () => {
  it("não emite sinal com o SL do lado errado da entrada", () => {
    let state = createEngineState(STRATEGY_SOLUSD.id);
    const m1Base = solChochPositive.slice(0, -1);
    const ctxSweep: EngineContext = {
      calendarClean: true,
      sessionOk: true,
      price: 150,
      spread: 0.01,
      stopLossLevel: 149,
      takeProfitLevel: 153,
      candlesByTf: { "15m": solSweepBullish, M15: solSweepBullish, "1m": m1Base, M1: m1Base },
    };
    let r = evaluateStrategy(STRATEGY_SOLUSD, state, ctxSweep);
    state = { ...r.state, sweepCandleIndex: solChochPositive.length - 2 };
    r = evaluateStrategy(STRATEGY_SOLUSD, state, {
      ...ctxSweep,
      candlesByTf: { ...ctxSweep.candlesByTf, "1m": solChochPositive, M1: solChochPositive },
    });
    state = { ...r.state, sweepCandleIndex: solFvgPositive.length - 2 };

    const step3: EngineContext = {
      ...ctxSweep,
      bias: state.bias || "bearish",
      price: 103.5,
      candlesByTf: { ...ctxSweep.candlesByTf, "1m": solFvgPositive, M1: solFvgPositive },
    };
    const long = (state.bias || "bearish") === "bullish";
    // SL e TP trocados de lado: R:R continua a dar 3 em valor absoluto.
    r = evaluateStrategy(STRATEGY_SOLUSD, state, {
      ...step3,
      stopLossLevel: long ? 104.5 : 102.5,
      takeProfitLevel: long ? 100.5 : 106.5,
    });
    expect(r.signal).toBeNull();
  });

  it("escolhe o TP do lado da direcção quando recebe os dois níveis", () => {
    let state = createEngineState(STRATEGY_SOLUSD.id);
    const m1Base = solChochPositive.slice(0, -1);
    const ctxSweep: EngineContext = {
      calendarClean: true,
      sessionOk: true,
      price: 150,
      spread: 0.01,
      stopLossLevel: 149,
      takeProfitLevel: 153,
      candlesByTf: { "15m": solSweepBullish, M15: solSweepBullish, "1m": m1Base, M1: m1Base },
    };
    let r = evaluateStrategy(STRATEGY_SOLUSD, state, ctxSweep);
    state = { ...r.state, sweepCandleIndex: solChochPositive.length - 2 };
    r = evaluateStrategy(STRATEGY_SOLUSD, state, {
      ...ctxSweep,
      candlesByTf: { ...ctxSweep.candlesByTf, "1m": solChochPositive, M1: solChochPositive },
    });
    state = { ...r.state, sweepCandleIndex: solFvgPositive.length - 2 };
    const long = (state.bias || "bearish") === "bullish";

    r = evaluateStrategy(STRATEGY_SOLUSD, state, {
      ...ctxSweep,
      bias: state.bias || "bearish",
      price: 103.5,
      stopLossLevel: long ? 102.5 : 104.5,
      takeProfitLevel: undefined,
      takeProfitLevels: { long: 107.5, short: 99.5 }, // R:R 4, não o TP por omissão a 3R
      candlesByTf: { ...ctxSweep.candlesByTf, "1m": solFvgPositive, M1: solFvgPositive },
    });
    expect(r.signal).not.toBeNull();
    expect(r.signal!.takeProfit).toBe(long ? 107.5 : 99.5);
  });

  it("não emite sinal SOL com SL abaixo da distância mínima (0,3%)", () => {
    let state = createEngineState(STRATEGY_SOLUSD.id);
    const m1Base = solChochPositive.slice(0, -1);
    const ctxSweep: EngineContext = {
      calendarClean: true,
      sessionOk: true,
      price: 150,
      spread: 0.01,
      stopLossLevel: 149,
      takeProfitLevel: 153,
      candlesByTf: { "15m": solSweepBullish, M15: solSweepBullish, "1m": m1Base, M1: m1Base },
    };
    let r = evaluateStrategy(STRATEGY_SOLUSD, state, ctxSweep);
    state = { ...r.state, sweepCandleIndex: solChochPositive.length - 2 };
    r = evaluateStrategy(STRATEGY_SOLUSD, state, {
      ...ctxSweep,
      candlesByTf: { ...ctxSweep.candlesByTf, "1m": solChochPositive, M1: solChochPositive },
    });
    state = { ...r.state, sweepCandleIndex: solFvgPositive.length - 2 };
    const long = (state.bias || "bearish") === "bullish";

    // Caso real: SL a 0,02 da entrada → R:R 54, mas o stop é ruído.
    r = evaluateStrategy(STRATEGY_SOLUSD, state, {
      ...ctxSweep,
      bias: state.bias || "bearish",
      price: 100.34,
      stopLossLevel: long ? 100.32 : 100.36,
      takeProfitLevel: long ? 101.43 : 99.25,
      candlesByTf: { ...ctxSweep.candlesByTf, "1m": solFvgPositive, M1: solFvgPositive },
    });
    expect(r.signal).toBeNull();
    expect(r.reason).toBe("stop_too_tight");
    expect(r.state.lastInvalidation).toBe("stop_too_tight");
  });

  it("usa o alvo de 3R quando a liquidez fica mais perto (não descarta o setup)", () => {
    let state = createEngineState(STRATEGY_SOLUSD.id);
    const m1Base = solChochPositive.slice(0, -1);
    const ctxSweep: EngineContext = {
      calendarClean: true,
      sessionOk: true,
      price: 150,
      spread: 0.01,
      stopLossLevel: 149,
      takeProfitLevel: 153,
      candlesByTf: { "15m": solSweepBullish, M15: solSweepBullish, "1m": m1Base, M1: m1Base },
    };
    let r = evaluateStrategy(STRATEGY_SOLUSD, state, ctxSweep);
    state = { ...r.state, sweepCandleIndex: solChochPositive.length - 2 };
    r = evaluateStrategy(STRATEGY_SOLUSD, state, {
      ...ctxSweep,
      candlesByTf: { ...ctxSweep.candlesByTf, "1m": solChochPositive, M1: solChochPositive },
    });
    state = { ...r.state, sweepCandleIndex: solFvgPositive.length - 2 };
    const long = (state.bias || "bearish") === "bullish";

    // Liquidez a só 1R da entrada: antes o setup era descartado por R:R < 3.
    r = evaluateStrategy(STRATEGY_SOLUSD, state, {
      ...ctxSweep,
      bias: state.bias || "bearish",
      price: 103.5,
      stopLossLevel: long ? 102.5 : 104.5,
      takeProfitLevel: undefined,
      takeProfitLevels: { long: 104.5, short: 102.5 },
      candlesByTf: { ...ctxSweep.candlesByTf, "1m": solFvgPositive, M1: solFvgPositive },
    });
    expect(r.signal).not.toBeNull();
    expect(r.signal!.takeProfit).toBe(long ? 106.5 : 100.5);
    expect(r.signal!.rr).toBeCloseTo(3);
  });
});

describe("timeouts por tempo (buffer cheio)", () => {
  it("expira o setup SOL mesmo com o índice da vela congelado", () => {
    const now = Date.now();
    const m1 = Array.from({ length: 800 }, (_, i) => ({
      time: now - (800 - i) * 60_000,
      open: 150,
      high: 150.1,
      low: 149.9,
      close: 150,
      volume: 50,
    }));
    const state = {
      ...createEngineState(STRATEGY_SOLUSD.id),
      currentStepIndex: 1,
      sweepCandleIndex: m1.length - 1, // buffer cheio: o índice não avança
      sweepConfirmedAt: now - 45 * 60_000,
      bias: "bullish" as const,
      sweepDirection: "bullish" as const,
    };
    const r = evaluateStrategy(STRATEGY_SOLUSD, state, {
      now,
      calendarClean: true,
      price: 150,
      candlesByTf: { M1: m1, "1m": m1, M15: [], "15m": [] },
    });
    expect(r.invalidated).toBe(true);
    expect(r.reason).toMatch(/maxCandles/);
  });
});

describe("XAU: sweep tem de ser a favor do bias H4", () => {
  it("rejeita sweep de máximos com bias bullish", () => {
    const bearishSweep = xauSweepPositive.map((b) => ({
      ...b,
      open: 5300 - b.open,
      high: 5300 - b.low,
      low: 5300 - b.high,
      close: 5300 - b.close,
    }));
    const state = {
      ...createEngineState(STRATEGY_XAUUSD.id),
      currentStepIndex: 2,
      bias: "bullish" as const,
      confirmed: [],
    };
    const r = evaluateStrategy(STRATEGY_XAUUSD, state, {
      calendarClean: true,
      bias: "bullish",
      price: 2650,
      candlesByTf: { M15: bearishSweep, M5: xauObFvgPositive },
    });
    expect(r.progressed).toBe(false);
    expect(r.reason).toBe("sweep_against_bias");
  });
});
