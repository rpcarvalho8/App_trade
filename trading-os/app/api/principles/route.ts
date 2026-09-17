import { NextRequest, NextResponse } from "next/server";
import { initDB, db } from "@/lib/db";

export async function GET() {
  await initDB();
  const result = await db.execute("SELECT * FROM principles ORDER BY CASE asset WHEN 'global' THEN 1 WHEN 'XAUUSD' THEN 2 WHEN 'SOLUSD' THEN 3 ELSE 4 END, category, id");
  return NextResponse.json(result.rows);
}

export async function POST(req: NextRequest) {
  await initDB();
  const body = await req.json();
  const { title, body: text, category, asset } = body;
  const result = await db.execute({
    sql: "INSERT INTO principles (title,body,category,asset) VALUES (?,?,?,?)",
    args: [title, text, category || "general", asset || "global"],
  });
  return NextResponse.json({ id: Number(result.lastInsertRowid) });
}

export async function DELETE(req: NextRequest) {
  await initDB();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  await db.execute({ sql: "DELETE FROM principles WHERE id = ?", args: [id!] });
  return NextResponse.json({ ok: true });
}
