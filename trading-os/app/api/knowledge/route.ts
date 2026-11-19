import { NextRequest, NextResponse } from "next/server";
import { knowledgeStats, reindexKnowledge, searchKnowledge } from "@/lib/ai/knowledge";

/** GET ?q=texto&tags=wyckoff,xauusd → chunks mais relevantes. Sem q → estatísticas do índice. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  try {
    if (!q) return NextResponse.json(await knowledgeStats());
    const tags = (searchParams.get("tags") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const limit = Math.min(20, Number(searchParams.get("limit")) || 6);
    return NextResponse.json({ results: await searchKnowledge(q, { limit, boostTags: tags }) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}

/** POST → reconstrói o índice a partir de knowledge/ e KNOWLEDGE_DIRS. */
export async function POST() {
  try {
    return NextResponse.json(await reindexKnowledge());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
