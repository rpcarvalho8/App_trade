import { NextResponse } from "next/server";
import { broadcastAlert, connectedClients, type MarketAlert } from "@/lib/alert-ws";
import { sendTelegramAlert, telegramConfigured } from "@/lib/alert-telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Emite um alerta de teste por todos os canais (toast/notificação + Telegram).
 * POST /api/alerts/test  (opcional body: { level, title, message })
 * Responde com o resultado de cada canal, para saberes qual está a falhar.
 */
export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  const level = ["info", "warning", "critical"].includes(body?.level) ? body.level : "critical";
  const alert: MarketAlert = {
    id: `test-${Date.now()}`,
    ts: Date.now(),
    type: "signal",
    level,
    asset: body?.asset || "TESTE",
    title: body?.title || "Alerta de teste",
    message: body?.message || "Se estás a ler isto, o canal de alertas funciona.",
  };
  // broadcastAlert já tenta o Telegram para "signal"; aqui medimos o resultado à parte.
  const { type: _t, ...rest } = alert;
  void _t;
  broadcastAlert({ ...rest, type: "price" });
  let telegram: string = telegramConfigured() ? "pendente" : "não configurado (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)";
  if (telegramConfigured()) {
    try {
      telegram = (await sendTelegramAlert(alert, true)) ? "enviado" : "falhou";
    } catch (e: any) {
      telegram = `erro: ${e?.message || e}`;
    }
  }
  return NextResponse.json({ ok: true, browserClients: connectedClients(), telegram });
}
