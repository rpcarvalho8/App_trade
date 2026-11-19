/**
 * Replay do motor sobre velas históricas (cache local): responde a "porque é que não houve sinal?".
 * Corre as estratégias vela M5 a vela M5, como o runner faz ao vivo, e conta onde a sequência pára.
 * Sem efeitos: não grava sinais nem envia alertas.
 */
import { runStrategyCycle, createEngineState } from "./engine";
import type { Candle, EngineState, StrategyDefinition } from "./types";
import { aggregateCandles } from "@/lib/marketdata/ohlc-utils";

export interface ReplaySignal {
  at: string;
  direction: "long" | "short";
  entry: number | undefined;
  stopLoss: number | undefined;
  takeProfit: number | undefined;
  rr: number;
}

export interface ReplayStrategyReport {
  strategyId: string;
  name: string;
  cycles: number;
  signals: ReplaySignal[];
  /** Quantas vezes cada passo confirmou (ex.: "3:liquidity_sweep": 12). */
  confirmed: Record<string, number>;
  /** Porque é que cada passo não confirmou, por passo (ex.: { "3:liquidity_sweep": { no_sweep: 800 } }). */
  waiting: Record<string, Record<string, number>>;
  /** Setups descartados depois de começarem (timeouts, bias mudou, R:R…). */
  invalidated: Record<string, number>;
  /** Momentos em que a sequência armou (passou o passo de alerta). */
  armedAt: string[];
}

export interface ReplayInput {
  M5: Candle[];
  M15: Candle[];
  H4: Candle[];
}

const M5_MS = 5 * 60_000;
const WINDOW = 600;

/** Índice da primeira vela com time >= t (pesquisa binária; velas ordenadas). */
function lowerBound(c: Candle[], t: number): number {
  let lo = 0;
  let hi = c.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Velas já abertas no instante t (a última pode estar em formação, como ao vivo). */
function upTo(c: Candle[], t: number): Candle[] {
  const end = lowerBound(c, t);
  return c.slice(Math.max(0, end - WINDOW), end);
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");

export function replayStrategies(
  strategies: StrategyDefinition[],
  data: ReplayInput,
  from: number,
  to: number,
  opts: { cooldownMs?: number } = {}
): ReplayStrategyReport[] {
  const cooldown = opts.cooldownMs ?? 15 * 60_000;
  const reports = strategies.map<ReplayStrategyReport>((s) => ({
    strategyId: s.id,
    name: s.name,
    cycles: 0,
    signals: [],
    confirmed: {},
    waiting: {},
    invalidated: {},
    armedAt: [],
  }));
  const states: EngineState[] = strategies.map((s) => createEngineState(s.id));
  const perDay: Record<string, number>[] = strategies.map(() => ({}));

  // Avalia logo a seguir ao fecho de cada vela M5 que existe (mercado aberto).
  const times = data.M5.map((c) => c.time + M5_MS + 1_000).filter((t) => t >= from && t <= to);
  for (const now of times) {
    const m15 = upTo(data.M15, now);
    const candlesByTf: Record<string, Candle[]> = {
      M5: upTo(data.M5, now),
      M15: m15,
      H4: upTo(data.H4, now),
      H1: aggregateCandles(m15, "H1"),
    };
    const price = candlesByTf.M5[candlesByTf.M5.length - 1]?.close;
    if (price == null) continue;

    strategies.forEach((strategy, k) => {
      const rep = reports[k];
      const day = new Date(now).toISOString().slice(0, 10);
      if ((perDay[k][day] || 0) >= strategy.kill.maxTradesPerDay) return;
      const last = states[k].lastSignalAt;
      if (last && now - last < cooldown) return;

      rep.cycles++;
      const steps = [...strategy.sequence].sort((a, b) => a.step - b.step);
      const prevStep = states[k].currentStepIndex;
      const cycle = runStrategyCycle(strategy, states[k], { now, price, calendarClean: true, sessionOk: true, candlesByTf });
      states[k] = cycle.state;

      for (const e of cycle.evaluations) {
        if (e.invalidated && e.reason) rep.invalidated[e.reason] = (rep.invalidated[e.reason] || 0) + 1;
        if (e.progressed && !e.invalidated) {
          const cs = e.state.confirmed[e.state.confirmed.length - 1];
          if (cs) {
            const key = `${cs.step}:${cs.type}`;
            rep.confirmed[key] = (rep.confirmed[key] || 0) + 1;
            if (strategy.alerts?.armOnStep === cs.type && e.state.currentStepIndex > prevStep) rep.armedAt.push(iso(now));
          }
        }
      }
      const lastEval = cycle.evaluations[cycle.evaluations.length - 1];
      if (lastEval && !lastEval.progressed && !lastEval.invalidated && lastEval.reason) {
        const st = steps[cycle.state.currentStepIndex];
        const key = st ? `${st.step}:${st.type}` : "fim";
        rep.waiting[key] = rep.waiting[key] || {};
        rep.waiting[key][lastEval.reason] = (rep.waiting[key][lastEval.reason] || 0) + 1;
      }

      if (cycle.signal) {
        const sg = cycle.signal;
        rep.signals.push({
          at: iso(now),
          direction: sg.direction,
          entry: sg.entry,
          stopLoss: sg.stopLoss,
          takeProfit: sg.takeProfit,
          rr: Math.round(sg.rr * 100) / 100,
        });
        states[k].lastSignalAt = now;
        perDay[k][day] = (perDay[k][day] || 0) + 1;
      }
    });
  }
  return reports;
}
