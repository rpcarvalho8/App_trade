import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

function authorized(req: NextRequest, body: { token?: unknown }): boolean {
  const token = process.env.RESET_TOKEN;
  if (!token) return false;
  const header = req.headers.get("x-reset-token") || "";
  const fromBody = typeof body?.token === "string" ? body.token : "";
  return header === token || fromBody === token;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { token?: unknown };
    if (!authorized(req, body)) {
      return NextResponse.json(
        { ok: false, error: "Reset desativado. Define RESET_TOKEN no .env.local e envia o token." },
        { status: 403 }
      );
    }
    await db.execute("DELETE FROM trades");
    await db.execute("DELETE FROM mental_logs");
    await db.execute("DELETE FROM ai_analyses");
    try { await db.execute("DELETE FROM weekly_journals"); } catch {}
    return NextResponse.json({ ok: true, message: "Trades, logs e análises apagados. Setups e princípios mantidos." });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Erro";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
