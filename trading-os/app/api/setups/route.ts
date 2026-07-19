import { NextRequest, NextResponse } from "next/server";
import { initDB, db } from "@/lib/db";

export async function GET() {
  await initDB();
  const result = await db.execute("SELECT * FROM setups ORDER BY CASE category WHEN 'Wyckoff+Elliott' THEN 1 WHEN 'Elliott+Wyckoff' THEN 2 WHEN 'ICT' THEN 3 ELSE 4 END, name");
  return NextResponse.json(result.rows);
}

export async function POST(req: NextRequest) {
  await initDB();
  const b = await req.json();
  const result = await db.execute({
    sql: `INSERT INTO setups (name,category,description,steps,timeframes,markets,confluence,invalidation,image_refs) VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [b.name,b.category||"Custom",b.description||"",b.steps||"",b.timeframes||"",b.markets||"",b.confluence||"",b.invalidation||"",b.image_refs||"[]"],
  });
  return NextResponse.json({ id: Number(result.lastInsertRowid) });
}

export async function PUT(req: NextRequest) {
  await initDB();
  const b = await req.json();
  await db.execute({
    sql: `UPDATE setups SET name=?,category=?,description=?,steps=?,timeframes=?,markets=?,confluence=?,invalidation=?,image_refs=? WHERE id=?`,
    args: [b.name,b.category||"Custom",b.description||"",b.steps||"",b.timeframes||"",b.markets||"",b.confluence||"",b.invalidation||"",b.image_refs||"[]",b.id],
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  await initDB();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  await db.execute({ sql: "DELETE FROM setups WHERE id=?", args: [id!] });
  return NextResponse.json({ ok: true });
}
