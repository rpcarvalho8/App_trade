/**
 * Server bootstrap — corre uma vez no arranque do processo Node (também em `next dev`).
 *
 * Unifica no processo único do `npm run dev`:
 *   1. AI Coach: relatório semanal (cron domingo 09:00 + catch-up).
 *   2. Morning Brief: brief macro diário (cron 06:00 + catch-up no arranque).
 *   3. Motor de Alertas em tempo real + servidor WebSocket (porta 3001).
 *
 * Tudo só no runtime Node.js. A Gemini requer GEMINI_API_KEY em .env.local.
 * Catch-up NÃO bloqueia o boot: corre em setTimeout + try/catch; falhas 503 ficam deferred.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Evita duplo agendamento em hot reloads no dev.
  const g = globalThis as any;
  if (g.__tosScheduled) return;
  g.__tosScheduled = true;

  const hasKey = !!process.env.GEMINI_API_KEY;

  // ---------- 1) AI Coach semanal ----------
  const runWeekly = async (label: string) => {
    try {
      const { ensurePreviousWeekReport } = await import("@/lib/weekly-analysis");
      const res = await ensurePreviousWeekReport();
      if (res.deferred) {
        console.warn(`[AI Coach] ${label}: adiado (${res.reason}). Semana ${res.week_start}.`);
      } else {
        console.log(
          `[AI Coach] ${label}: ${res.generated ? "relatório gerado (modo texto no catch-up)" : "já existia"} para a semana ${res.week_start}`
        );
      }
    } catch (e: any) {
      // Nunca derruba o processo — retry manual em /ai-coach.
      console.warn(`[AI Coach] ${label} falhou (app continua):`, e?.message || e);
    }
  };

  // ---------- 2) Morning Brief diário ----------
  const runBrief = async (label: string) => {
    try {
      const { ensureTodayBrief, generateBrief, todayISO } = await import("@/lib/morning-brief");
      if (label.startsWith("cron")) {
        await generateBrief(todayISO());
        console.log(`[MorningBrief] ${label}: brief do dia gerado.`);
      } else {
        const res = await ensureTodayBrief();
        console.log(`[MorningBrief] ${label}: ${res.generated ? "brief gerado" : "já existia"} (${res.date}).`);
      }
    } catch (e: any) {
      console.warn(`[MorningBrief] ${label} falhou (app continua):`, e?.message || e);
    }
  };

  if (!hasKey) {
    console.warn("[TradingOS] GEMINI_API_KEY em falta — agendamentos de IA inativos até definires a chave em .env.local");
  }

  // ---------- crons ----------
  try {
    const cron = (await import("node-cron")).default;
    cron.schedule("0 9 * * 0", () => {
      if (process.env.GEMINI_API_KEY) runWeekly("cron domingo 9h");
    });
    cron.schedule("0 6 * * *", () => {
      if (process.env.GEMINI_API_KEY) runBrief("cron 06:00");
    });
    console.log("[TradingOS] crons ativos: AI Coach (dom 09:00) · Morning Brief (diário 06:00)");
  } catch (e: any) {
    console.error("[TradingOS] não foi possível iniciar os crons:", e?.message || e);
  }

  // ---------- 3) Motor de alertas + WebSocket ----------
  try {
    const { startAlertWs } = await import("@/lib/alert-ws");
    const { startAlertEngine } = await import("@/lib/alert-engine");
    await startAlertWs();
    startAlertEngine();
  } catch (e: any) {
    console.error("[Alerts] não foi possível arrancar o motor de alertas:", e?.message || e);
  }

  // ---------- catch-up no arranque (só com chave) ----------
  // Brief primeiro (leve / cache). Coach depois em modo texto. Nunca bloqueia o boot.
  if (hasKey) {
    setTimeout(async () => {
      await runBrief("catch-up no arranque");
      await runWeekly("catch-up no arranque");
    }, 5000);
  }
}
