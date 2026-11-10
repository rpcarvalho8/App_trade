/**
 * Push de alertas para o telemóvel via Telegram (grátis, sem app nova).
 *
 * Configuração em .env.local:
 *   TELEGRAM_BOT_TOKEN=123456:ABC...   (criado no @BotFather → /newbot)
 *   TELEGRAM_CHAT_ID=123456789         (o teu id; envia /start ao bot e abre
 *                                       https://api.telegram.org/bot<TOKEN>/getUpdates)
 * Opcional:
 *   TELEGRAM_ALERT_TYPES=signal,setup,calendar   (por omissão: signal,setup)
 *
 * Sem configuração não faz nada (não falha o motor).
 */
import type { MarketAlert } from "@/lib/alert-ws";

export function telegramConfigured(): boolean {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

function allowedTypes(): Set<string> {
  const raw = process.env.TELEGRAM_ALERT_TYPES || "signal,setup";
  return new Set(raw.split(",").map((x) => x.trim()).filter(Boolean));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatTelegram(alert: MarketAlert): string {
  const icon = alert.type === "signal" ? "🎯" : alert.type === "setup" ? "🟡" : alert.type === "calendar" ? "⚠️" : "📈";
  return `${icon} <b>${escapeHtml(alert.title)}</b>\n${escapeHtml(alert.message)}`;
}

/** Envia o alerta se o tipo estiver activo. Devolve true se o Telegram aceitou. */
export async function sendTelegramAlert(alert: MarketAlert, force = false): Promise<boolean> {
  if (!telegramConfigured()) return false;
  if (!force && !allowedTypes().has(alert.type)) return false;
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: formatTelegram(alert),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return true;
}
