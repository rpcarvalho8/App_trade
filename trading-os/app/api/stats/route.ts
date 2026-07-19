import { NextResponse } from "next/server";
import { initDB, db } from "@/lib/db";

export async function GET() {
  await initDB();

  const totals = await db.execute(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN outcome='LOSS' THEN 1 ELSE 0 END) as losses,
      SUM(CASE WHEN outcome='BE' THEN 1 ELSE 0 END) as breakevens,
      COALESCE(SUM(pnl),0) as total_pnl,
      COALESCE(AVG(CASE WHEN outcome='WIN' THEN pnl END),0) as avg_win,
      COALESCE(AVG(CASE WHEN outcome='LOSS' THEN pnl END),0) as avg_loss,
      COALESCE(AVG(rr_real),0) as avg_rr,
      SUM(CASE WHEN followed_plan=0 THEN 1 ELSE 0 END) as violations
    FROM trades WHERE outcome != 'RUNNING'
  `);

  const bySetup = await db.execute(`
    SELECT setup, COUNT(*) as total,
      SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins,
      COALESCE(SUM(pnl),0) as pnl,
      COALESCE(AVG(rr_real),0) as avg_rr
    FROM trades WHERE outcome != 'RUNNING'
    GROUP BY setup ORDER BY pnl DESC
  `);

  const bySession = await db.execute(`
    SELECT session, COUNT(*) as total,
      SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins,
      COALESCE(SUM(pnl),0) as pnl
    FROM trades WHERE outcome != 'RUNNING'
    GROUP BY session
  `);

  const byMental = await db.execute(`
    SELECT mental_state, COUNT(*) as total,
      SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins,
      COALESCE(SUM(pnl),0) as pnl
    FROM trades WHERE outcome != 'RUNNING'
    GROUP BY mental_state ORDER BY mental_state
  `);

  const daily = await db.execute(`
    SELECT date, COALESCE(SUM(pnl),0) as pnl, COUNT(*) as trades
    FROM trades WHERE outcome != 'RUNNING'
    GROUP BY date ORDER BY date ASC LIMIT 60
  `);

  const row = totals.rows[0] as any;
  const wins = Number(row.wins || 0);
  const losses = Number(row.losses || 0);
  const wr = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : "0";

  return NextResponse.json({
    summary: { ...row, wins, losses, win_rate: wr },
    bySetup: bySetup.rows,
    bySession: bySession.rows,
    byMental: byMental.rows,
    daily: daily.rows,
  });
}
