/**
 * Email de alerta de sinal (opcional).
 * Configura via env:
 *   ALERT_EMAIL_TO=tu@email.com
 *   RESEND_API_KEY=re_...   (ou ALERT_EMAIL_WEBHOOK=https://...)
 * Sem configuração: só loga — não falha o motor.
 */
import type { EngineSignal } from "@/lib/strategies/types";

export async function sendSignalEmail(signal: EngineSignal, signalId: number): Promise<boolean> {
  const to = process.env.ALERT_EMAIL_TO || process.env.SIGNAL_EMAIL_TO;
  if (!to) {
    console.log(`[alert-email] skip — ALERT_EMAIL_TO não definido (sinal #${signalId})`);
    return false;
  }

  const subject = `[TradingOS] ${signal.symbol} ${signal.direction.toUpperCase()} — ${signal.strategyId}`;
  const steps = signal.confirmedSteps
    .map((s) => `  ${s.step}. ${s.type} — ${JSON.stringify(s.details).slice(0, 200)}`)
    .join("\n");
  const auditLines = Object.entries(signal.audit)
    .map(([k, v]) => `  ${k}: step ${v.step} (${v.type})`)
    .join("\n");
  const text = [
    `Sinal #${signalId}`,
    `Estratégia: ${signal.strategyId}`,
    `Símbolo: ${signal.symbol}`,
    `Direção: ${signal.direction}`,
    `Entrada: ${signal.entry ?? "—"}`,
    `SL: ${signal.stopLoss ?? "—"}`,
    `TP: ${signal.takeProfit ?? "—"}`,
    `R:R: ${signal.rr.toFixed(2)} (mín ${signal.rrMin})`,
    ``,
    `Passos confirmados:`,
    steps,
    ``,
    `Confluências (auditoria):`,
    auditLines,
    ``,
    `⚠ Motor só ALERTA — execução manual na corretora.`,
  ].join("\n");

  const webhook = process.env.ALERT_EMAIL_WEBHOOK;
  if (webhook) {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, text, signal, signalId }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    const from = process.env.ALERT_EMAIL_FROM || "TradingOS <onboarding@resend.dev>";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    return true;
  }

  console.log(`[alert-email] would-send to=${to} subject=${subject}`);
  return false;
}
