import { NextRequest, NextResponse } from "next/server";
import { initDB, db } from "@/lib/db";

// Ensure table exists
async function ensureTable() {
  await initDB();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS weekly_journals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_start TEXT NOT NULL UNIQUE,
      week_end TEXT NOT NULL,
      overall_grade TEXT DEFAULT 'B',
      pnl_total REAL DEFAULT 0,
      trades_count INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      violations INTEGER DEFAULT 0,
      best_trade TEXT DEFAULT '',
      worst_trade TEXT DEFAULT '',
      technical_review TEXT DEFAULT '',
      psychological_review TEXT DEFAULT '',
      rule_compliance TEXT DEFAULT '',
      setups_analysis TEXT DEFAULT '',
      goals_met TEXT DEFAULT '',
      goals_next_week TEXT DEFAULT '',
      mindset_notes TEXT DEFAULT '',
      lessons TEXT DEFAULT '',
      avg_sleep REAL DEFAULT 0,
      avg_stress REAL DEFAULT 0,
      avg_focus REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

export async function GET(req: NextRequest) {
  await ensureTable();
  const { searchParams } = new URL(req.url);
  const week = searchParams.get("week");
  if (week) {
    const r = await db.execute({ sql: "SELECT * FROM weekly_journals WHERE week_start = ?", args: [week] });
    if (r.rows.length === 0) return NextResponse.json(null);
    // Also fetch trades for this week
    const trades = await db.execute({
      sql: "SELECT * FROM trades WHERE date >= ? AND date <= ? ORDER BY date",
      args: [week, (r.rows[0] as any).week_end]
    });
    return NextResponse.json({ journal: r.rows[0], trades: trades.rows });
  }
  const r = await db.execute("SELECT * FROM weekly_journals ORDER BY week_start DESC LIMIT 20");
  return NextResponse.json(r.rows);
}

export async function POST(req: NextRequest) {
  await ensureTable();
  const b = await req.json();
  // Calculate stats from trades in this week
  const tradesRes = await db.execute({
    sql: "SELECT * FROM trades WHERE date >= ? AND date <= ? AND outcome != 'RUNNING'",
    args: [b.week_start, b.week_end]
  });
  const trades = tradesRes.rows as any[];
  const pnl = trades.reduce((s,t) => s + Number(t.pnl||0), 0);
  const wins = trades.filter(t => t.outcome === "WIN").length;
  const losses = trades.filter(t => t.outcome === "LOSS").length;
  const violations = trades.filter(t => !t.followed_plan).length;
  const avgSleep = trades.length ? trades.reduce((s,t) => s + Number(t.sleep_quality||5), 0) / trades.length : 0;
  const avgStress = trades.length ? trades.reduce((s,t) => s + Number(t.stress_level||5), 0) / trades.length : 0;
  const avgFocus = trades.length ? trades.reduce((s,t) => s + Number(t.focus_level||5), 0) / trades.length : 0;

  const result = await db.execute({
    sql: `INSERT OR REPLACE INTO weekly_journals 
      (week_start,week_end,overall_grade,pnl_total,trades_count,wins,losses,violations,
       best_trade,worst_trade,technical_review,psychological_review,rule_compliance,
       setups_analysis,goals_met,goals_next_week,mindset_notes,lessons,avg_sleep,avg_stress,avg_focus)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      b.week_start, b.week_end, b.overall_grade||"B",
      pnl, trades.length, wins, losses, violations,
      b.best_trade||"", b.worst_trade||"",
      b.technical_review||"", b.psychological_review||"",
      b.rule_compliance||"", b.setups_analysis||"",
      b.goals_met||"", b.goals_next_week||"",
      b.mindset_notes||"", b.lessons||"",
      avgSleep, avgStress, avgFocus
    ],
  });
  return NextResponse.json({ id: Number(result.lastInsertRowid), stats: { pnl, wins, losses, trades: trades.length, violations } });
}
