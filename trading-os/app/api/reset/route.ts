import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST() {
  try {
    await db.execute("DELETE FROM trades");
    await db.execute("DELETE FROM mental_logs");
    await db.execute("DELETE FROM ai_analyses");
    try { await db.execute("DELETE FROM weekly_journals"); } catch {}
    return NextResponse.json({ ok: true, message: "Trades, logs e análises apagados. Setups e princípios mantidos." });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
