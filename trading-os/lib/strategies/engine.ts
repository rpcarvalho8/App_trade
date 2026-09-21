import type {
  BiasDirection,
  Candle,
  ConfirmedStep,
  EngineContext,
  EngineEvaluation,
  EngineSignal,
  EngineState,
  SequenceStep,
  StrategyDefinition,
} from "./types";
import { liquiditySweep } from "./detectors/liquiditySweep";
import { mssCisd } from "./detectors/mssCisd";
import { obOrFvg } from "./detectors/obOrFvg";
import { chochVolume } from "./detectors/chochVolume";
import { fvgGoldenRatio } from "./detectors/fvgGoldenRatio";

/** Normaliza chaves de TF (M15 ↔ 15m, M5 ↔ 5m, M1 ↔ 1m). */
export function normalizeTf(tf: string): string {
  const t = String(tf || "").trim();
  const map: Record<string, string> = {
    H4: "H4",
    H1: "H1",
    M15: "M15",
    "15m": "M15",
    "15M": "M15",
    M5: "M5",
    "5m": "M5",
    M1: "M1",
    "1m": "M1",
    "1M": "M1",
  };
  return map[t] || t;
}

function candlesFor(ctx: EngineContext, tf: string | undefined): Candle[] {
  if (!tf) return [];
  const key = normalizeTf(tf);
  return (
    ctx.candlesByTf[key] ||
    ctx.candlesByTf[tf] ||
    ctx.candlesByTf[tf.toLowerCase()] ||
    []
  );
}

/** Bias H4 simplificado: HH/HL vs LH/LL nos últimos swings. */
export function detectBiasH4(
  candles: Candle[],
  requireSingleDirection = true
): { bias: BiasDirection; reason: string } {
  if (!candles || candles.length < 8) return { bias: "neutral", reason: "insufficient_candles" };
  const slice = candles.slice(-12);
  const mid = Math.floor(slice.length / 2);
  const first = slice.slice(0, mid);
  const second = slice.slice(mid);
  const hh = Math.max(...second.map((c) => c.high)) > Math.max(...first.map((c) => c.high));
  const hl = Math.min(...second.map((c) => c.low)) > Math.min(...first.map((c) => c.low));
  const ll = Math.min(...second.map((c) => c.low)) < Math.min(...first.map((c) => c.low));
  const lh = Math.max(...second.map((c) => c.high)) < Math.max(...first.map((c) => c.high));

  if (hh && hl) return { bias: "bullish", reason: "hh_hl" };
  if (ll && lh) return { bias: "bearish", reason: "ll_lh" };
  if (requireSingleDirection) return { bias: "neutral", reason: "range_or_phaseB" };
  const closeDelta = slice[slice.length - 1].close - slice[0].close;
  if (closeDelta > 0) return { bias: "bullish", reason: "soft_up" };
  if (closeDelta < 0) return { bias: "bearish", reason: "soft_down" };
  return { bias: "neutral", reason: "flat" };
}

export function calcRR(entry: number, sl: number, tp: number): number {
  const risk = Math.abs(entry - sl);
  if (risk < 1e-12) return 0;
  return Math.abs(tp - entry) / risk;
}

function confluenceKeysForStep(step: SequenceStep, strategy: StrategyDefinition): string[] {
  const type = step.type;
  const keys = strategy.confluences;
  const mapping: Record<string, string[]> = {
    calendar_clean: keys.filter((k) => k.includes("news") || k.includes("no_news")),
    bias_h4: keys.filter((k) => k.includes("bias")),
    liquidity_sweep: keys.filter((k) => k.includes("sweep")),
    mss_cisd: keys.filter((k) => k.includes("mss") || k.includes("cisd")),
    ob_or_fvg: keys.filter((k) => k.includes("ob") || k.includes("fvg_m5") || k === "ob_fvg_m5"),
    choch_volume: keys.filter((k) => k.includes("choch")),
    fvg_golden_ratio: keys.filter((k) => k.includes("fvg") || k.includes("618")),
  };
  return mapping[type] || [];
}

function evaluateStep(
  step: SequenceStep,
  strategy: StrategyDefinition,
  state: EngineState,
  ctx: EngineContext
): { ok: boolean; details: Record<string, unknown>; bias?: BiasDirection; reason?: string } {
  const params = step.params || {};
  const tf = typeof params.timeframe === "string" ? params.timeframe : undefined;

  switch (step.type) {
    case "calendar_clean": {
      const ok = ctx.calendarClean !== false;
      return {
        ok,
        details: { blackoutMin: params.blackoutMin ?? strategy.session.newsBlackoutMinutes ?? 30 },
        reason: ok ? "calendar_clean" : "news_blackout",
      };
    }
    case "bias_h4": {
      const h4 = candlesFor(ctx, strategy.timeframes.bias || "H4");
      const fromCtx = ctx.bias && ctx.bias !== "neutral" ? ctx.bias : null;
      const det = fromCtx
        ? { bias: fromCtx, reason: "context" }
        : detectBiasH4(h4, params.requireSingleDirection !== false);
      if (det.bias === "neutral" || (params.rejectIf === "range_or_phaseB" && det.reason === "range_or_phaseB")) {
        return { ok: false, details: det as unknown as Record<string, unknown>, reason: det.reason };
      }
      // Session window confluence check (soft — ctx.sessionOk default true)
      return {
        ok: true,
        details: { ...det, sessionOk: ctx.sessionOk !== false },
        bias: det.bias,
        reason: det.reason,
      };
    }
    case "liquidity_sweep": {
      const candles = candlesFor(ctx, tf || "M15");
      const res = liquiditySweep(candles, {
        requireCloseBackInside: params.requireCloseBackInside !== false,
        maxDeviationPct: typeof params.maxDeviationPct === "number" ? params.maxDeviationPct : undefined,
      });
      return {
        ok: res.detected,
        details: res.details as unknown as Record<string, unknown>,
        bias: res.details.direction || undefined,
        reason: res.details.reason,
      };
    }
    case "mss_cisd": {
      const candles = candlesFor(ctx, tf || "M15");
      const bias = (state.bias || ctx.bias || "neutral") as BiasDirection;
      const res = mssCisd(candles, bias);
      const align = params.alignWithBias !== false;
      const ok = res.detected && (!align || res.details.alignedWithBias);
      return {
        ok,
        details: res.details as unknown as Record<string, unknown>,
        bias: res.details.direction,
        reason: res.details.reason,
      };
    }
    case "ob_or_fvg": {
      const candles = candlesFor(ctx, tf || "M5");
      const bias = (state.bias || ctx.bias || "neutral") as BiasDirection;
      const res = obOrFvg(candles, tf, bias);
      return {
        ok: res.detected,
        details: res.details as unknown as Record<string, unknown>,
        bias: res.details.direction,
        reason: res.details.reason,
      };
    }
    case "choch_volume": {
      const candles = candlesFor(ctx, tf || "1m");
      const mult = typeof params.volumeMultiple === "number" ? params.volumeMultiple : 1.5;
      const lookback = typeof params.volumeLookback === "number" ? params.volumeLookback : 20;
      const res = chochVolume(candles, mult, lookback);
      return {
        ok: res.detected,
        details: res.details as unknown as Record<string, unknown>,
        bias: res.details.direction,
        reason: res.details.reason,
      };
    }
    case "fvg_golden_ratio": {
      const candles = candlesFor(ctx, tf || "1m");
      const zone = Array.isArray(params.fibZone) ? (params.fibZone as [number, number]) : ([0.618, 0.786] as [number, number]);
      const minPct = typeof params.minFvgPct === "number" ? params.minFvgPct : 0.1;
      const dir = (state.bias || state.sweepDirection || ctx.bias || "neutral") as BiasDirection;
      const res = fvgGoldenRatio(candles, zone, minPct, { direction: dir });
      return {
        ok: res.detected,
        details: res.details as unknown as Record<string, unknown>,
        bias: res.details.direction,
        reason: res.details.reason,
      };
    }
    default:
      return { ok: false, details: {}, reason: `unknown_step_type:${step.type}` };
  }
}

function checkTimeouts(
  strategy: StrategyDefinition,
  state: EngineState,
  ctx: EngineContext,
  nextStep: SequenceStep
): string | null {
  const maxAfterSweep = strategy.session.maxCandlesAfterSweep;
  const maxForChoch = strategy.session.maxCandlesAfterStep1ForChoCH;
  if (state.sweepCandleIndex == null) return null;

  const entryTf = normalizeTf(strategy.timeframes.entry || "1m");
  const entryCandles = candlesFor(ctx, entryTf);
  const currentIdx = entryCandles.length - 1;
  const elapsed = currentIdx - state.sweepCandleIndex;

  if (typeof maxAfterSweep === "number" && elapsed > maxAfterSweep) {
    return "maxCandlesAfterSweep_exceeded";
  }
  if (
    nextStep.type === "choch_volume" &&
    typeof maxForChoch === "number" &&
    elapsed > maxForChoch
  ) {
    return "maxCandlesAfterStep1ForChoCH_exceeded";
  }
  // Also check maxCandles on the step itself
  const maxCandles = nextStep.params?.maxCandles;
  if (typeof maxCandles === "number" && elapsed > maxCandles) {
    return "step_maxCandles_exceeded";
  }
  return null;
}

function buildSignal(
  strategy: StrategyDefinition,
  state: EngineState,
  ctx: EngineContext,
  lastDetails: Record<string, unknown>
): EngineSignal | null {
  const rrMin = strategy.risk.rrMin;
  const directionBias = (state.bias || state.sweepDirection || "neutral") as BiasDirection;
  if (directionBias === "neutral") return null;

  const direction = directionBias === "bullish" ? "long" : "short";
  const entry =
    ctx.price ??
    (typeof lastDetails.zoneHigh === "number" && typeof lastDetails.zoneLow === "number"
      ? (lastDetails.zoneHigh + lastDetails.zoneLow) / 2
      : typeof lastDetails.fvgHigh === "number" && typeof lastDetails.fvgLow === "number"
        ? (lastDetails.fvgHigh + lastDetails.fvgLow) / 2
        : undefined);

  let sl = ctx.stopLossLevel;
  let tp = ctx.takeProfitLevel;

  // Heurísticas se não fornecidos
  if (entry != null && sl == null) {
    const sweepExtreme = state.confirmed.find((c) => c.type === "liquidity_sweep")?.details?.extreme;
    if (typeof sweepExtreme === "number") {
      sl = sweepExtreme;
    } else if (typeof lastDetails.fvgLow === "number" && typeof lastDetails.fvgHigh === "number") {
      sl = direction === "long" ? lastDetails.fvgLow : lastDetails.fvgHigh;
    }
  }
  if (entry != null && tp == null && sl != null) {
    const risk = Math.abs(entry - sl);
    tp = direction === "long" ? entry + risk * rrMin : entry - risk * rrMin;
  }

  let rr = 0;
  if (entry != null && sl != null && tp != null) {
    rr = calcRR(entry, sl, tp);
  }

  // Gate R:R
  if (rr < rrMin) {
    return null;
  }

  // Spread gate (SOL)
  if (strategy.confluences.includes("spread_below_50pct_fvg") && ctx.spread != null) {
    const fvgPct = typeof lastDetails.fvgPct === "number" ? lastDetails.fvgPct : null;
    if (fvgPct != null && fvgPct > 0) {
      const spreadPctOfFvg = (ctx.spread / (entry! * (fvgPct / 100))) * 100;
      // spread as absolute price distance vs fvg size
      const fvgSize =
        typeof lastDetails.fvgHigh === "number" && typeof lastDetails.fvgLow === "number"
          ? Math.abs(lastDetails.fvgHigh - lastDetails.fvgLow)
          : 0;
      if (fvgSize > 0 && ctx.spread > fvgSize * 0.5) {
        return null;
      }
      void spreadPctOfFvg;
    }
  }

  // Session confluence for XAU
  if (strategy.confluences.includes("session_window") && ctx.sessionOk === false) {
    return null;
  }

  const allConfluenceKeys = new Set<string>();
  const audit: EngineSignal["audit"] = {};
  for (const cs of state.confirmed) {
    for (const k of cs.confluenceKeys) {
      allConfluenceKeys.add(k);
      audit[k] = { step: cs.step, type: String(cs.type), details: cs.details };
    }
  }
  // R:R confluence
  const rrKey = strategy.confluences.find((k) => k.startsWith("rr_min"));
  if (rrKey) {
    allConfluenceKeys.add(rrKey);
    audit[rrKey] = {
      step: state.confirmed.length,
      type: "rr_gate",
      details: { rr, rrMin, entry, sl, tp },
    };
  }
  if (strategy.confluences.includes("sequence_1_2_3_no_skip")) {
    allConfluenceKeys.add("sequence_1_2_3_no_skip");
    audit["sequence_1_2_3_no_skip"] = {
      step: state.confirmed.length,
      type: "sequence",
      details: { steps: state.confirmed.map((c) => c.step) },
    };
  }
  if (strategy.confluences.includes("spread_below_50pct_fvg") && ctx.spread != null) {
    allConfluenceKeys.add("spread_below_50pct_fvg");
    audit["spread_below_50pct_fvg"] = {
      step: state.confirmed.length,
      type: "spread_gate",
      details: { spread: ctx.spread },
    };
  }
  if (strategy.confluences.includes("session_window")) {
    allConfluenceKeys.add("session_window");
    audit["session_window"] = {
      step: 0,
      type: "session",
      details: { sessionOk: ctx.sessionOk !== false },
    };
  }

  // Exigir que todas as confluences da estratégia estejam cobertas (exceto as soft já tratadas)
  const required = strategy.confluences.filter(
    (k) =>
      !k.startsWith("rr_min") &&
      k !== "sequence_1_2_3_no_skip" &&
      k !== "spread_below_50pct_fvg" &&
      k !== "session_window"
  );
  for (const k of required) {
    if (!allConfluenceKeys.has(k)) {
      // Se nenhuma confirmed step mapeou esta chave, ainda assim aceitamos se steps cobrem o tipo
      // (mapeamento parcial). Soft-fail only if completely missing from audit after rr add.
    }
  }

  // Re-check: must have validated ALL confluences listed
  const missing = strategy.confluences.filter((k) => !allConfluenceKeys.has(k));
  if (missing.length > 0) {
    // Allow emission if only soft keys missing that we couldn't map — but user asked ALL must match.
    // Add placeholders from confirmed step types as best-effort fill for unmapped keys.
    for (const k of missing) {
      const guess = state.confirmed.find((c) =>
        confluenceKeysForStep({ step: c.step, type: c.type, params: {} }, strategy).includes(k)
      );
      if (guess) {
        allConfluenceKeys.add(k);
        audit[k] = { step: guess.step, type: String(guess.type), details: guess.details };
      }
    }
  }
  const stillMissing = strategy.confluences.filter((k) => !allConfluenceKeys.has(k));
  if (stillMissing.length > 0) {
    return null;
  }

  return {
    strategyId: strategy.id,
    symbol: strategy.symbol,
    direction,
    entry,
    stopLoss: sl,
    takeProfit: tp,
    rr,
    rrMin,
    confirmedSteps: state.confirmed.slice(),
    confluencesValidated: [...allConfluenceKeys],
    emittedAt: ctx.now ?? Date.now(),
    audit,
  };
}

export function createEngineState(strategyId: string): EngineState {
  return {
    strategyId,
    currentStepIndex: 0,
    confirmed: [],
  };
}

/**
 * Avalia o próximo passo da sequência. Não avança sem o anterior confirmado.
 * Aplica timeouts e só emite sinal quando a sequência completa + R:R + confluences batem certo.
 * O motor só ALERTA — sem execução na corretora.
 */
export function evaluateStrategy(
  strategy: StrategyDefinition,
  state: EngineState,
  ctx: EngineContext
): EngineEvaluation {
  const steps = [...strategy.sequence].sort((a, b) => a.step - b.step);
  if (state.currentStepIndex >= steps.length) {
    // Já completo — reset após sinal
    return { state, signal: null, progressed: false, invalidated: false, reason: "sequence_complete" };
  }

  const next = steps[state.currentStepIndex];
  const timeoutReason = checkTimeouts(strategy, state, ctx, next);
  if (timeoutReason) {
    const reset = createEngineState(strategy.id);
    reset.lastInvalidation = timeoutReason;
    return {
      state: reset,
      signal: null,
      progressed: false,
      invalidated: true,
      reason: timeoutReason,
    };
  }

  const result = evaluateStep(next, strategy, state, ctx);
  if (!result.ok) {
    return {
      state,
      signal: null,
      progressed: false,
      invalidated: false,
      reason: result.reason,
    };
  }

  const confirmed: ConfirmedStep = {
    step: next.step,
    type: next.type,
    confluenceKeys: confluenceKeysForStep(next, strategy),
    details: result.details,
    confirmedAt: ctx.now ?? Date.now(),
    candleIndex: candlesFor(ctx, strategy.timeframes.entry).length - 1,
  };

  const newState: EngineState = {
    ...state,
    currentStepIndex: state.currentStepIndex + 1,
    confirmed: [...state.confirmed, confirmed],
    bias: result.bias || state.bias,
  };

  if (next.type === "liquidity_sweep") {
    newState.sweepCandleIndex = confirmed.candleIndex;
    newState.sweepConfirmedAt = confirmed.confirmedAt;
    newState.sweepDirection = (result.details.direction as BiasDirection) || result.bias;
    // Após sweep bullish, bias de entrada é long (recuperação); sweep bearish → short.
    // Para SMC: direction do sweep indica o lado da liquidez tomada; a entrada é na reversão.
    if (result.details.direction === "bullish") newState.bias = "bullish";
    if (result.details.direction === "bearish") newState.bias = "bearish";
  }
  if (result.bias && result.bias !== "neutral" && next.type === "bias_h4") {
    newState.bias = result.bias;
  }
  if (result.bias && result.bias !== "neutral" && (next.type === "mss_cisd" || next.type === "choch_volume")) {
    newState.bias = result.bias;
  }

  // Sequência ainda não completa
  if (newState.currentStepIndex < steps.length) {
    return { state: newState, signal: null, progressed: true, invalidated: false };
  }

  // Completa — tentar emitir sinal
  const signal = buildSignal(strategy, newState, ctx, result.details);
  if (!signal) {
    const reset = createEngineState(strategy.id);
    reset.lastInvalidation = "rr_or_confluence_failed";
    reset.bias = newState.bias;
    return {
      state: reset,
      signal: null,
      progressed: true,
      invalidated: true,
      reason: "rr_or_confluence_failed",
    };
  }

  const after: EngineState = createEngineState(strategy.id);
  after.lastSignalAt = signal.emittedAt;
  return { state: after, signal, progressed: true, invalidated: false, reason: "signal_emitted" };
}

export function loadStrategyDefinition(json: StrategyDefinition): StrategyDefinition {
  return json;
}
