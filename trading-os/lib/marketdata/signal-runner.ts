/**
 * Liga o engine às streams XAU (Twelve Data OHLC) e SOL (Kraken).
 * Corre TODAS as estratégias de cada activo (ver STRATEGIES_BY_SYMBOL); emite alertas sem executar ordens.
 *
 * Avaliação:
 *   - a cada tick (SOL ~segundos; XAU quando chega vela M5 nova) e
 *   - num relógio de 30 s, para o motor não depender só de ticks;
 *   - cada ciclo percorre a sequência até onde os dados permitirem (runStrategyCycle).
 *
 * Alertas:
 *   - "armado" quando a estratégia confirma o passo alerts.armOnStep (ex.: preço numa zona H4/H1);
 *   - sinal completo com PE / SL / TP validados.
 * Protecções: cooldown por estratégia, máximo de sinais por dia (kill.maxTradesPerDay), janela horária.
 */
import {
  STRATEGIES_BY_SYMBOL,
  runStrategyCycle,
  createEngineState,
  normalizeTf,
} from "@/lib/strategies";
import type { EngineContext, EngineEvaluation, EngineState, Candle, StrategyDefinition } from "@/lib/strategies/types";
import {
  getXauBuffers,
  onXauTick,
  startXtbClient,
  isXauReady,
  getXauMarketStatus,
} from "@/lib/marketdata/xtb-client";
import { getSolBuffers, getSolSpread, onSolTick, startKrakenClient } from "@/lib/marketdata/kraken-client";
import { aggregateCandles } from "@/lib/marketdata/ohlc-utils";
import { emitSignalAlert, emitSetupAlert } from "@/lib/signals";
import { fetchCalendar } from "@/lib/morning-brief";

type Asset = "XAUUSD" | "SOLUSD";

/** Diagnóstico por estratégia: onde está a sequência e porque é que o último sinal não saiu. */
export interface AssetDiag {
  strategyId: string;
  symbol: string;
  name: string;
  lastEvalAt: number | null;
  /** Porque é que o motor não está a avaliar agora (sem dados, fora de horas, limite diário…). */
  idleReason: string | null;
  step: number;
  totalSteps: number;
  nextStepType: string | null;
  /** Porque é que o passo actual ainda não confirmou. */
  waitingReason: string | null;
  lastReject: { reason: string; at: number } | null;
  /** Rejeições no dia (UTC), por motivo. */
  rejects: { day: string; counts: Record<string, number> };
  lastSignalAt: number | null;
  lastArmedAt: number | null;
  signalsToday: number;
}

interface RunnerState {
  started: boolean;
  states: Record<string, EngineState>;
  diag: Record<string, AssetDiag>;
  lastEval: Record<Asset, number>;
  lastPrice: Partial<Record<Asset, number>>;
  signalsDay: Record<string, { day: string; count: number }>;
  cooldownMs: number;
  newsBlackout: boolean;
  newsCheckedAt: number;
  solReady: boolean;
  timer: NodeJS.Timeout | null;
}

const ALL: StrategyDefinition[] = [...STRATEGIES_BY_SYMBOL.XAUUSD, ...STRATEGIES_BY_SYMBOL.SOLUSD];

function emptyDiag(s: StrategyDefinition): AssetDiag {
  return {
    strategyId: s.id,
    symbol: s.symbol,
    name: s.name,
    lastEvalAt: null,
    idleReason: "ainda não chegou nenhum preço (a arrancar ou fonte de dados em baixo)",
    step: 0,
    totalSteps: s.sequence.length,
    nextStepType: null,
    waitingReason: null,
    lastReject: null,
    rejects: { day: "", counts: {} },
    lastSignalAt: null,
    lastArmedAt: null,
    signalsToday: 0,
  };
}

function state(): RunnerState {
  const g = globalThis as any;
  if (!g.__tosSignalRunnerV2) {
    g.__tosSignalRunnerV2 = {
      started: false,
      states: Object.fromEntries(ALL.map((s) => [s.id, createEngineState(s.id)])),
      diag: Object.fromEntries(ALL.map((s) => [s.id, emptyDiag(s)])),
      lastEval: { XAUUSD: 0, SOLUSD: 0 },
      lastPrice: {},
      signalsDay: {},
      cooldownMs: Number(process.env.SIGNAL_COOLDOWN_MS || 15 * 60_000),
      newsBlackout: false,
      newsCheckedAt: 0,
      solReady: false,
      timer: null,
    } as RunnerState;
  }
  return g.__tosSignalRunnerV2 as RunnerState;
}

const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);

function setIdle(asset: Asset, reason: string): void {
  for (const st of STRATEGIES_BY_SYMBOL[asset]) state().diag[st.id].idleReason = reason;
}

function sessionOk(strategy: StrategyDefinition, now: number): boolean {
  const hours = strategy.session.utcHours;
  if (!hours) return true;
  const h = new Date(now).getUTCHours();
  return h >= hours[0] && h < hours[1];
}

function recordEvals(strategy: StrategyDefinition, evals: EngineEvaluation[], finalState: EngineState, now: number): void {
  const d = state().diag[strategy.id];
  d.lastEvalAt = now;
  d.idleReason = null;
  const steps = [...strategy.sequence].sort((a, b) => a.step - b.step);
  d.step = finalState.currentStepIndex;
  d.nextStepType = steps[finalState.currentStepIndex]?.type ?? null;
  const last = evals[evals.length - 1];
  d.waitingReason = last && !last.progressed && !last.invalidated ? last.reason ?? null : null;
  for (const r of evals) {
    if (r.invalidated && r.reason) {
      const day = utcDay(now);
      if (d.rejects.day !== day) d.rejects = { day, counts: {} };
      d.rejects.counts[r.reason] = (d.rejects.counts[r.reason] || 0) + 1;
      d.lastReject = { reason: r.reason, at: now };
    }
  }
}

async function refreshNewsBlackout(): Promise<boolean> {
  const s = state();
  const now = Date.now();
  if (now - s.newsCheckedAt < 60_000) return s.newsBlackout;
  s.newsCheckedAt = now;
  try {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Lisbon",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const cal = await fetchCalendar(day);
    const keywords = ["NFP", "Non-Farm", "CPI", "FOMC", "Powell", "Interest Rate"];
    const blackoutMin = 30;
    s.newsBlackout = cal.todayHighImpact.some((e) => {
      const t = new Date(e.date).getTime();
      if (Number.isNaN(t)) return false;
      const mins = (t - now) / 60000;
      if (mins < -5 || mins > blackoutMin) return false;
      const title = `${e.title} ${e.country}`;
      return keywords.some((k) => title.toUpperCase().includes(k.toUpperCase())) || e.country === "USD";
    });
  } catch {
    s.newsBlackout = false;
  }
  return s.newsBlackout;
}

function mapBuffers(snap: Record<string, Candle[]>): Record<string, Candle[]> {
  const out: Record<string, Candle[]> = { ...snap };
  for (const k of Object.keys(snap)) out[normalizeTf(k)] = snap[k];
  return out;
}

/** Corre todas as estratégias do activo sobre o mesmo contexto de mercado. */
async function runAsset(asset: Asset, base: Omit<EngineContext, "sessionOk">): Promise<void> {
  const s = state();
  const now = base.now ?? Date.now();
  for (const strategy of STRATEGIES_BY_SYMBOL[asset]) {
    const d = s.diag[strategy.id];
    const day = utcDay(now);
    const counter = s.signalsDay[strategy.id];
    const today = counter && counter.day === day ? counter.count : 0;
    d.signalsToday = today;

    if (today >= strategy.kill.maxTradesPerDay) {
      d.idleReason = `limite de ${strategy.kill.maxTradesPerDay} sinais hoje atingido (regra de risco)`;
      d.lastEvalAt = now;
      continue;
    }
    const lastSig = s.states[strategy.id].lastSignalAt;
    if (lastSig && now - lastSig < s.cooldownMs) {
      d.idleReason = `pausa de ${Math.round(s.cooldownMs / 60000)} min depois do último sinal`;
      d.lastEvalAt = now;
      continue;
    }

    // Fora da janela horária não avança a sequência (nem gasta sweeps/zonas que ainda podem servir).
    if (!sessionOk(strategy, now)) {
      const h = strategy.session.utcHours!;
      d.idleReason = `fora do horário da estratégia (${h[0]}h–${h[1]}h UTC)`;
      d.lastEvalAt = now;
      continue;
    }
    const ctx: EngineContext = { ...base, sessionOk: true };
    const prevStep = s.states[strategy.id].currentStepIndex;
    const cycle = runStrategyCycle(strategy, s.states[strategy.id], ctx);
    s.states[strategy.id] = cycle.state;
    recordEvals(strategy, cycle.evaluations, cycle.state, now);

    // "Armado": o passo configurado confirmou neste ciclo (e a sequência continua em curso).
    const armType = strategy.alerts?.armOnStep;
    if (armType && !cycle.signal) {
      const armed = cycle.evaluations.find(
        (e) => e.progressed && !e.invalidated && e.state.confirmed[e.state.confirmed.length - 1]?.type === armType
      );
      // Só avisa se o setup continua vivo no fim do ciclo (não foi descartado logo a seguir).
      const lastEval = cycle.evaluations[cycle.evaluations.length - 1];
      const alive = !lastEval?.invalidated && cycle.state.currentStepIndex >= (armed?.state.currentStepIndex ?? Infinity);
      if (armed && alive && armed.state.currentStepIndex > prevStep) {
        d.lastArmedAt = now;
        await emitSetupAlert(strategy, armed.state, ctx.price).catch((e) =>
          console.warn("[signal-runner] setup alert:", e?.message || e)
        );
      }
    }

    if (cycle.signal) {
      await emitSignalAlert(cycle.signal);
      s.states[strategy.id].lastSignalAt = now;
      s.signalsDay[strategy.id] = { day, count: today + 1 };
      d.signalsToday = today + 1;
      d.lastSignalAt = now;
    }
  }
}

async function evalXau(price: number): Promise<void> {
  const s = state();
  const now = Date.now();
  if (now - s.lastEval.XAUUSD < 5_000) return;
  s.lastEval.XAUUSD = now;
  s.lastPrice.XAUUSD = price;

  if (!isXauReady()) {
    setIdle("XAUUSD", "à espera do histórico de velas (Twelve Data)");
    return;
  }

  const newsBlocked = await refreshNewsBlackout();
  const candlesByTf = mapBuffers(getXauBuffers().snapshot());
  // H1 agregado do M15 real: zonas H1 sem gastar créditos Twelve Data.
  if (candlesByTf.M15?.length) candlesByTf.H1 = aggregateCandles(candlesByTf.M15, "H1");

  await runAsset("XAUUSD", { now, calendarClean: !newsBlocked, price, candlesByTf });
}

async function evalSol(price: number, spread?: number): Promise<void> {
  const s = state();
  const now = Date.now();
  if (now - s.lastEval.SOLUSD < 3_000) return;
  s.lastEval.SOLUSD = now;
  s.lastPrice.SOLUSD = price;

  const candlesByTf = mapBuffers(getSolBuffers().snapshot());
  const m15 = candlesByTf.M15 || [];
  const m1 = candlesByTf.M1 || [];
  s.solReady = m15.length >= 20 && m1.length >= 30;
  if (!s.solReady) {
    setIdle("SOLUSD", "à espera do histórico de velas (Kraken)");
    return;
  }

  const newsBlocked = await refreshNewsBlackout();
  // Liquidez oposta (SMC 3-Step): máximo recente para long, mínimo recente para short.
  let takeProfitLevels: EngineContext["takeProfitLevels"];
  if (m15.length >= 5) {
    const recent = m15.slice(-10);
    takeProfitLevels = {
      long: Math.max(...recent.map((c) => c.high)),
      short: Math.min(...recent.map((c) => c.low)),
    };
  }

  await runAsset("SOLUSD", {
    now,
    calendarClean: !newsBlocked,
    price,
    spread: spread ?? getSolSpread() ?? undefined,
    takeProfitLevels,
    candlesByTf,
  });
}

export function startSignalRunner(): void {
  const s = state();
  if (s.started) return;
  s.started = true;

  startXtbClient();
  startKrakenClient();

  onXauTick((tick) => {
    evalXau(tick.price).catch((e) => console.warn("[signal-runner] xau:", e?.message || e));
  });
  onSolTick((tick) => {
    evalSol(tick.price, tick.spread).catch((e) => console.warn("[signal-runner] sol:", e?.message || e));
  });

  // Relógio: avalia mesmo sem tick novo (o XAU só tem tick quando chega vela M5).
  s.timer = setInterval(() => {
    const p = state().lastPrice;
    if (p.XAUUSD != null) evalXau(p.XAUUSD).catch(() => {});
    if (p.SOLUSD != null) evalSol(p.SOLUSD).catch(() => {});
  }, 30_000);

  console.log(
    `[signal-runner] motor ligado — ${ALL.map((x) => x.id).join(", ")}. Só alertas, execução manual.`
  );
}

export function getRunnerDebug() {
  const s = state();
  const xau = getXauMarketStatus();
  return {
    newsBlackout: s.newsBlackout,
    xau,
    solReady: s.solReady,
    strategies: ALL.map((x) => ({ id: x.id, symbol: x.symbol, name: x.name, description: x.description ?? null })),
    diag: s.diag,
    status: !xau.ready ? (xau.status === "error" ? "error" : "warming_up") : s.solReady ? "ready" : "warming_up",
  };
}
