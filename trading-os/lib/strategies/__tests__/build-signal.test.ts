import { describe, expect, it } from "vitest";
import { createEngineState, evaluateStrategy, STRATEGY_SOLUSD } from "../index";
import type { Candle, EngineContext, EngineState, StrategyDefinition } from "../types";
import { solChochPositive, solFvgPositive, solSweepPositive } from "../__fixtures__/candles";

/** Sweep 15m de mínimos (espelho do fixture), alinhado com o início do fixture de 1m. */
const sweepBullish: Candle[] = (() => {
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

/** Leva a SOL 3-step até ao último passo (FVG golden ratio); devolve o estado e o contexto base. */
function reachStep3(strategy: StrategyDefinition): { state: EngineState; ctx: EngineContext; long: boolean } {
  const m1Base = solChochPositive.slice(0, -1);
  const ctx0: EngineContext = {
    calendarClean: true,
    sessionOk: true,
    price: 150,
    spread: 0.01,
    candlesByTf: { "15m": sweepBullish, M15: sweepBullish, "1m": m1Base, M1: m1Base },
  };
  let r = evaluateStrategy(strategy, createEngineState(strategy.id), ctx0);
  let state: EngineState = { ...r.state, sweepCandleIndex: solChochPositive.length - 2 };
  r = evaluateStrategy(strategy, state, {
    ...ctx0,
    candlesByTf: { ...ctx0.candlesByTf, "1m": solChochPositive, M1: solChochPositive },
  });
  state = { ...r.state, sweepCandleIndex: solFvgPositive.length - 2 };
  const long = (state.bias || "bearish") === "bullish";
  const ctx: EngineContext = {
    ...ctx0,
    bias: state.bias || "bearish",
    price: 103.5,
    candlesByTf: { ...ctx0.candlesByTf, "1m": solFvgPositive, M1: solFvgPositive },
  };
  return { state, ctx, long };
}

/** Níveis a `risk` de distância da entrada (103.5) para o lado certo, com TP a `rr` R. */
const levels = (long: boolean, risk: number, rr: number) => ({
  stopLossLevel: long ? 103.5 - risk : 103.5 + risk,
  takeProfitLevel: long ? 103.5 + risk * rr : 103.5 - risk * rr,
});

describe("buildSignal (via passo final da SOL 3-step)", () => {
  it("referência: com níveis válidos emite sinal", () => {
    const { state, ctx, long } = reachStep3(STRATEGY_SOLUSD);
    const r = evaluateStrategy(STRATEGY_SOLUSD, state, { ...ctx, ...levels(long, 1, 3) });
    expect(r.signal).not.toBeNull();
    expect(r.signal!.direction).toBe(long ? "long" : "short");
  });

  it("rejeita com rr_below_min quando o TP explícito dá menos de 3R", () => {
    const { state, ctx, long } = reachStep3(STRATEGY_SOLUSD);
    const r = evaluateStrategy(STRATEGY_SOLUSD, state, { ...ctx, ...levels(long, 1, 2) });
    expect(r.signal).toBeNull();
    expect(r.reason).toBe("rr_below_min");
    expect(r.invalidated).toBe(true);
  });

  it("rejeita com stop_too_wide quando a estratégia define maxStopPct", () => {
    const strat: StrategyDefinition = { ...STRATEGY_SOLUSD, risk: { ...STRATEGY_SOLUSD.risk, maxStopPct: 0.5 } };
    const { state, ctx, long } = reachStep3(strat);
    // 1 / 103.5 ≈ 0,97 % > 0,5 %
    const r = evaluateStrategy(strat, state, { ...ctx, ...levels(long, 1, 3) });
    expect(r.signal).toBeNull();
    expect(r.reason).toBe("stop_too_wide");
  });

  it("rejeita com spread_too_wide quando o spread passa metade do FVG", () => {
    const { state, ctx, long } = reachStep3(STRATEGY_SOLUSD);
    const r = evaluateStrategy(STRATEGY_SOLUSD, state, { ...ctx, ...levels(long, 1, 3), spread: 100 });
    expect(r.signal).toBeNull();
    expect(r.reason).toBe("spread_too_wide");
  });

  it("com spread curto a confluência spread_below_50pct_fvg fica auditada", () => {
    const { state, ctx, long } = reachStep3(STRATEGY_SOLUSD);
    const r = evaluateStrategy(STRATEGY_SOLUSD, state, { ...ctx, ...levels(long, 1, 3), spread: 0.001 });
    expect(r.signal!.confluencesValidated).toContain("spread_below_50pct_fvg");
    expect(r.signal!.audit.spread_below_50pct_fvg.type).toBe("spread_gate");
  });

  it("sem spread no contexto não emite (spread_unknown) e não gasta o gatilho", () => {
    const { state, ctx, long } = reachStep3(STRATEGY_SOLUSD);
    const r = evaluateStrategy(STRATEGY_SOLUSD, state, { ...ctx, ...levels(long, 1, 3), spread: undefined });
    expect(r.signal).toBeNull();
    expect(r.reason).toBe("spread_unknown");
    // Mesmo sweep volta a ser elegível quando o spread chegar.
    expect(r.state.usedAnchors ?? []).toHaveLength(0);
  });

  it("rejeita com confluences_missing se a estratégia pede uma chave que nenhum passo cobre", () => {
    const strat: StrategyDefinition = { ...STRATEGY_SOLUSD, confluences: [...STRATEGY_SOLUSD.confluences, "chave_sem_passo"] };
    const { state, ctx, long } = reachStep3(strat);
    const r = evaluateStrategy(strat, state, { ...ctx, ...levels(long, 1, 3) });
    expect(r.signal).toBeNull();
    expect(r.reason).toBe("confluences_missing");
  });

  it("audita rr_min e sequence_1_2_3_no_skip com os passos confirmados", () => {
    const { state, ctx, long } = reachStep3(STRATEGY_SOLUSD);
    const r = evaluateStrategy(STRATEGY_SOLUSD, state, { ...ctx, ...levels(long, 1, 3) });
    const a = r.signal!.audit;
    expect(a.rr_min_3.type).toBe("rr_gate");
    expect(a.sequence_1_2_3_no_skip.details.steps).toEqual([1, 2, 3]);
  });

  it("usa a liquidez do runner como TP só quando fica além do alvo mínimo", () => {
    const { state, ctx, long } = reachStep3(STRATEGY_SOLUSD);
    const base = { ...ctx, stopLossLevel: long ? 102.5 : 104.5, takeProfitLevel: undefined };
    const far = evaluateStrategy(STRATEGY_SOLUSD, state, { ...base, takeProfitLevels: { long: 108.5, short: 98.5 } });
    expect(far.signal!.takeProfit).toBe(long ? 108.5 : 98.5);
    const near = evaluateStrategy(STRATEGY_SOLUSD, state, { ...base, takeProfitLevels: { long: 104.5, short: 102.5 } });
    expect(near.signal!.takeProfit).toBe(long ? 106.5 : 100.5);
  });
});
