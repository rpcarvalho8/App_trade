/**
 * Liga o engine às streams XAU (xtb-client) e SOL (kraken-client).
 * Avalia estratégias em cada tick / fecho de vela; emite alertas sem executar ordens.
 */
import {
  STRATEGY_XAUUSD,
  STRATEGY_SOLUSD,
  evaluateStrategy,
  createEngineState,
  normalizeTf,
} from "@/lib/strategies";
import type { EngineContext, EngineState, Candle } from "@/lib/strategies/types";
import { getXauBuffers, onXauTick, startXtbClient } from "@/lib/marketdata/xtb-client";
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
    } as RunnerState;
  }
  return g.__tosSignalRunner as RunnerState;
}

function londonSessionOk(now = new Date()): boolean {
  // Europe/London approx via UTC: London cash ~07:00–16:00 UTC (inverno) / 06–15 (verão).
  // Usamos 07:00–20:00 UTC para cobrir London + overlap NY.
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
    // Em falha de calendário, não bloqueamos (false = limpo)
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
  // Também normaliza chaves existentes
  for (const k of Object.keys(snap)) {
    out[normalizeTf(k)] = snap[k];
  }
  return out;
}

async function evalXau(price: number): Promise<void> {
  const s = state();
  const now = Date.now();
  if (now - s.lastXauEval < 5_000) return; // throttle
  s.lastXauEval = now;

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
  if (result.signal) {
    if (s.xau.lastSignalAt && now - (s.xau.lastSignalAt || 0) < s.cooldownMs) {
      // cooldown já aplicado via reset state lastSignalAt
    }
    await emitSignalAlert(result.signal);
    s.xau.lastSignalAt = now;
  }
}

async function evalSol(price: number, spread?: number): Promise<void> {
  const s = state();
  const now = Date.now();
  if (now - s.lastSolEval < 3_000) return;
  s.lastSolEval = now;

  const newsBlocked = await refreshNewsBlackout();
  const buffers = getSolBuffers().snapshot();
  const candlesByTf = mapBuffers(buffers, {
    "15m": "M15",
    "1m": "M1",
    M15: "15m",
    M1: "1m",
  });

  // Liquidez oposta 15m como TP heurístico
  const m15 = candlesByTf["15m"] || candlesByTf["M15"] || [];
  let takeProfitLevel: number | undefined;
  if (m15.length >= 5) {
    const recent = m15.slice(-10);
    takeProfitLevel = Math.max(...recent.map((c) => c.high)); // ajustado no engine por direção
  }

  const ctx: EngineContext = {
    now,
    calendarClean: !newsBlocked,
    sessionOk: nyPreferred(new Date(now)) || true, // preferred, não hard block
    price,
    spread: spread ?? getSolSpread() ?? undefined,
    takeProfitLevel,
    candlesByTf,
  };

  const result = evaluateStrategy(STRATEGY_SOLUSD, s.sol, ctx);
  s.sol = result.state;
  if (result.signal) {
    await emitSignalAlert(result.signal);
    s.sol.lastSignalAt = now;
  }
}

/** Arranca streams + avaliação do motor (idempotente). */
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
    "[signal-runner] motor ligado a xtb-client (XAUUSD H4/M15/M5) e kraken-client (SOLUSD 15m/1m). Só alertas — sem execução automática."
  );
}

export function getRunnerDebug() {
  const s = state();
  return {
    xauStep: s.xau.currentStepIndex,
    solStep: s.sol.currentStepIndex,
    xauConfirmed: s.xau.confirmed.length,
    solConfirmed: s.sol.confirmed.length,
    newsBlackout: s.newsBlackout,
  };
}
