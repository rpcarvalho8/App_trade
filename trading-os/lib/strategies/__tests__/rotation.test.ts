import { describe, it, expect } from "vitest";
import {
  STRATEGY_XAUUSD_ROTATION,
  createEngineState,
  runStrategyCycle,
  detectBiasH4,
  findHtfZones,
  findDrawLevel,
} from "../index";
import type { Candle, EngineContext, StrategyDefinition } from "../types";

const H4 = 4 * 3_600_000;
const M5 = 5 * 60_000;
const M15 = 15 * 60_000;
const T = Date.UTC(2026, 10, 2, 0, 0, 0);

const bar = (time: number, open: number, high: number, low: number, close: number): Candle => ({
  time,
  open,
  high,
  low,
  close,
  volume: 100,
});

/**
 * H4: lateral em 100 → vela bearish (OB) → deslocamento bullish que deixa FVG [100.6, 103]
 * → subida até ~110 (BOS up) → regresso ao FVG na última vela fechada.
 */
function h4Series(touchEarlier = false): Candle[] {
  const out: Candle[] = [];
  let t = T;
  for (let i = 0; i < 30; i++) {
    const o = 100 + (i % 2 ? 0.2 : -0.2);
    out.push(bar(t, o, 100.6, 99.4, 100 + (i % 2 ? -0.2 : 0.2)));
    t += H4;
  }
  out.push(bar(t, 100.4, 100.6, 99.8, 100.0)); // OB
  t += H4;
  out.push(bar(t, 100.0, 104.2, 99.9, 104.0)); // deslocamento
  t += H4;
  out.push(bar(t, 104.0, 105.2, 103.0, 105.0)); // completa o FVG (low 103 > 100.6)
  t += H4;
  let p = 105;
  for (let i = 0; i < 6; i++) {
    out.push(bar(t, p, p + 1.0, p - 0.2, p + 0.8));
    p += 0.8;
    t += H4;
  }
  if (touchEarlier) {
    out.push(bar(t, p, p + 0.2, 102.8, p - 0.5)); // toca no FVG cedo
    t += H4;
  }
  // regresso: 109.8 → ~103.5, sem fechos abaixo de mínimos de swing
  for (let i = 0; i < 4; i++) {
    out.push(bar(t, p, p + 0.1, p - 1.6, p - 1.5));
    p -= 1.5;
    t += H4;
  }
  out.push(bar(t, p, p + 0.1, 102.5, 102.9)); // toque no FVG (última vela fechada)
  return out;
}

function flat(start: number, step: number, n: number, price: number, range = 0.15): Candle[] {
  return Array.from({ length: n }, (_, i) => bar(start + i * step, price, price + range, price - range, price));
}

/** M5: queda até 102.6 com máximos descendentes, depois (opcionalmente) quebra do último máximo. */
function m5Series(start: number, withBreak: boolean): Candle[] {
  const out: Candle[] = [];
  const highs = [103.6, 103.3, 103.5, 103.1, 103.3, 102.95, 103.15, 102.85, 103.0, 102.8];
  let t = start;
  for (const h of highs) {
    out.push(bar(t, h - 0.1, h, h - 0.3, h - 0.2));
    t += M5;
  }
  out.push(bar(t, 102.7, 102.75, 102.6, 102.7));
  t += M5;
  if (withBreak) out.push(bar(t, 102.7, 103.7, 102.65, 103.6));
  return out;
}

const loose: StrategyDefinition = {
  ...STRATEGY_XAUUSD_ROTATION,
  risk: { ...STRATEGY_XAUUSD_ROTATION.risk, minStopPct: 0.05, maxStopPct: 2 },
};

function ctxAt(now: number, h4: Candle[], m5: Candle[], price: number): EngineContext {
  return {
    now,
    calendarClean: true,
    sessionOk: true,
    price,
    candlesByTf: { H4: h4, H1: [], M15: flat(now - 40 * M15, M15, 40, 103), M5: m5 },
  };
}

describe("detectBiasH4 por estrutura", () => {
  it("pullback dentro de tendência continua bullish (antes dava neutral)", () => {
    expect(detectBiasH4(h4Series()).bias).toBe("bullish");
  });
});

describe("findHtfZones", () => {
  it("encontra o FVG e o OB bullish nascidos do deslocamento", () => {
    const zones = findHtfZones(h4Series(), "H4");
    const fvg = zones.find((z) => z.kind === "fvg" && z.direction === "bullish");
    expect(fvg).toBeTruthy();
    expect(fvg!.low).toBeCloseTo(100.6);
    expect(fvg!.high).toBeCloseTo(103);
    expect(fvg!.broken).toBe(false);
    expect(zones.some((z) => z.kind === "ob" && z.direction === "bullish")).toBe(true);
  });
});

describe("HTF Imbalance Rotation (XAUUSD)", () => {
  const h4 = h4Series();
  const now1 = h4[h4.length - 1].time + H4 + 10 * 60_000;

  it("arma no toque do FVG H4, espera MSS M5 e emite sinal com SL/TP do lado certo", () => {
    let state = createEngineState(loose.id);
    const m5a = m5Series(now1 - 12 * M5, false);
    let r = runStrategyCycle(loose, state, ctxAt(now1, h4, m5a, 102.95));
    state = r.state;
    expect(r.signal).toBeNull();
    expect(state.currentStepIndex).toBe(2); // calendário + zona confirmados
    expect(state.zone?.tf).toBe("H4");
    expect(state.zone?.direction).toBe("bullish");

    const m5b = m5Series(now1 - 11 * M5, true);
    const now2 = m5b[m5b.length - 1].time + M5 + 1000;
    r = runStrategyCycle(loose, state, ctxAt(now2, h4, m5b, 103.6));
    expect(r.signal).not.toBeNull();
    const sig = r.signal!;
    expect(sig.direction).toBe("long");
    expect(sig.stopLoss!).toBeLessThan(102.6);
    expect(sig.takeProfit!).toBeGreaterThan(sig.entry!);
    expect(sig.entry).toBeCloseTo(103.6);
    expect(sig.confluencesValidated).toEqual(expect.arrayContaining(STRATEGY_XAUUSD_ROTATION.confluences));
    expect(sig.rr).toBeGreaterThanOrEqual(2);
    expect(sig.rr).toBeLessThanOrEqual(4.0001);

    // A mesma zona não volta a disparar.
    const again = runStrategyCycle(loose, r.state, ctxAt(now2 + 60_000, h4, m5b, 102.95));
    expect(again.state.currentStepIndex).toBe(1);
    expect(again.evaluations[again.evaluations.length - 1].reason).toBe("no_zone_tap");
  });

  it("não arma se a zona já tinha sido tocada antes (não é fresca)", () => {
    const h4b = h4Series(true);
    const now = h4b[h4b.length - 1].time + H4 + 60_000;
    const r = runStrategyCycle(loose, createEngineState(loose.id), ctxAt(now, h4b, m5Series(now - 12 * M5, false), 102.95));
    expect(r.state.currentStepIndex).toBe(1);
    expect(r.evaluations[r.evaluations.length - 1].reason).toBe("no_zone_tap");
  });

  it("invalida quando uma M15 fecha abaixo da zona", () => {
    let state = createEngineState(loose.id);
    let r = runStrategyCycle(loose, state, ctxAt(now1, h4, m5Series(now1 - 12 * M5, false), 102.95));
    state = r.state;
    const now2 = now1 + 30 * 60_000;
    const ctx = ctxAt(now2, h4, m5Series(now1 - 12 * M5, false), 100.2);
    ctx.candlesByTf.M15 = [...flat(now1 - 20 * M15, M15, 20, 102.9), bar(now1, 101, 101.1, 100.0, 100.2)];
    r = runStrategyCycle(loose, state, ctx);
    expect(r.evaluations[0].reason).toBe("zone_broken");
  });

  it("expira se o MSS M5 não aparecer em 24 velas (2h)", () => {
    let state = createEngineState(loose.id);
    const r1 = runStrategyCycle(loose, state, ctxAt(now1, h4, m5Series(now1 - 12 * M5, false), 102.95));
    state = r1.state;
    const r2 = runStrategyCycle(loose, state, ctxAt(now1 + 3 * 3_600_000, h4, m5Series(now1 - 12 * M5, false), 102.95));
    expect(r2.evaluations[0].reason).toBe("step_maxCandles_exceeded");
  });

  it("recusa SL demasiado largo para o risco diário (maxStopPct)", () => {
    let state = createEngineState(STRATEGY_XAUUSD_ROTATION.id);
    let r = runStrategyCycle(STRATEGY_XAUUSD_ROTATION, state, ctxAt(now1, h4, m5Series(now1 - 12 * M5, false), 102.95));
    state = r.state;
    const m5b = m5Series(now1 - 11 * M5, true);
    r = runStrategyCycle(STRATEGY_XAUUSD_ROTATION, state, ctxAt(m5b[m5b.length - 1].time + M5 + 1000, h4, m5b, 103.6));
    expect(r.signal).toBeNull();
    expect(r.evaluations[r.evaluations.length - 1].reason).toBe("stop_too_wide");
  });
});

describe("revisões do review", () => {
  const h4 = h4Series();
  const now1 = h4[h4.length - 1].time + H4 + 10 * 60_000;

  it("o setup armado cai se o H4 (fechado) virar contra a zona", () => {
    const r1 = runStrategyCycle(loose, createEngineState(loose.id), ctxAt(now1, h4, m5Series(now1 - 12 * M5, false), 102.95));
    expect(r1.state.currentStepIndex).toBe(2);
    const flipped = [...h4, bar(h4[h4.length - 1].time + H4, 102.9, 103, 98.5, 98.8)];
    const now2 = now1 + H4;
    const r2 = runStrategyCycle(loose, r1.state, ctxAt(now2, flipped, m5Series(now1 - 12 * M5, false), 98.8));
    expect(r2.evaluations[0].reason).toBe("bias_changed");
  });

  it("uma vela H4 ainda em formação não muda o bias", () => {
    const r1 = runStrategyCycle(loose, createEngineState(loose.id), ctxAt(now1, h4, m5Series(now1 - 12 * M5, false), 102.95));
    const forming = [...h4, bar(h4[h4.length - 1].time + H4, 102.9, 103, 98.5, 98.8)]; // abre antes de now1, ainda não fechou
    const r2 = runStrategyCycle(loose, r1.state, ctxAt(now1 + 60_000, forming, m5Series(now1 - 12 * M5, false), 102.95));
    expect(r2.evaluations[0].reason).not.toBe("bias_changed");
  });

  it("o TP ignora níveis opostos a menos de rrMin", () => {
    const swings = [
      ...flat(T, H4, 5, 100),
      bar(T + 5 * H4, 100, 101, 99.9, 100.5),
      ...flat(T + 6 * H4, H4, 5, 100),
      bar(T + 11 * H4, 100, 110, 99.9, 109),
      ...flat(T + 12 * H4, H4, 5, 100),
    ];
    // risco 1: o máximo a 101 (1R) é ignorado com minDistance 2 → destino 110
    expect(findDrawLevel("long", 100, [], swings, 2)?.level).toBe(110);
    expect(findDrawLevel("long", 100, [], swings, 0)!.level).toBeLessThan(102);
  });
});
