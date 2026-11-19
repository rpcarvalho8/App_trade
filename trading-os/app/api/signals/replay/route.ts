import { NextResponse } from "next/server";
import { initDB } from "@/lib/db";
import { loadCachedCandles } from "@/lib/marketdata/candle-cache";
import { STRATEGIES_BY_SYMBOL } from "@/lib/strategies";
import { replayStrategies } from "@/lib/strategies/replay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/**
 * GET /api/signals/replay?days=3
 * Corre as estratégias do ouro sobre as velas guardadas na cache local e mostra onde a sequência pára.
 * Não grava sinais nem envia alertas.
 */
export async function GET(req: Request) {
  await initDB();
  const url = new URL(req.url);
  const days = Math.min(10, Math.max(1, Number(url.searchParams.get("days")) || 3));
  const to = Date.now();
  const from = to - days * DAY;
  // Histórico antes da janela para o bias H4, as zonas e os swings.
  const [M5, M15, H4] = await Promise.all([
    loadCachedCandles("XAUUSD", "M5", from - 2 * DAY),
    loadCachedCandles("XAUUSD", "M15", from - 7 * DAY),
    loadCachedCandles("XAUUSD", "H4", from - 45 * DAY),
  ]);
  const reports = replayStrategies(STRATEGIES_BY_SYMBOL.XAUUSD, { M5, M15, H4 }, from, to);
  return NextResponse.json({
    symbol: "XAUUSD",
    window: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), days },
    bars: { M5: M5.length, M15: M15.length, H4: H4.length },
    firstBar: { M5: M5[0]?.time ? new Date(M5[0].time).toISOString() : null },
    lastBar: { M5: M5.at(-1)?.time ? new Date(M5.at(-1)!.time).toISOString() : null },
    reports,
  });
}
