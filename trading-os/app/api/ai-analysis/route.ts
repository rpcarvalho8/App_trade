import { NextRequest, NextResponse } from "next/server";
import { initDB, db } from "@/lib/db";
import { generateWeeklyReport, previousWeekRange } from "@/lib/weekly-analysis";

// Weekly analysis can take a while (vision over many screenshots).
export const maxDuration = 300;

/**
 * GET
 *  - no params            -> list of weekly reports (metadata, newest first)
 *  - ?week=YYYY-MM-DD      -> full analysis JSON for that week (or null)
 *  - ?latest=1            -> most recent weekly report (or null)
 */
export async function GET(req: NextRequest) {
  await initDB();
  const { searchParams } = new URL(req.url);
  const week = searchParams.get("week");
  const latest = searchParams.get("latest");

  if (week) {
    const r = await db.execute({
      sql: "SELECT analysis FROM ai_analyses WHERE period='weekly' AND week_start=? ORDER BY created_at DESC LIMIT 1",
      args: [week],
    });
    if (r.rows.length === 0) return NextResponse.json(null);
    return NextResponse.json(JSON.parse((r.rows[0] as any).analysis));
  }

  if (latest) {
    const r = await db.execute(
      "SELECT analysis FROM ai_analyses WHERE period='weekly' ORDER BY week_start DESC LIMIT 1"
    );
    if (r.rows.length === 0) return NextResponse.json(null);
    return NextResponse.json(JSON.parse((r.rows[0] as any).analysis));
  }

  // List metadata for all weekly reports.
  const rows = await db.execute(
    "SELECT week_start, week_end, analysis, created_at FROM ai_analyses WHERE period='weekly' ORDER BY week_start DESC LIMIT 104"
  );
  const list = rows.rows.map((r: any) => {
    let a: any = {};
    try {
      a = JSON.parse(r.analysis);
    } catch {}
    return {
      week_start: r.week_start,
      week_end: r.week_end,
      created_at: r.created_at,
      overall_score: a.overall_score ?? null,
      grade: a.grade ?? null,
      pnl: a.week_stats?.pnl ?? null,
      trades: a.week_stats?.trades ?? null,
      win_rate: a.week_stats?.win_rate ?? null,
    };
  });
  const prev = previousWeekRange();
  const hasPrev = list.some((x) => x.week_start === prev.week_start);
  return NextResponse.json({ reports: list, previous_week: prev, previous_week_generated: hasPrev });
}

/**
 * POST -> generate (or regenerate) the weekly report.
 * body: { week_start?, week_end? }  (omit to use the previous full week)
 */
export async function POST(req: NextRequest) {
  await initDB();
  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  try {
    const result = await generateWeeklyReport(body.week_start, body.week_end);
    return NextResponse.json(result.analysis);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Erro ao gerar análise" }, { status: 500 });
  }
}
