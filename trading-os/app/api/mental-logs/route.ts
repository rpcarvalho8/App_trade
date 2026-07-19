import { NextRequest, NextResponse } from "next/server";
import { initDB, db } from "@/lib/db";

export async function GET() {
  await initDB();
  const result = await db.execute("SELECT * FROM mental_logs ORDER BY date DESC LIMIT 30");
  return NextResponse.json(result.rows);
}

export async function POST(req: NextRequest) {
  await initDB();
  const b = await req.json();
  const result = await db.execute({
    sql: `INSERT INTO mental_logs (date,sleep_hours,sleep_quality,fatigue_level,stress_level,anxiety_level,focus_level,confidence_level,mood_score,physical_state,before_session,after_session,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [b.date||new Date().toISOString().slice(0,10),Number(b.sleep_hours)||7,Number(b.sleep_quality)||5,Number(b.fatigue_level)||5,Number(b.stress_level)||5,Number(b.anxiety_level)||5,Number(b.focus_level)||5,Number(b.confidence_level)||5,Number(b.mood_score)||5,b.physical_state||"",b.before_session||"",b.after_session||"",b.notes||""],
  });
  return NextResponse.json({ id: Number(result.lastInsertRowid) });
}
