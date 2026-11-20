/**
 * Variantes "sombra": correm em paralelo com as estratégias reais, sobre o mesmo contexto de mercado,
 * mas só escrevem no engine_log. Nunca emitem alertas, nunca gravam em `signals`, nunca aparecem na UI.
 * Servem para medir à frente (sem ajustar ao passado) se uma alteração de parâmetros compensa.
 *
 * Este módulo é puro de propósito (sem DB nem alertas): o runner injeta o `log`.
 */
import { createEngineState, runStrategyCycle } from "./engine";
import { STRATEGY_XAUUSD, STRATEGY_XAUUSD_ROTATION } from "./index";
import type { EngineContext, EngineState, StrategyDefinition } from "./types";
import type { EngineLogRow } from "@/lib/engine-log";

export interface ShadowVariant {
  /** Id próprio (`<estratégia>@<variante>`): é o strategy_id no engine_log. */
  id: string;
  symbol: string;
  description: string;
  definition: StrategyDefinition;
  /** Janela UTC [início, fim) em que a variante NÃO avalia (a sequência fica parada, como no replay). */
  excludeUtcHours?: [number, number];
}

export interface ShadowStore {
  states: Record<string, EngineState>;
  signalsDay: Record<string, { day: string; count: number }>;
}

export type ShadowLog = (row: EngineLogRow, at: number) => void;

/** Cópia da estratégia com outro `rrCap` no passo ltf_mss (a original não é alterada). */
export function withRrCap(base: StrategyDefinition, cap: number, id: string): StrategyDefinition {
  return {
    ...base,
    id,
    sequence: base.sequence.map((st) =>
      st.type === "ltf_mss" ? { ...st, params: { ...st.params, rrCap: cap } } : st
    ),
  };
}

export function buildShadowVariants(): ShadowVariant[] {
  const lId = `${STRATEGY_XAUUSD.id}@sem-londres`;
  const rId = `${STRATEGY_XAUUSD_ROTATION.id}@rrcap2`;
  return [
    {
      id: lId,
      symbol: STRATEGY_XAUUSD.symbol,
      description: "London Structure sem avaliar entre as 7h e as 12h UTC",
      definition: { ...STRATEGY_XAUUSD, id: lId },
      excludeUtcHours: [7, 12],
    },
    {
      id: rId,
      symbol: STRATEGY_XAUUSD_ROTATION.symbol,
      description: "HTF Rotation com rrCap=2 (TP máximo a 2R)",
      definition: withRrCap(STRATEGY_XAUUSD_ROTATION, 2, rId),
    },
  ];
}

export function createShadowStore(variants: ShadowVariant[]): ShadowStore {
  return {
    states: Object.fromEntries(variants.map((v) => [v.id, createEngineState(v.id)])),
    signalsDay: {},
  };
}

const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Um ciclo de uma variante, com as mesmas protecções da estratégia real
 * (limite diário, cooldown) e sem qualquer efeito fora do `log`.
 */
export function runShadowVariant(
  v: ShadowVariant,
  store: ShadowStore,
  ctx: EngineContext,
  now: number,
  cooldownMs: number,
  log: ShadowLog
): void {
  const strat = v.definition;
  const day = utcDay(now);
  const counter = store.signalsDay[v.id];
  const today = counter && counter.day === day ? counter.count : 0;
  if (today >= strat.kill.maxTradesPerDay) return;

  const st = (store.states[v.id] ||= createEngineState(v.id));
  if (st.lastSignalAt && now - st.lastSignalAt < cooldownMs) return;

  if (v.excludeUtcHours) {
    const h = new Date(now).getUTCHours();
    if (h >= v.excludeUtcHours[0] && h < v.excludeUtcHours[1]) return;
  }

  const cycle = runStrategyCycle(strat, st, { ...ctx, now, sessionOk: true });
  store.states[v.id] = cycle.state;

  for (const e of cycle.evaluations) {
    if (e.progressed && !e.invalidated) {
      const cs = e.state.confirmed[e.state.confirmed.length - 1];
      if (cs) {
        log(
          { strategyId: v.id, symbol: v.symbol, kind: "step", step: cs.step, type: String(cs.type), reason: (cs.details?.reason as string) ?? null, price: ctx.price },
          now
        );
      }
    }
    if (e.invalidated && e.reason) {
      log({ strategyId: v.id, symbol: v.symbol, kind: "invalidated", reason: e.reason, price: ctx.price }, now);
    }
  }

  if (cycle.signal) {
    const sg = cycle.signal;
    // SL/TP no texto: o engine_log só tem uma coluna de preço, e a avaliação posterior precisa deles.
    log(
      {
        strategyId: v.id,
        symbol: v.symbol,
        kind: "signal",
        reason: `${sg.direction} rr=${sg.rr.toFixed(2)} sl=${sg.stopLoss} tp=${sg.takeProfit}`,
        price: sg.entry,
      },
      now
    );
    store.states[v.id].lastSignalAt = now;
    store.signalsDay[v.id] = { day, count: today + 1 };
  }
}
