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
import { atr, findDrawLevel, findHtfZones, findTappedZone, swingPivots, type HtfZone } from "./detectors/htfZones";
import { validateLevels } from "@/lib/risk";

const TF_MS: Record<string, number> = {
  H4: 4 * 3_600_000,
  H1: 3_600_000,
  M15: 15 * 60_000,
  M5: 5 * 60_000,
  M1: 60_000,
};

/** Duração de uma vela do TF em ms. */
export function tfMs(tf: string | undefined): number {
  return TF_MS[normalizeTf(tf || "")] || 60_000;
}

/**
 * Só velas FECHADAS. A vela em formação muda a cada tick: um wick a meio da vela não é
 * um sweep e um fecho provisório não é uma quebra de estrutura.
 */
export function closedCandles(candles: Candle[], tf: string | undefined, now: number): Candle[] {
  const ms = tfMs(tf);
  let end = candles.length;
  while (end > 0 && candles[end - 1].time + ms > now) end--;
  return end === candles.length ? candles : candles.slice(0, end);
}

/**
 * Corre um detector sobre as últimas `recent` velas fechadas (a mais recente primeiro).
 * Antes só se olhava para a última vela, que é a que ainda está em formação.
 */
function scanRecent<T extends { detected: boolean }>(
  candles: Candle[],
  recent: number,
  detect: (slice: Candle[]) => T,
  accept: (res: T, barTime: number) => boolean = () => true
): { res: T; barTime: number } | { res: T | null; barTime: null } {
  let first: T | null = null;
  for (let k = 0; k < recent && candles.length - k > 0; k++) {
    const slice = k === 0 ? candles : candles.slice(0, candles.length - k);
    const res = detect(slice);
    if (first == null) first = res;
    const barTime = slice[slice.length - 1].time;
    if (res.detected && accept(res, barTime)) return { res, barTime };
  }
  return { res: first, barTime: null };
}

/** Normaliza chaves de TF (M15 ↔ 15m, M5 ↔ 5m, M1 ↔ 1m). */
export function normalizeTf(tf: string): string {
  const t = String(tf || "").trim();
  const map: Record<string, string> = {
    H4: "H4",
    "4h": "H4",
    "4H": "H4",
    "240m": "H4",
    H1: "H1",
    "1h": "H1",
    "1H": "H1",
    "60m": "H1",
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

/**
 * Bias H4 pela estrutura: o último BOS (fecho para lá do último swing confirmado) define a direcção.
 *
 * Antes exigia máximos E mínimos mais altos em 12 velas: qualquer pullback ou consolidação
 * dava "neutral" e a estratégia ficava parada. Um pullback dentro de uma tendência não muda
 * o bias; só um fecho para lá do swing oposto o muda.
 */
export function detectBiasH4(
  candles: Candle[],
  requireSingleDirection = true
): { bias: BiasDirection; reason: string } {
  if (!candles || candles.length < 8) return { bias: "neutral", reason: "insufficient_candles" };
  const slice = candles.slice(-80);
  const { highs, lows } = swingPivots(slice, 2);
  let bias: BiasDirection = "neutral";
  let reason = "no_bos";
  let hi = 0;
  let lo = 0;
  let lastHigh: number | null = null;
  let lastLow: number | null = null;
  for (let i = 0; i < slice.length; i++) {
    // Um pivot só fica confirmado 2 velas depois.
    while (hi < highs.length && highs[hi].i + 2 <= i) lastHigh = highs[hi++].v;
    while (lo < lows.length && lows[lo].i + 2 <= i) lastLow = lows[lo++].v;
    const c = slice[i];
    if (lastHigh != null && c.close > lastHigh) {
      bias = "bullish";
      reason = "bos_up";
      lastHigh = null;
    } else if (lastLow != null && c.close < lastLow) {
      bias = "bearish";
      reason = "bos_down";
      lastLow = null;
    }
  }
  if (bias !== "neutral") return { bias, reason };
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
    htf_zone_tap: keys.filter((k) => k.includes("zone") || k.includes("bias")),
    ltf_mss: keys.filter((k) => k.includes("ltf_mss")),
    choch_volume: keys.filter((k) => k.includes("choch")),
    fvg_golden_ratio: keys.filter((k) => k.includes("fvg") || k.includes("618")),
  };
  return mapping[type] || [];
}

type StepResult = {
  ok: boolean;
  details: Record<string, unknown>;
  bias?: BiasDirection;
  reason?: string;
  /** Identificador do gatilho (sweep / zona) — cada um só gera um setup. */
  anchor?: string;
  anchorAt?: number;
  zone?: HtfZone;
};

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Parâmetros de zona por TF (maxAgeBars pode vir por TF: { "H4": 60, "H1": 72 }). */
function zoneParams(params: Record<string, unknown>, tf: string) {
  const age = params.maxAgeBars;
  const key = normalizeTf(tf);
  return {
    atrPeriod: num(params.atrPeriod, 14),
    displacementAtr: num(params.displacementAtr, 1.2),
    minGapAtr: num(params.minGapAtr, 0.25),
    maxObAtr: num(params.maxObAtr, 2.5),
    maxAgeBars:
      age && typeof age === "object" ? num((age as Record<string, unknown>)[key], 60) : num(age, 60),
  };
}

/** O sweep falhou se, depois dele, uma vela fechou para lá do extremo varrido. */
function sweepFailedAfter(candles: Candle[], barTime: number, direction: string | null, extreme: number | null): boolean {
  if (extreme == null || !direction) return false;
  return candles.some((c) => c.time > barTime && (direction === "bullish" ? c.close < extreme : c.close > extreme));
}

function evaluateStep(
  step: SequenceStep,
  strategy: StrategyDefinition,
  state: EngineState,
  ctx: EngineContext
): StepResult {
  const params = step.params || {};
  const tf = typeof params.timeframe === "string" ? params.timeframe : undefined;
  const now = ctx.now ?? Date.now();
  const recent = num(params.recentBars, 3);
  const used = new Set(state.usedAnchors || []);
  const fail = (reason: string, details: Record<string, unknown> = {}): StepResult => ({ ok: false, details, reason });

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
      // Só velas H4 fechadas: um fecho provisório não é BOS.
      const biasTf = strategy.timeframes.bias || "H4";
      const h4 = closedCandles(candlesFor(ctx, biasTf), biasTf, now);
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
      const stf = tf || "M15";
      const candles = closedCandles(candlesFor(ctx, stf), stf, now);
      // Com passo de bias, o sweep tem de ser a favor dele (bias bullish → varrer mínimos).
      const hasBiasStep = strategy.sequence.some((st) => st.type === "bias_h4");
      const wantDir = hasBiasStep && state.bias && state.bias !== "neutral" ? state.bias : null;
      const found = scanRecent(
        candles,
        recent,
        (sl) =>
          liquiditySweep(sl, {
            requireCloseBackInside: params.requireCloseBackInside !== false,
            maxDeviationPct: typeof params.maxDeviationPct === "number" ? params.maxDeviationPct : undefined,
          }),
        (res, t) =>
          !used.has(`sweep:${t}`) &&
          (!wantDir || res.details.direction === wantDir) &&
          !sweepFailedAfter(candles, t, res.details.direction, res.details.extreme)
      );
      if (found.barTime == null) {
        const r = found.res;
        const reason = r?.detected && wantDir && r.details.direction !== wantDir ? "sweep_against_bias" : r?.details.reason || "no_sweep";
        return fail(reason, (r?.details || {}) as unknown as Record<string, unknown>);
      }
      return {
        ok: true,
        details: { ...(found.res.details as unknown as Record<string, unknown>), barTime: found.barTime },
        bias: found.res.details.direction || undefined,
        reason: found.res.details.reason,
        anchor: `sweep:${found.barTime}`,
        anchorAt: found.barTime,
      };
    }
    case "mss_cisd": {
      const mtf = tf || "M15";
      const candles = closedCandles(candlesFor(ctx, mtf), mtf, now);
      const bias = (state.bias || ctx.bias || "neutral") as BiasDirection;
      const after = state.sweepAt ?? 0;
      const found = scanRecent(candles, recent, (sl) => mssCisd(sl, bias), (_r, t) => t >= after);
      const align = params.alignWithBias !== false;
      if (found.barTime == null || (align && !found.res.details.alignedWithBias)) {
        return fail(found.res?.details.reason || "no_mss", (found.res?.details || {}) as unknown as Record<string, unknown>);
      }
      return {
        ok: true,
        details: { ...(found.res.details as unknown as Record<string, unknown>), barTime: found.barTime },
        bias: found.res.details.direction,
        reason: found.res.details.reason,
      };
    }
    case "ob_or_fvg": {
      const otf = tf || "M5";
      const candles = closedCandles(candlesFor(ctx, otf), otf, now);
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
      const ctf = tf || "1m";
      const candles = closedCandles(candlesFor(ctx, ctf), ctf, now);
      const mult = typeof params.volumeMultiple === "number" ? params.volumeMultiple : 1.5;
      const lookback = typeof params.volumeLookback === "number" ? params.volumeLookback : 20;
      // ChoCH na direcção da reversão do sweep (sweep de mínimos → ChoCH bullish), depois do sweep.
      const wantDir = state.sweepDirection && state.sweepDirection !== "neutral" ? state.sweepDirection : null;
      const after = state.sweepAt ?? 0;
      const found = scanRecent(
        candles,
        recent,
        (sl) => chochVolume(sl, mult, lookback),
        (res, t) => t >= after && (!wantDir || res.details.direction === wantDir)
      );
      if (found.barTime == null) {
        const r = found.res;
        const reason = r?.detected && wantDir && r.details.direction !== wantDir ? "choch_against_sweep" : r?.details.reason || "no_choch";
        return fail(reason, (r?.details || {}) as unknown as Record<string, unknown>);
      }
      return {
        ok: true,
        details: { ...(found.res.details as unknown as Record<string, unknown>), barTime: found.barTime },
        bias: found.res.details.direction,
        reason: found.res.details.reason,
      };
    }
    case "fvg_golden_ratio": {
      const gtf = tf || "1m";
      const candles = closedCandles(candlesFor(ctx, gtf), gtf, now);
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
    case "htf_zone_tap": {
      const zoneTfs = Array.isArray(params.zoneTimeframes) ? (params.zoneTimeframes as string[]) : ["H4", "H1"];
      const biasTf = typeof params.biasTimeframe === "string" ? params.biasTimeframe : "H4";
      const requireAlign = params.requireBiasAlignment !== false;
      const biasCandles = closedCandles(candlesFor(ctx, biasTf), biasTf, now);
      const bias =
        ctx.bias && ctx.bias !== "neutral" ? { bias: ctx.bias, reason: "context" } : detectBiasH4(biasCandles, true);
      if (requireAlign && bias.bias === "neutral") return fail("bias_neutral", bias as unknown as Record<string, unknown>);
      if (ctx.price == null) return fail("no_price");
      const zonesByTf = zoneTfs.map((ztf) => {
        const cc = closedCandles(candlesFor(ctx, ztf), ztf, now);
        return { tf: normalizeTf(ztf), zones: findHtfZones(cc, normalizeTf(ztf), zoneParams(params, ztf)), closedCount: cc.length };
      });
      const zone = findTappedZone(zonesByTf, ctx.price, bias.bias, {
        requireBiasAlignment: requireAlign,
        toleranceAtr: num(params.toleranceAtr, 0.1),
        exclude: [...used].filter((u) => u.startsWith("zone:")).map((u) => u.slice(5)),
      });
      if (!zone) {
        const fresh = zonesByTf.reduce((n, z) => n + z.zones.filter((x) => !x.broken && x.firstTouchIndex == null).length, 0);
        return fail("no_zone_tap", { bias: bias.bias, freshZones: fresh });
      }
      return {
        ok: true,
        details: { zone, zoneHigh: zone.high, zoneLow: zone.low, bias: bias.bias, biasReason: bias.reason },
        bias: zone.direction,
        reason: `${zone.direction}_${zone.kind}_${zone.tf}_tap`,
        anchor: `zone:${zone.id}`,
        anchorAt: now,
        zone,
      };
    }
    case "ltf_mss": {
      const zone = state.zone;
      if (!zone) return fail("no_zone");
      const ltf = tf || "M5";
      const candles = closedCandles(candlesFor(ctx, ltf), ltf, now);
      const after = (state.tapAt ?? 0) - tfMs(ltf);
      const found = scanRecent(candles, recent, (sl) => mssCisd(sl, zone.direction), (_r, t) => t >= after);
      if (found.barTime == null) return fail(found.res?.details.reason || "no_ltf_mss");
      const entry = ctx.price;
      if (entry == null) return fail("no_price");
      const direction = zone.direction === "bullish" ? "long" : "short";
      // SL para lá do extremo do toque na zona (desde uma vela HTF antes do toque) + buffer de ATR.
      const since = (state.tapAt ?? now) - tfMs(zone.tf);
      const touchBars = candles.filter((c) => c.time >= since);
      const bars = touchBars.length ? touchBars : candles.slice(-6);
      const atrTf = typeof params.atrTimeframe === "string" ? params.atrTimeframe : "M15";
      const a = atr(closedCandles(candlesFor(ctx, atrTf), atrTf, now), 14) || zone.atr * 0.25;
      const buf = num(params.slBufferAtr, 0.1) * a;
      const extreme = direction === "long" ? Math.min(...bars.map((c) => c.low)) : Math.max(...bars.map((c) => c.high));
      const stopLoss = direction === "long" ? extreme - buf : extreme + buf;
      const risk = Math.abs(entry - stopLoss);
      // TP: zona oposta / swing H4 (o destino da rotação). Limitado a rrCap; sem destino → fallbackRR.
      const zoneTfs = Array.isArray(params.drawTimeframes) ? (params.drawTimeframes as string[]) : ["H4", "H1"];
      const allZones = zoneTfs.flatMap((ztf) =>
        findHtfZones(closedCandles(candlesFor(ctx, ztf), ztf, now), normalizeTf(ztf), zoneParams(params, ztf))
      );
      const swingTf = typeof params.swingTimeframe === "string" ? params.swingTimeframe : "H4";
      // Só conta como destino um nível a ≥ rrMin: um obstáculo mais perto não serve de TP.
      const draw = findDrawLevel(
        direction,
        entry,
        allZones,
        closedCandles(candlesFor(ctx, swingTf), swingTf, now).slice(-80),
        risk * strategy.risk.rrMin
      );
      const cap = num(params.rrCap, 4);
      const fallback = num(params.fallbackRR, 3);
      const sign = direction === "long" ? 1 : -1;
      let takeProfit = draw ? draw.level : entry + sign * risk * fallback;
      if (risk > 0 && Math.abs(takeProfit - entry) / risk > cap) takeProfit = entry + sign * risk * cap;
      return {
        ok: true,
        details: {
          ...(found.res.details as unknown as Record<string, unknown>),
          barTime: found.barTime,
          stopLoss,
          takeProfit,
          extreme,
          drawSource: draw?.source ?? "fallback_rr",
          drawLevel: draw?.level ?? null,
          zoneId: zone.id,
        },
        bias: zone.direction,
        reason: found.res.details.reason,
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
  const now = ctx.now ?? Date.now();
  // Zona HTF partida: uma M15 fechou para lá do extremo oposto da zona depois do toque.
  if (state.zone && state.tapAt != null) {
    const z = state.zone;
    const m15 = closedCandles(candlesFor(ctx, "M15"), "M15", now).filter((c) => c.time >= state.tapAt! - tfMs("M15"));
    if (m15.some((c) => (z.direction === "bullish" ? c.close < z.low : c.close > z.high))) return "zone_broken";
  }

  const anchorAt = state.sweepConfirmedAt ?? state.tapAt;
  if (state.sweepCandleIndex == null && anchorAt == null) return null;

  const maxAfterSweep = strategy.session.maxCandlesAfterSweep;
  const maxForChoch = strategy.session.maxCandlesAfterStep1ForChoCH;
  const entryTf = normalizeTf(strategy.timeframes.entry || "1m");
  // Antes contava índices de vela: com o buffer cheio o índice congela e nada expirava.
  // Agora conta tempo real em velas do TF de entrada (e mantém o índice como mínimo).
  const byTime = anchorAt != null ? Math.floor((now - anchorAt) / tfMs(entryTf)) : 0;
  const entryCandles = candlesFor(ctx, entryTf);
  const byIndex = state.sweepCandleIndex != null ? entryCandles.length - 1 - state.sweepCandleIndex : 0;
  const elapsed = Math.max(byTime, byIndex);

  if (typeof maxAfterSweep === "number" && elapsed > maxAfterSweep) {
    return "maxCandlesAfterSweep_exceeded";
  }
  if (nextStep.type === "choch_volume" && typeof maxForChoch === "number" && elapsed > maxForChoch) {
    return "maxCandlesAfterStep1ForChoCH_exceeded";
  }
  const maxCandles = nextStep.params?.maxCandles;
  if (typeof maxCandles === "number" && elapsed > maxCandles) {
    return "step_maxCandles_exceeded";
  }
  return null;
}

/** Passos "porta" (calendário, bias) revalidados a cada ciclo: se deixarem de valer, o setup cai. */
const GATE_STEPS = new Set(["calendar_clean", "bias_h4"]);

function gateLost(strategy: StrategyDefinition, state: EngineState, ctx: EngineContext): string | null {
  for (const cs of state.confirmed) {
    if (!GATE_STEPS.has(String(cs.type))) continue;
    const step = strategy.sequence.find((st) => st.step === cs.step);
    if (!step) continue;
    const r = evaluateStep(step, strategy, state, ctx);
    if (!r.ok) return cs.type === "calendar_clean" ? "news_blackout" : "bias_changed";
    if (cs.type === "bias_h4" && r.bias && cs.details.bias && r.bias !== cs.details.bias) return "bias_changed";
  }
  // Rotação: a zona armada tem de continuar a favor do bias H4 (fechado).
  if (state.zone) {
    const tapStep = strategy.sequence.find((st) => st.type === "htf_zone_tap");
    if (tapStep && tapStep.params?.requireBiasAlignment !== false && !(ctx.bias && ctx.bias !== "neutral")) {
      const biasTf = typeof tapStep.params?.biasTimeframe === "string" ? tapStep.params.biasTimeframe : "H4";
      const now = ctx.now ?? Date.now();
      const b = detectBiasH4(closedCandles(candlesFor(ctx, biasTf), biasTf, now), true);
      if (b.bias !== state.zone.direction) return "bias_changed";
    }
  }
  return null;
}

/** Estado limpo que guarda os gatilhos já usados (para o mesmo sweep/zona não disparar duas vezes). */
/** Motivos que não "gastam" o gatilho: o mesmo sweep/zona pode voltar a ser avaliado. */
const KEEP_ANCHOR_REASONS = new Set(["outside_session", "news_blackout"]);

function resetState(strategy: StrategyDefinition, prev: EngineState, reason?: string): EngineState {
  const keep = reason != null && KEEP_ANCHOR_REASONS.has(reason);
  const anchors = [...(prev.usedAnchors || []), ...(keep ? [] : prev.pendingAnchors || [])];
  const reset = createEngineState(strategy.id);
  reset.usedAnchors = anchors.slice(-50);
  reset.lastSignalAt = prev.lastSignalAt;
  if (reason) reset.lastInvalidation = reason;
  return reset;
}

type BuildResult = { signal: EngineSignal; reason?: undefined } | { signal: null; reason: string };
const reject = (reason: string): BuildResult => ({ signal: null, reason });

function buildSignal(
  strategy: StrategyDefinition,
  state: EngineState,
  ctx: EngineContext,
  lastDetails: Record<string, unknown>
): BuildResult {
  const rrMin = strategy.risk.rrMin;
  const directionBias = (state.bias || state.sweepDirection || "neutral") as BiasDirection;
  if (directionBias === "neutral") return reject("no_direction");

  const direction = directionBias === "bullish" ? "long" : "short";
  const entry =
    ctx.price ??
    (typeof lastDetails.zoneHigh === "number" && typeof lastDetails.zoneLow === "number"
      ? (lastDetails.zoneHigh + lastDetails.zoneLow) / 2
      : typeof lastDetails.fvgHigh === "number" && typeof lastDetails.fvgLow === "number"
        ? (lastDetails.fvgHigh + lastDetails.fvgLow) / 2
        : undefined);

  let sl = ctx.stopLossLevel ?? (typeof lastDetails.stopLoss === "number" ? lastDetails.stopLoss : undefined);
  let tp = ctx.takeProfitLevel ?? (typeof lastDetails.takeProfit === "number" ? lastDetails.takeProfit : undefined);
  // Liquidez oposta sugerida pelo runner — só serve se ficar à distância mínima de R:R.
  const liquidityTp = tp == null ? ctx.takeProfitLevels?.[direction] : undefined;

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
    const rrTarget = direction === "long" ? entry + risk * rrMin : entry - risk * rrMin;
    // tpLogic do SOL: "1:3 ou liquidez 15m" — a liquidez só substitui o alvo mínimo se estiver mais longe.
    const liquidityFurther =
      liquidityTp != null && (direction === "long" ? liquidityTp > rrTarget : liquidityTp < rrTarget);
    tp = liquidityFurther ? liquidityTp : rrTarget;
  }

  // PE, SL e TP obrigatórios e do lado certo do preço — senão não há sinal.
  if (entry == null || sl == null || tp == null) return reject("levels_missing");
  if (validateLevels(direction === "long" ? "LONG" : "SHORT", entry, sl, tp).length) return reject("levels_wrong_side");
  const minStopPct = strategy.risk.minStopPct;
  if (minStopPct != null && (Math.abs(entry - sl) / entry) * 100 < minStopPct) return reject("stop_too_tight");
  // SL demasiado largo rebenta o travão diário de uma prop firm com um só trade.
  const maxStopPct = strategy.risk.maxStopPct;
  if (maxStopPct != null && (Math.abs(entry - sl) / entry) * 100 > maxStopPct) return reject("stop_too_wide");
  const rr = calcRR(entry, sl, tp);

  // Gate R:R
  if (rr < rrMin) {
    return reject("rr_below_min");
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
        return reject("spread_too_wide");
      }
      void spreadPctOfFvg;
    }
  }

  // Session confluence for XAU
  if (strategy.confluences.includes("session_window") && ctx.sessionOk === false) {
    return reject("outside_session");
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
    return reject("confluences_missing");
  }

  const signal: EngineSignal = {
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
  return { signal };
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
    return { state, signal: null, progressed: false, invalidated: false, reason: "sequence_complete" };
  }

  const next = steps[state.currentStepIndex];
  const lost = state.currentStepIndex > 0 ? gateLost(strategy, state, ctx) : null;
  const timeoutReason = lost ?? checkTimeouts(strategy, state, ctx, next);
  if (timeoutReason) {
    return {
      state: resetState(strategy, state, timeoutReason),
      signal: null,
      progressed: false,
      invalidated: true,
      reason: timeoutReason,
    };
  }

  const result = evaluateStep(next, strategy, state, ctx);
  if (!result.ok) {
    return { state, signal: null, progressed: false, invalidated: false, reason: result.reason };
  }

  const now = ctx.now ?? Date.now();
  const confirmed: ConfirmedStep = {
    step: next.step,
    type: next.type,
    confluenceKeys: confluenceKeysForStep(next, strategy),
    details: result.details,
    confirmedAt: now,
    candleIndex: candlesFor(ctx, strategy.timeframes.entry).length - 1,
  };

  const newState: EngineState = {
    ...state,
    currentStepIndex: state.currentStepIndex + 1,
    confirmed: [...state.confirmed, confirmed],
    bias: result.bias || state.bias,
    pendingAnchors: result.anchor ? [...(state.pendingAnchors || []), result.anchor] : state.pendingAnchors,
  };

  if (next.type === "liquidity_sweep") {
    newState.sweepCandleIndex = confirmed.candleIndex;
    newState.sweepConfirmedAt = confirmed.confirmedAt;
    newState.sweepAt = result.anchorAt;
    newState.sweepDirection = (result.details.direction as BiasDirection) || result.bias;
    // Sweep de mínimos (bullish) → procura long; sweep de máximos (bearish) → short.
    if (result.details.direction === "bullish") newState.bias = "bullish";
    if (result.details.direction === "bearish") newState.bias = "bearish";
  }
  if (next.type === "htf_zone_tap" && result.zone) {
    newState.zone = result.zone;
    newState.tapAt = now;
  }
  if (result.bias && result.bias !== "neutral" && next.type === "bias_h4") {
    newState.bias = result.bias;
  }
  if (result.bias && result.bias !== "neutral" && (next.type === "mss_cisd" || next.type === "choch_volume")) {
    newState.bias = result.bias;
  }

  if (newState.currentStepIndex < steps.length) {
    return { state: newState, signal: null, progressed: true, invalidated: false };
  }

  const built = buildSignal(strategy, newState, ctx, result.details);
  if (!built.signal) {
    return {
      state: resetState(strategy, newState, built.reason),
      signal: null,
      progressed: true,
      invalidated: true,
      reason: built.reason,
    };
  }
  const signal = built.signal;
  const after = resetState(strategy, newState);
  after.lastSignalAt = signal.emittedAt;
  return { state: after, signal, progressed: true, invalidated: false, reason: "signal_emitted" };
}

/**
 * Corre a sequência até onde os dados de agora permitirem, num só ciclo.
 * Antes avançava um passo por avaliação: com velas M5 a chegar de 5 em 5 min, 5 passos
 * levavam 25 min e o sweep já tinha passado. Devolve cada avaliação (para alertas "armado").
 */
export function runStrategyCycle(
  strategy: StrategyDefinition,
  state: EngineState,
  ctx: EngineContext
): { state: EngineState; signal: EngineSignal | null; evaluations: EngineEvaluation[] } {
  const evaluations: EngineEvaluation[] = [];
  let st = state;
  for (let i = 0; i <= strategy.sequence.length; i++) {
    const r = evaluateStrategy(strategy, st, ctx);
    evaluations.push(r);
    st = r.state;
    if (r.signal) return { state: st, signal: r.signal, evaluations };
    if (!r.progressed || r.invalidated) break;
  }
  return { state: st, signal: null, evaluations };
}

export function loadStrategyDefinition(json: StrategyDefinition): StrategyDefinition {
  return json;
}
