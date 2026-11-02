/**
 * Liga o engine às streams XAU (xtb-client OHLC real) e SOL (kraken-client).
 * Avalia estratégias em cada tick / fecho de vela; emite alertas sem executar ordens.
 *
 * XAUUSD: só avalia confluences quando o backfill OHLC estiver completo (ready).
 * Enquanto warming_up → /api/signals reporta status "warming_up".
 */
import {
  STRATEGY_XAUUSD,
  STRATEGY_SOLUSD,
  evaluateStrategy,
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
import { emitSignalAlert } from "@/lib/signals";
import { fetchCalendar } from "@/lib/morning-brief";

interface RunnerState {
  started: boolean;
  xau: EngineState;
  sol: EngineState;
  lastXauEval: number;
  lastSolEval: number;
  cooldownMs: number;
  newsBlackout: boolean;
  newsCheckedAt: number;
  solReady: boolean;
  diag?: Record<"XAUUSD" | "SOLUSD", AssetDiag>;
}

/** Diagnóstico por activo: onde está a sequência e porque é que o último sinal não saiu. */
export interface AssetDiag {
  lastEvalAt: number | null;
  /** Porque é que o motor não está a avaliar agora (sem dados, sem histórico, …). */
  idleReason: string | null;
  step: number;
  totalSteps: number;
  nextStepType: string | null;
  lastReject: { reason: string; at: number } | null;
  /** Rejeições no dia (UTC), por motivo. */
  rejects: { day: string; counts: Record<string, number> };
  lastSignalAt: number | null;
}

function emptyDiag(totalSteps: number): AssetDiag {
  return {
    lastEvalAt: null,
    idleReason: "ainda não chegou nenhum preço (a arrancar ou fonte de dados em baixo)",
    step: 0,
    totalSteps,
    nextStepType: null,
    lastReject: null,
    rejects: { day: "", counts: {} },
    lastSignalAt: null,
  };
}

function diagFor(asset: "XAUUSD" | "SOLUSD"): AssetDiag {
  const s = state();
  s.diag ??= {
    XAUUSD: emptyDiag(STRATEGY_XAUUSD.sequence.length),
    SOLUSD: emptyDiag(STRATEGY_SOLUSD.sequence.length),
  };
  return s.diag[asset];
}

function recordEval(asset: "XAUUSD" | "SOLUSD", strategy: StrategyDefinition, result: EngineEvaluation, now: number): void {
  const d = diagFor(asset);
  d.lastEvalAt = now;
  d.idleReason = null;
  const steps = [...strategy.sequence].sort((a, b) => a.step - b.step);
  d.step = result.state.currentStepIndex;
  d.nextStepType = steps[result.state.currentStepIndex]?.type ?? null;
  if (result.signal) d.lastSignalAt = now;
  if (result.invalidated && result.reason) {
    const day = new Date(now).toISOString().slice(0, 10);
    if (d.rejects.day !== day) d.rejects = { day, counts: {} };
    d.rejects.counts[result.reason] = (d.rejects.counts[result.reason] || 0) + 1;
    d.lastReject = { reason: result.reason, at: now };
  }
}

function state(): RunnerState {
  const g = globalThis as any;
  if (!g.__tosSignalRunner) {
    g.__tosSignalRunner = {
      started: false,
      xau: createEngineState(STRATEGY_XAUUSD.id),
      sol: createEngineState(STRATEGY_SOLUSD.id),
      lastXauEval: 0,
      lastSolEval: 0,
      cooldownMs: Number(process.env.SIGNAL_COOLDOWN_MS || 120_000),
      newsBlackout: false,
      newsCheckedAt: 0,
      solReady: false,
    } as RunnerState;
  }
  return g.__tosSignalRunner as RunnerState;
}

function londonSessionOk(now = new Date()): boolean {
  const h = now.getUTCHours();
  return h >= 7 && h < 20;
}

function nyPreferred(now = new Date()): boolean {
  const h = now.getUTCHours();
  return h >= 13 && h < 21;
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

function mapBuffers(
  snap: Record<string, Candle[]>,
  aliases: Record<string, string>
): Record<string, Candle[]> {
  const out: Record<string, Candle[]> = { ...snap };
  for (const [from, to] of Object.entries(aliases)) {
    if (snap[from]) {
      out[to] = snap[from];
      out[normalizeTf(to)] = snap[from];
    }
  }
  for (const k of Object.keys(snap)) {
    out[normalizeTf(k)] = snap[k];
  }
  return out;
}

async function evalXau(price: number): Promise<void> {
  const s = state();
  const now = Date.now();
  if (now - s.lastXauEval < 5_000) return;
  s.lastXauEval = now;

  // Gate: sem backfill completo não avalia confluences
  if (!isXauReady()) {
    diagFor("XAUUSD").idleReason = "à espera do histórico de velas (Twelve Data)";
    return;
  }

  const newsBlocked = await refreshNewsBlackout();
  const buffers = getXauBuffers().snapshot();
  const candlesByTf = mapBuffers(buffers, { H4: "H4", M15: "M15", M5: "M5" });

  const ctx: EngineContext = {
    now,
    calendarClean: !newsBlocked,
    sessionOk: londonSessionOk(new Date(now)),
    price,
    candlesByTf,
  };

  const result = evaluateStrategy(STRATEGY_XAUUSD, s.xau, ctx);
  s.xau = result.state;
  recordEval("XAUUSD", STRATEGY_XAUUSD, result, now);
  if (result.signal) {
    await emitSignalAlert(result.signal);
    s.xau.lastSignalAt = now;
  }
}

async function evalSol(price: number, spread?: number): Promise<void> {
  const s = state();
  const now = Date.now();
  if (now - s.lastSolEval < 3_000) return;
  s.lastSolEval = now;

  const buffers = getSolBuffers().snapshot();
  const m15 = buffers["15m"] || [];
  const m1 = buffers["1m"] || [];
  // SOL ready quando tem histórico mínimo
  s.solReady = m15.length >= 20 && m1.length >= 30;
  if (!s.solReady) {
    diagFor("SOLUSD").idleReason = "à espera do histórico de velas (Kraken)";
    return;
  }

  const newsBlocked = await refreshNewsBlackout();
  const candlesByTf = mapBuffers(buffers, {
    "15m": "M15",
    "1m": "M1",
    M15: "15m",
    M1: "1m",
  });

  // Liquidez oposta: máximo recente para long, mínimo recente para short.
  let takeProfitLevels: EngineContext["takeProfitLevels"];
  if (m15.length >= 5) {
    const recent = m15.slice(-10);
    takeProfitLevels = {
      long: Math.max(...recent.map((c) => c.high)),
      short: Math.min(...recent.map((c) => c.low)),
    };
  }

  const ctx: EngineContext = {
    now,
    calendarClean: !newsBlocked,
    sessionOk: nyPreferred(new Date(now)) || true,
    price,
    spread: spread ?? getSolSpread() ?? undefined,
    takeProfitLevels,
    candlesByTf,
  };

  const result = evaluateStrategy(STRATEGY_SOLUSD, s.sol, ctx);
  s.sol = result.state;
  recordEval("SOLUSD", STRATEGY_SOLUSD, result, now);
  if (result.signal) {
    await emitSignalAlert(result.signal);
    s.sol.lastSignalAt = now;
  }
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
    evalSol(tick.price, tick.spread).catch((e) =>
      console.warn("[signal-runner] sol:", e?.message || e)
    );
  });

  console.log(
    "[signal-runner] motor ligado — XAU Twelve Data (OHLC) + SOL Kraken. Só alertas. xAPI XTB descontinuada."
  );
}

export function getRunnerDebug() {
  const s = state();
  const xau = getXauMarketStatus();
  return {
    xauStep: s.xau.currentStepIndex,
    solStep: s.sol.currentStepIndex,
    xauConfirmed: s.xau.confirmed.length,
    solConfirmed: s.sol.confirmed.length,
    newsBlackout: s.newsBlackout,
    xau,
    solReady: s.solReady,
    diag: { XAUUSD: diagFor("XAUUSD"), SOLUSD: diagFor("SOLUSD") },
    /** Estado agregado para /api/signals */
    status: !xau.ready
      ? xau.status === "error"
        ? "error"
        : "warming_up"
      : s.solReady
        ? "ready"
        : "warming_up",
  };
}
