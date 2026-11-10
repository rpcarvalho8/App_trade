import { NextResponse } from "next/server";
import { WS_PORT, recentAlerts, connectedClients } from "@/lib/alert-ws";
import { getThresholds } from "@/lib/alert-engine";
import { telegramConfigured } from "@/lib/alert-telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Expõe a porta do WebSocket, os alertas recentes (reidratação do frontend),
 * os limiares de volatilidade activos e os canais de entrega configurados.
 */
export async function GET() {
  return NextResponse.json({
    wsPort: WS_PORT,
    thresholds: getThresholds(),
    recent: recentAlerts(),
    channels: {
      telegram: telegramConfigured(),
      email: !!(process.env.ALERT_EMAIL_TO && (process.env.RESEND_API_KEY || process.env.ALERT_EMAIL_WEBHOOK)),
      wsClients: connectedClients(),
    },
  });
}
