import { NextRequest, NextResponse } from "next/server";
import { initDB, db } from "@/lib/db";
import { canonicalizePair } from "@/lib/pairs";
import { deriveOutcome, realizedR, validateTrade, type Side } from "@/lib/risk";

const TRADE_FIELDS = ["date","pair","direction","setup","session","entry","exit_price","stop_loss","take_profit","risk_percent","pnl","rr_planned","rr_real","outcome","elliott_wave","wyckoff_phase","wyckoff_event","imbalance_zone","htf_bias","confluences","entry_reason","shock_type","shock_timeframe","management","lesson","notes","screenshot_before","screenshot_after","screenshot_entry","tags","mental_state","followed_plan","sleep_quality","fatigue_level","stress_level","anxiety_level","focus_level","confidence_level","emotional_state","pre_session_notes","post_trade_emotion"] as const;
const TRADE_FIELD_SET = new Set<string>(TRADE_FIELDS);
const NUM_FIELDS = new Set(["entry","exit_price","stop_loss","take_profit","risk_percent","pnl","rr_planned","rr_real","sleep_quality","fatigue_level","stress_level","anxiety_level","focus_level","confidence_level"]);
/** Campos que, se mudarem, obrigam a validar de novo a trade inteira. */
const LEVEL_FIELDS = ["pair","direction","entry","stop_loss","take_profit","exit_price","pnl","outcome"];

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Resultado e R realizado derivados dos números, para não contradizerem o P&L. */
function deriveClosedFields(t: Record<string, unknown>) {
  if (t.outcome === "RUNNING") return;
  const pnl = num(t.pnl);
  if (pnl != null) t.outcome = deriveOutcome(pnl);
  const entry = num(t.entry), sl = num(t.stop_loss), exit = num(t.exit_price);
  const dir = String(t.direction || "").toUpperCase();
  if (entry != null && sl != null && exit != null && (dir === "LONG" || dir === "SHORT")) {
    const r = realizedR(dir as Side, entry, sl, exit);
    if (r != null) t.rr_real = Number(r.toFixed(2));
  }
}

function invalid(errors: string[]) {
  return NextResponse.json({ error: errors.join(" "), errors }, { status: 422 });
}

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
    const errors = validateTrade(b);
    if (errors.length) return invalid(errors);
    deriveClosedFields(b);
    const vals = TRADE_FIELDS.map(f => {
      const v = b[f];
      // Sem valor por omissão: "seguiu o plano" tem de ser respondido, não assumido.
      if (f === "followed_plan") return v === undefined || v === null || v === "" ? null : Number(v);
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
  if (LEVEL_FIELDS.some((k) => k in rest)) {
    const cur = await db.execute({ sql:"SELECT * FROM trades WHERE id=?", args:[id] });
    if (!cur.rows[0]) return NextResponse.json({ error: "Trade não encontrado" }, { status: 404 });
    const merged: Record<string, unknown> = { ...(cur.rows[0] as Record<string, unknown>), ...rest };
    const errors = validateTrade(merged);
    if (errors.length) return invalid(errors);
    deriveClosedFields(merged);
    if ("outcome" in rest || "pnl" in rest) rest.outcome = merged.outcome;
    if (merged.rr_real != null && ("exit_price" in rest || "entry" in rest || "stop_loss" in rest)) rest.rr_real = merged.rr_real;
  }
  const keys = Object.keys(rest).filter((k) => TRADE_FIELD_SET.has(k));
  if (!keys.length) return NextResponse.json({ error: "No valid fields" }, { status: 400 });
  const sets = keys.map(k => `${k}=?`).join(",");
  const vals = keys.map(k => {
    const v = rest[k];
    if (k === "followed_plan") return v === "" || v === null || v === undefined ? null : Number(v);
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
