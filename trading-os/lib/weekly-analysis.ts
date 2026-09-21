import { initDB, db } from "@/lib/db";
import { callGeminiJSON, imagePartFromUrl, GeminiPart } from "@/lib/gemini";

/** Returns the Mon..Sun range (YYYY-MM-DD) of the week that contains `ref`. */
export function weekRangeOf(ref: Date): { week_start: string; week_end: string } {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (x: Date) => x.toISOString().slice(0, 10);
  return { week_start: fmt(monday), week_end: fmt(sunday) };
}

/** The previous full Mon..Sun week relative to `now` (defaults to today). */
export function previousWeekRange(now = new Date()): { week_start: string; week_end: string } {
  const lastWeek = new Date(now);
  lastWeek.setUTCDate(now.getUTCDate() - 7);
  return weekRangeOf(lastWeek);
}

// Limit screenshots to keep free-tier payloads under control (compressed JPEG via sharp).
const MAX_IMAGES = 12;

const SHOT_LABELS: Record<string, string> = {
  screenshot_before: "ANTES",
  screenshot_entry: "ENTRADA",
  screenshot_after: "DEPOIS",
};

function num(v: any, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function isOverloadError(e: any): boolean {
  const msg = String(e?.message || e || "");
  return /503|429|sobrecarreg|indispon|UNAVAILABLE/i.test(msg);
}

export interface WeeklyResult {
  week_start: string;
  week_end: string;
  trades_count: number;
  analysis: any;
  images_sent: number;
}

export type GenerateWeeklyOptions = {
  /** Cap on screenshots (0 = text-only). Defaults to MAX_IMAGES. */
  maxImages?: number;
};

/**
 * Generates the weekly AI Coach report for the given week (defaults to the
 * previous full week) and stores it in ai_analyses. Uses Gemini with vision:
 * every trade's screenshots (before/entry/after) are sent for chart analysis.
 * On Gemini 503/429 with images, retries once text-only (lighter payload).
 */
export async function generateWeeklyReport(
  weekStart?: string,
  weekEnd?: string,
  opts: GenerateWeeklyOptions = {}
): Promise<WeeklyResult> {
  await initDB();

  const range = weekStart && weekEnd ? { week_start: weekStart, week_end: weekEnd } : previousWeekRange();
  const { week_start, week_end } = range;
  const imageCap = opts.maxImages ?? MAX_IMAGES;

  // Trades in the week (dates are stored as YYYY-MM-DD or ISO; compare on date prefix).
  const tradesRes = await db.execute({
    sql: "SELECT * FROM trades WHERE substr(date,1,10) >= ? AND substr(date,1,10) <= ? ORDER BY date, id",
    args: [week_start, week_end],
  });
  const trades = tradesRes.rows as any[];

  const mentalRes = await db.execute({
    sql: "SELECT * FROM mental_logs WHERE substr(date,1,10) >= ? AND substr(date,1,10) <= ? ORDER BY date",
    args: [week_start, week_end],
  });
  const mentalLogs = mentalRes.rows as any[];

  // Aggregate stats (only closed trades count for W/L/pnl).
  const closed = trades.filter((t) => t.outcome !== "RUNNING");
  const wins = closed.filter((t) => t.outcome === "WIN").length;
  const losses = closed.filter((t) => t.outcome === "LOSS").length;
  const be = closed.filter((t) => t.outcome === "BE").length;
  const pnl = closed.reduce((s, t) => s + num(t.pnl), 0);
  const violations = closed.filter((t) => !num(t.followed_plan, 1)).length;
  const avg = (f: string) =>
    closed.length ? closed.reduce((s, t) => s + num(t[f], 5), 0) / closed.length : 0;
  const stats = {
    trades: closed.length,
    open: trades.length - closed.length,
    wins,
    losses,
    be,
    win_rate: wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0,
    pnl: Math.round(pnl * 100) / 100,
    violations,
    avg_rr: Math.round(avg("rr_real") * 100) / 100,
    avg_sleep: Math.round(avg("sleep_quality") * 10) / 10,
    avg_stress: Math.round(avg("stress_level") * 10) / 10,
    avg_anxiety: Math.round(avg("anxiety_level") * 10) / 10,
    avg_focus: Math.round(avg("focus_level") * 10) / 10,
    avg_confidence: Math.round(avg("confidence_level") * 10) / 10,
  };

  const tradeSummaries = trades.map((t) => {
    const { screenshot_before, screenshot_entry, screenshot_after, created_at, ...rest } = t;
    return rest;
  });

  const parts: GeminiPart[] = [];
  let imagesSent = 0;

  const visionNote =
    imageCap <= 0
      ? "Nesta execução NÃO recebes screenshots (modo texto — a API estava saturada ou o catch-up pediu leve). Analisa só números e notas; deixa screenshot_analysis vazio ou genérico."
      : "Recebes SCREENSHOTS prioritários da ENTRADA (e before/after se couber no limite). Analisa-os visualmente.";

  const intro = `És um coach de trading de elite (Wyckoff, Elliott Wave, ICT/SMC e psicologia de trading).
Vais analisar a SEMANA de ${week_start} a ${week_end} de um trader.
Recebes: (1) estatísticas agregadas, (2) os dados completos de cada trade — técnicos E psicológicos (sono, stress, ansiedade, foco, confiança, se seguiu o plano, notas, lições, estado emocional). ${visionNote}

Liga SEMPRE o estado psicológico ao desempenho técnico. Sê específico e usa os números reais.

ESTATÍSTICAS DA SEMANA: ${JSON.stringify(stats)}
LOGS MENTAIS DA SEMANA: ${JSON.stringify(mentalLogs.map((m) => { const { created_at, ...r } = m; return r; }))}

A seguir vêm os trades da semana, um a um.`;
  parts.push({ text: intro });

  for (const t of tradeSummaries) {
    parts.push({
      text: `\n=== TRADE #${t.id} | ${t.date} | ${t.pair} ${t.direction} | setup: ${t.setup} | resultado: ${t.outcome} | pnl: ${t.pnl} ===\nDADOS: ${JSON.stringify(t)}`,
    });
  }

  // Screenshots after all trade text: entry first (highest signal), then before/after.
  if (imageCap > 0) {
    const imagePasses = [
      ["screenshot_entry"] as const,
      ["screenshot_before", "screenshot_after"] as const,
    ];
    for (const fields of imagePasses) {
      for (const t of tradeSummaries) {
        for (const field of fields) {
          if (imagesSent >= imageCap) break;
          const orig = trades.find((x) => x.id === t.id);
          const realUrl = orig ? orig[field] : "";
          if (!realUrl) continue;
          const img = await imagePartFromUrl(realUrl);
          if (img) {
            parts.push({ text: `Screenshot ${SHOT_LABELS[field]} do trade #${t.id}:` });
            parts.push(img);
            imagesSent++;
          }
        }
        if (imagesSent >= imageCap) break;
      }
      if (imagesSent >= imageCap) break;
    }
  }

  const schema = `\n\nDevolve APENAS JSON puro com EXATAMENTE esta estrutura (sem markdown, sem texto fora do JSON):
{
  "overall_score": <1-10>,
  "technical_score": <1-10>,
  "psychological_score": <1-10>,
  "grade": "<A|B|C|D|E>",
  "summary": "<resumo executivo da semana em 2-3 frases>",
  "detailed_report": "<relatório detalhado e corrido da semana: contexto, o que correu bem, o que correu mal, execução técnica, disciplina, gestão de risco e psicologia. Vários parágrafos. Usa \\n\\n entre parágrafos.>",
  "psychological_profile": {
    "dominant_pattern": "<padrão psicológico dominante da semana>",
    "sleep_impact": "<impacto do sono com dados>",
    "stress_impact": "<impacto de stress/ansiedade com dados>",
    "best_mental_conditions": "<quando rendeu melhor>",
    "worst_mental_conditions": "<quando rendeu pior>"
  },
  "technical_insights": {
    "best_setup": "<melhor setup da semana e porquê, com dados>",
    "worst_setup": "<pior setup e porquê>",
    "entry_quality": "<qualidade das entradas com base nos screenshots ou nos dados se não houver imagens>",
    "setup_psychology_link": "<como o estado mental afetou a execução>"
  },
  "screenshot_analysis": [
    {"trade_ref": "<#id e par>", "observation": "<o que observaste no(s) gráfico(s), ou 'sem screenshot nesta geração'>"}
  ],
  "strengths": [{"title": "<título>", "detail": "<detalhe com dados>"}],
  "weaknesses": [{"title": "<título>", "detail": "<detalhe>", "severity": "high|medium|low"}],
  "patterns": [{"pattern": "<padrão detectado>", "trigger": "<o que despoleta>", "impact": "<impacto>", "action": "<ação concreta>"}],
  "do_next_week": ["<o que FAZER na próxima semana — ações concretas>"],
  "dont_next_week": ["<o que NÃO fazer na próxima semana — erros a evitar>"],
  "study_plan": [{"priority": 1, "topic": "<tópico>", "reason": "<porquê>", "resource": "<como estudar>"}],
  "next_week_focus": "<foco principal da próxima semana>"
}`;
  parts.push({ text: schema });

  let analysis: any;
  if (closed.length === 0 && trades.length === 0) {
    analysis = {
      overall_score: 0,
      technical_score: 0,
      psychological_score: 0,
      grade: "-",
      summary: "Sem trades registados nesta semana.",
      detailed_report:
        "Não há trades registados entre " +
        week_start +
        " e " +
        week_end +
        ". Não é possível gerar análise. Regista os trades da semana e volta a gerar o relatório.",
      psychological_profile: {},
      technical_insights: {},
      screenshot_analysis: [],
      strengths: [],
      weaknesses: [],
      patterns: [],
      do_next_week: [],
      dont_next_week: [],
      study_plan: [],
      next_week_focus: "",
    };
  } else {
    try {
      analysis = await callGeminiJSON(parts);
    } catch (e) {
      // Vision payloads are large and hit free-tier 503 more than Morning Brief text.
      if (imageCap > 0 && isOverloadError(e)) {
        console.warn(
          "[AI Coach] Gemini saturada com screenshots; a tentar relatório só-texto (mais leve)…"
        );
        return generateWeeklyReport(week_start, week_end, { maxImages: 0 });
      }
      throw e;
    }
  }

  analysis.week_start = week_start;
  analysis.week_end = week_end;
  analysis.week_stats = stats;
  analysis.generated_at = new Date().toISOString();
  if (imagesSent === 0 && (closed.length > 0 || trades.length > 0)) {
    analysis.vision_mode = "text_only";
    analysis.summary = (analysis.summary || "") + " (gerado sem análise visual dos gráficos — Gemini saturada ou modo leve.)";
  } else {
    analysis.vision_mode = "with_screenshots";
  }

  await db.execute({
    sql: "DELETE FROM ai_analyses WHERE period='weekly' AND week_start=?",
    args: [week_start],
  });
  await db.execute({
    sql: "INSERT INTO ai_analyses (period, week_start, week_end, analysis) VALUES ('weekly', ?, ?, ?)",
    args: [week_start, week_end, JSON.stringify(analysis)],
  });

  return { week_start, week_end, trades_count: trades.length, analysis, images_sent: imagesSent };
}

/** Ensures the previous full week has a report; generates it if missing. Used by the scheduler/catch-up. */
export async function ensurePreviousWeekReport(
  now = new Date()
): Promise<{ generated: boolean; week_start: string; deferred?: boolean; reason?: string }> {
  await initDB();
  const { week_start } = previousWeekRange(now);
  const existing = await db.execute({
    sql: "SELECT id FROM ai_analyses WHERE period='weekly' AND week_start=? LIMIT 1",
    args: [week_start],
  });
  if (existing.rows.length > 0) return { generated: false, week_start };
  try {
    // Catch-up: text-first to avoid competing with Morning Brief and free-tier vision limits.
    await generateWeeklyReport(undefined, undefined, { maxImages: 0 });
    return { generated: true, week_start };
  } catch (e: any) {
    if (isOverloadError(e)) {
      return {
        generated: false,
        week_start,
        deferred: true,
        reason: "Gemini saturada — gera mais tarde em /ai-coach",
      };
    }
    throw e;
  }
}
