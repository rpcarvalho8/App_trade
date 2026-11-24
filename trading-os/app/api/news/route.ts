import { NextResponse } from "next/server";
import { getNewsStatus, newsTick } from "@/lib/news-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/news  → estado do motor de notícias: fontes (ok/erro), pausa por notícia
 *                   crítica por activo e as últimas notícias detetadas (incl. suprimidas).
 * POST /api/news  → força uma leitura imediata dos feeds.
 */
export async function GET() {
  return NextResponse.json(getNewsStatus());
}

export async function POST() {
  await newsTick();
  return NextResponse.json(getNewsStatus());
}
