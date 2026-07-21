import { NextResponse } from "next/server";
import { WS_PORT, recentAlerts } from "@/lib/alert-ws";
import { getThresholds } from "@/lib/alert-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Expõe a porta do WebSocket, os alertas recentes (reidratação do frontend)
 * e os limiares de volatilidade atualmente ativos (lidos do process.env).
 */
export async function GET() {
  return NextResponse.json({
    wsPort: WS_PORT,
    thresholds: getThresholds(),
    recent: recentAlerts(),
  });
}
