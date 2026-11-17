import { NextResponse } from "next/server";
import { initDB } from "@/lib/db";
import { getEurUsd } from "@/lib/accounts-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** EUR/USD (USD por 1 EUR), com cache de 1 h. */
export async function GET() {
  await initDB();
  return NextResponse.json({ eurusd: await getEurUsd() });
}
