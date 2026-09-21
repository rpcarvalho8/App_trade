import { NextResponse } from "next/server";
import { initDB } from "@/lib/db";
import { listRecentSignals, ensureSignalsTable } from "@/lib/signals";
import { getRunnerDebug } from "@/lib/marketdata/signal-runner";
import { STRATEGIES } from "@/lib/strategies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lista sinais recentes + estado do runner (debug). */
export async function GET() {
  await initDB();
  await ensureSignalsTable();
  const signals = await listRecentSignals(40);
  return NextResponse.json({
    signals,
    strategies: Object.keys(STRATEGIES),
    runner: getRunnerDebug(),
    note: "Motor só ALERTA — execução manual na corretora.",
  });
}
