import { NextRequest, NextResponse } from "next/server";
import { initDB, db } from "@/lib/db";
import { canonicalizePair } from "@/lib/pairs";

const TRADE_FIELDS = ["date","pair","direction","setup","session","entry","exit_price","stop_loss","take_profit","risk_percent","pnl","rr_planned","rr_real","outcome","elliott_wave","wyckoff_phase","wyckoff_event","imbalance_zone","htf_bias","confluences","entry_reason","shock_type","shock_timeframe","management","lesson","notes","screenshot_before","screenshot_after","screenshot_entry","tags","mental_state","followed_plan","sleep_quality","fatigue_level","stress_level","anxiety_level","focus_level","confidence_level","emotional_state","pre_session_notes","post_trade_emotion"] as const;
const TRADE_FIELD_SET = new Set<string>(TRADE_FIELDS);
const NUM_FIELDS = new Set(["entry","exit_price","stop_loss","take_profit","risk_percent","pnl","rr_planned","rr_real","sleep_quality","fatigue_level","stress_level","anxiety_level","focus_level","confidence_level"]);

export async function GET(req: NextRequest) {
  await initDB();
  const { searchParams } = new URL(req.url);
  const limit = searchParams.get("limit") || "100";
  const id = searchParams.get("id");
  if (id) {
    const r = await db.execute({ sql:"SELECT * FROM trades WHERE id=?", args:[id] });
    return NextResponse.json(r.rows[0]||null);
  }
  const setup = searchParams.get("setup");
  const outcome = searchParams.get("outcome");
  let sql = "SELECT * FROM trades";
  const args: any[] = [];
  const conds: string[] = [];
  if (setup) { conds.push("setup=?"); args.push(setup); }
  if (outcome) { conds.push("outcome=?"); args.push(outcome); }
  if (conds.length) sql += " WHERE "+conds.join(" AND ");
  sql += " ORDER BY date DESC, id DESC LIMIT ?";
  args.push(parseInt(limit));
  const result = await db.execute({ sql, args });
  return NextResponse.json(result.rows);
}

export async function POST(req: NextRequest) {
  try {
    await initDB();
    const b = await req.json();
    if (b.pair) b.pair = canonicalizePair(b.pair) || b.pair;
    const vals = TRADE_FIELDS.map(f => {
      const v = b[f];
      if (f === "followed_plan") return v === undefined ? 1 : Number(v);
      if (NUM_FIELDS.has(f)) return v !== undefined && v !== "" ? Number(v) : null;
      return v ?? "";
    });
    const result = await db.execute({
      sql: `INSERT INTO trades (${TRADE_FIELDS.join(",")}) VALUES (${TRADE_FIELDS.map(()=>"?").join(",")})`,
      args: vals,
    });
    return NextResponse.json({ id: Number(result.lastInsertRowid) });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro ao guardar trade" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  await initDB();
  const b = await req.json();
  const { id, ...rest } = b;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  if (rest.pair) rest.pair = canonicalizePair(rest.pair) || rest.pair;
  const keys = Object.keys(rest).filter((k) => TRADE_FIELD_SET.has(k));
  if (!keys.length) return NextResponse.json({ error: "No valid fields" }, { status: 400 });
  const sets = keys.map(k => `${k}=?`).join(",");
  const vals = keys.map(k => {
    const v = rest[k];
    if (k === "followed_plan") return Number(v);
    if (NUM_FIELDS.has(k)) return v !== "" && v !== null && v !== undefined ? Number(v) : null;
    return v ?? "";
  });
  await db.execute({ sql:`UPDATE trades SET ${sets} WHERE id=?`, args:[...vals, id] });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  await initDB();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error:"Missing id" }, { status:400 });
  await db.execute({ sql:"DELETE FROM trades WHERE id=?", args:[id] });
  return NextResponse.json({ ok: true });
}
