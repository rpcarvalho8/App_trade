import { NextResponse } from "next/server";
import { broadcastAlert } from "@/lib/alert-ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Emite um alerta de demonstração para testar o fluxo de toasts em tempo real.
 * Útil para verificar a ligação WebSocket sem esperar por um movimento de mercado.
 * POST /api/alerts/test  (opcional body: { level, title, message })
 */
export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const level = ["info", "warning", "critical"].includes(body?.level) ? body.level : "warning";
  broadcastAlert({
    id: `test-${Date.now()}`,
    ts: Date.now(),
    type: "price",
    level,
    asset: body?.asset || "BTCUSD",
    title: body?.title || "Alerta de teste",
    message: body?.message || "Este é um alerta de demonstração do motor em tempo real.",
  });
  return NextResponse.json({ ok: true });
}
