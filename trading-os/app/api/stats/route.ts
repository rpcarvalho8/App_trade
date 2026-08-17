import { NextResponse } from "next/server";
import { initDB, db } from "@/lib/db";
import { canonicalizePair } from "@/lib/pairs";

function regroupByPair(rows: Array<Record<string, unknown>>) {
  const map = new Map<string, { pair: string; total: number; wins: number; pnl: number; rrSum: number; rrN: number }>();
  for (const r of rows) {
    const pair = canonicalizePair(String(r.pair ?? "")) || String(r.pair ?? "?");
    const cur = map.get(pair) || { pair, total: 0, wins: 0, pnl: 0, rrSum: 0, rrN: 0 };
    cur.total += Number(r.total || 0);
    cur.wins += Number(r.wins || 0);
    cur.pnl += Number(r.pnl || 0);
    const avg = Number(r.avg_rr || 0);
    const n = Number(r.total || 0);
    if (n > 0 && Number.isFinite(avg)) {
      cur.rrSum += avg * n;
      cur.rrN += n;
    }
    map.set(pair, cur);
  }
  return [...map.values()]
    .map((x) => ({ pair: x.pair, total: x.total, wins: x.wins, pnl: x.pnl, avg_rr: x.rrN ? x.rrSum / x.rrN : 0 }))
    .sort((a, b) => b.pnl - a.pnl);
}

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

  const byPairRaw = await db.execute(`
    SELECT pair, COUNT(*) as total,
      SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) as wins,
      COALESCE(SUM(pnl),0) as pnl,
      COALESCE(AVG(rr_real),0) as avg_rr
    FROM trades WHERE outcome != 'RUNNING'
    GROUP BY pair
  `);

  const row = (totals.rows[0] || {}) as Record<string, unknown>;
  const wins = Number(row.wins || 0);
  const losses = Number(row.losses || 0);
  const wr = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : "0";

  return NextResponse.json({
    summary: { ...row, wins, losses, win_rate: wr },
    bySetup: bySetup.rows,
    byPair: regroupByPair(byPairRaw.rows as unknown as Array<Record<string, unknown>>),
    bySession: bySession.rows,
    byMental: byMental.rows,
    daily: daily.rows,
  });
}
