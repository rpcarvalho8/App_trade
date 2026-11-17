import { NextResponse } from "next/server";
import { initDB, db, setSetting } from "@/lib/db";
import { fetchCalendar, todayISO } from "@/lib/morning-brief";
import { canonicalizePair } from "@/lib/pairs";
import { PLAYBOOKS, type SessionAsset } from "@/lib/playbooks";
import { recentAlerts } from "@/lib/alert-ws";
import { dailyGuard } from "@/lib/risk";
import { getEurUsd, listAccounts } from "@/lib/accounts-db";
import { toEur, type Account } from "@/lib/accounts";
import { propStatus } from "@/lib/prop-rules";

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

export async function GET(req: Request) {
  await initDB();
  const date = todayISO();
  const params = new URL(req.url).searchParams;
  let equity = Number(params.get("equity"));
  const accts: Account[] = await listAccounts().catch(() => []);
  // Sem capital no pedido: capital total das contas no servidor (prop firms + corretoras), em EUR.
  if (!(Number.isFinite(equity) && equity > 0)) {
    const eurusd = await getEurUsd().catch(() => null);
    equity = accts.reduce((sum, a) => sum + toEur(a.equity, a.currency, eurusd), 0);
  }
  // Regras de cada prop firm (perda diária, perda total, profit target).
  const now = Date.now();
  const prop = accts.map((a) => propStatus(a, now)).filter((s) => s != null);
  // O motor de sinais lê daqui o capital para sugerir o lote e o stop máximo.
  if (Number.isFinite(equity) && equity > 0) await setSetting("equity", String(equity)).catch(() => {});
  const fx = Number(params.get("usd_per_unit"));
  if (Number.isFinite(fx) && fx > 0) await setSetting("usd_per_account_unit", String(fx)).catch(() => {});

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
          FROM trades WHERE date = ? AND outcome != 'PENDING' ORDER BY id DESC`,
    args: [date],
  });
  // Travão da conta inteira, com o P&L real das trades fechadas de hoje (mais antiga primeiro).
  const closedPnls = (tradesRes.rows as unknown as Array<{ outcome: string; pnl: number | null }>)
    .filter((t) => t.outcome !== "RUNNING" && t.pnl != null)
    .map((t) => Number(t.pnl))
    .reverse();
  const account = Number.isFinite(equity) && equity > 0 ? { equity, ...dailyGuard(closedPnls, equity) } : null;
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
    // Com capital conhecido usa o P&L real; o risco % declarado fica só como recurso.
    const hitDD = account ? (Math.max(0, -pnl) / account.equity) * 100 >= pb.maxDailyDD : lossRisk >= pb.maxDailyDD;
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
    account,
    prop,
    byAsset: {
      XAUUSD: pairState("XAUUSD"),
      SOLUSD: pairState("SOLUSD"),
    },
  });
}
