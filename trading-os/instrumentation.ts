/**
 * Server bootstrap: schedules the weekly AI Coach report.
 *
 * - Cron: every Sunday at 09:00 (server local time) generates the report for the
 *   previous full week (Mon..Sun).
 * - Catch-up: on server start, if the previous week has no report yet, it is
 *   generated automatically (covers the case where the PC was off on Sunday 9h).
 *
 * Both only run in the Node.js runtime and require GEMINI_API_KEY to be set.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Avoid double scheduling on hot reloads in dev.
  const g = globalThis as any;
  if (g.__tosWeeklyScheduled) return;
  g.__tosWeeklyScheduled = true;

  const hasKey = !!process.env.GEMINI_API_KEY;

  const run = async (label: string) => {
    try {
      const { ensurePreviousWeekReport } = await import("@/lib/weekly-analysis");
      const res = await ensurePreviousWeekReport();
      console.log(
        `[AI Coach] ${label}: ${res.generated ? "relatório gerado" : "já existia"} para a semana ${res.week_start}`
      );
    } catch (e: any) {
      console.error(`[AI Coach] ${label} falhou:`, e?.message || e);
    }
  };

  if (!hasKey) {
    console.warn("[AI Coach] GEMINI_API_KEY em falta — agendamento semanal inativo até definires a chave em .env.local");
  }

  try {
    const cron = (await import("node-cron")).default;
    // "0 9 * * 0" = 09:00 every Sunday.
    cron.schedule("0 9 * * 0", () => {
      if (!process.env.GEMINI_API_KEY) return;
      run("cron domingo 9h");
    });
    console.log("[AI Coach] agendamento ativo: domingos às 09:00");
  } catch (e: any) {
    console.error("[AI Coach] não foi possível iniciar o cron:", e?.message || e);
  }

  // Startup catch-up (only if key present) after a short delay so the server is ready.
  if (hasKey) {
    setTimeout(() => run("catch-up no arranque"), 4000);
  }
}
