import { NextResponse } from "next/server";
import { WS_PORT, recentAlerts } from "@/lib/alert-ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Expõe a porta do WebSocket e os alertas recentes (para reidratar o frontend). */
export async function GET() {
  return NextResponse.json({ wsPort: WS_PORT, recent: recentAlerts() });
}
