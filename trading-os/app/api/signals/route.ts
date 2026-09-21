import { NextResponse } from "next/server";
import { initDB } from "@/lib/db";
import { listRecentSignals, ensureSignalsTable } from "@/lib/signals";
import { getRunnerDebug } from "@/lib/marketdata/signal-runner";
import { getXauMarketStatus, getXauCacheStats } from "@/lib/marketdata/xtb-client";
import { STRATEGIES } from "@/lib/strategies";
import { ensureCandleCacheTable } from "@/lib/marketdata/candle-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lista sinais recentes + estado do runner (warm-up / beta). */
export async function GET() {
  await initDB();
  await ensureSignalsTable();
  await ensureCandleCacheTable();
  const signals = await listRecentSignals(40);
  const runner = getRunnerDebug();
  const xau = getXauMarketStatus();
  const cache = await getXauCacheStats().catch(() => ({}));

  return NextResponse.json({
    status: runner.status, // warming_up | ready | error
    signals,
    strategies: Object.keys(STRATEGIES),
    assets: {
      XAUUSD: {
        ...xau,
        mode: "beta", // UI: badge beta/observação até calibração XTB confirmada
        label: xau.beta ? "beta / observação" : "live",
        cacheBars: cache,
      },
      SOLUSD: {
        status: runner.solReady ? "ready" : "warming_up",
        beta: false,
        source: "kraken",
        label: "live",
      },
    },
    runner,
    note: "Motor só ALERTA — execução manual na corretora. XAUUSD em beta enquanto a fonte OHLC não for xAPI XTB verificada.",
  });
}
