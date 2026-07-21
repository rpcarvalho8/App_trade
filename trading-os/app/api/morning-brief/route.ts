import { NextResponse } from "next/server";
import { ensureTodayBrief, todayISO } from "@/lib/morning-brief";
import { mdToHtml } from "@/lib/md";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serve o Morning Brief do dia atual como Markdown.
 * - Se o ficheiro do dia já existir, devolve-o estaticamente (não re-executa a Gemini).
 * - Se não existir (app ligada a meio do dia), gera-o UMA vez e passa a servi-lo.
 */
export async function GET() {
  try {
    const { generated, date, markdown } = await ensureTodayBrief();
    if (!markdown) {
      return NextResponse.json({ ok: false, date, error: "Brief indisponível." }, { status: 503 });
    }
    return NextResponse.json({ ok: true, date, generated, markdown, html: mdToHtml(markdown) });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, date: todayISO(), error: e?.message || "Falha ao gerar o brief." },
      { status: 500 }
    );
  }
}
