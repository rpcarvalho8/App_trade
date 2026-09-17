import { NextResponse } from "next/server";
import { initDB, db } from "@/lib/db";
import { fetchCalendar, todayISO } from "@/lib/morning-brief";
import { canonicalizePair } from "@/lib/pairs";
import { PLAYBOOKS, type SessionAsset } from "@/lib/playbooks";
import { recentAlerts } from "@/lib/alert-ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = "Mozilla/5.0 (compatible; TradingOS-Session/1.0)";

async function getJSON(url: string, timeout = 12000): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchPrices(): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = { XAUUSD: null, SOLUSD: null, BTCUSD: null };
  await Promise.all([
    (async () => {
      try {
        const g = (await getJSON("https://api.gold-api.com/price/XAU")) as { price?: number };
        out.XAUUSD = typeof g?.price === "number" ? g.price : null;
      } catch { /* fonte opcional */ }
    })(),
    (async () => {
      try {
        const c = (await getJSON(
          "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,solana&vs_currencies=usd"
        )) as { bitcoin?: { usd?: number }; solana?: { usd?: number } };
        out.BTCUSD = c?.bitcoin?.usd ?? null;
        out.SOLUSD = c?.solana?.usd ?? null;
      } catch { /* fonte opcional */ }
    })(),
  ]);
  return out;
}

function minutesUntil(iso: string): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (t - Date.now()) / 60000;
}

export async function GET() {
  await initDB();
  const date = todayISO();

  const [prices, cal] = await Promise.all([
    fetchPrices(),
    fetchCalendar(date).catch(() => ({ today: [], todayHighImpact: [], weekHighImpact: [] })),
  ]);

  const upcomingHigh = (cal.todayHighImpact || [])
    .map((e) => {
      const mins = minutesUntil(e.date);
      return { ...e, minutesUntil: mins };
    })
    .filter((e) => e.minutesUntil == null || e.minutesUntil > -15)
    .sort((a, b) => (a.minutesUntil ?? 9999) - (b.minutesUntil ?? 9999));

  const blackoutAll = upcomingHigh.some((e) => e.minutesUntil != null && e.minutesUntil >= 0 && e.minutesUntil <= 30);
  const blackoutUSD = upcomingHigh.some(
    (e) =>
      e.minutesUntil != null &&
      e.minutesUntil >= 0 &&
      e.minutesUntil <= 30 &&
      String(e.country || "").toUpperCase() === "USD"
  );

  const tradesRes = await db.execute({
    sql: `SELECT id, date, pair, direction, setup, session, outcome, pnl, risk_percent, created_at
          FROM trades WHERE date = ? ORDER BY id DESC`,
    args: [date],
  });
  const todayTrades = tradesRes.rows as unknown as Array<{
    id: number;
    pair: string;
    outcome: string;
    pnl: number | null;
    risk_percent: number | null;
  }>;

  function pairState(asset: SessionAsset) {
    const pb = PLAYBOOKS[asset];
    const rows = todayTrades.filter((t) => canonicalizePair(t.pair) === asset);
    const count = rows.length;
    const pnl = rows.reduce((s, t) => s + Number(t.pnl || 0), 0);
    const lossRisk = rows
      .filter((t) => t.outcome === "LOSS")
      .reduce((s, t) => s + Number(t.risk_percent || 0), 0);

    let consecutiveLosses = 0;
    for (const t of rows) {
      if (t.outcome === "LOSS") consecutiveLosses += 1;
      else if (t.outcome === "RUNNING") continue;
      else break;
    }

    const hitMaxTrades = count >= pb.maxTrades;
    const hitDD = lossRisk >= pb.maxDailyDD;
    const needPause = consecutiveLosses >= pb.pauseAfterLosses;
    const closed = hitMaxTrades || hitDD;

    return {
      count,
      pnl,
      lossRisk,
      consecutiveLosses,
      maxTrades: pb.maxTrades,
      maxDailyDD: pb.maxDailyDD,
      hitMaxTrades,
      hitDD,
      needPause,
      pauseMinutes: pb.pauseMinutes,
      closed,
    };
  }

  return NextResponse.json({
    date,
    prices,
    calendar: {
      upcomingHigh: upcomingHigh.slice(0, 8),
      blackoutAll,
      blackoutUSD,
    },
    alerts: recentAlerts().slice(0, 8),
    byAsset: {
      XAUUSD: pairState("XAUUSD"),
      SOLUSD: pairState("SOLUSD"),
    },
  });
}
