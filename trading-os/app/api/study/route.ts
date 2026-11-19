import { NextRequest, NextResponse } from "next/server";
import { mdToHtml } from "@/lib/md";
import { getStudyStart, readGuide, setStudyStart, studyToday, toggleProgress } from "@/lib/study";
import { buildIcs, CONSOLIDATION, STUDY_PLAN } from "@/lib/study-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET              → estudo de hoje (semana do plano, sessões, próxima sessão, progresso) + plano completo.
 * GET ?guide=1     → guia de estudo completo em HTML.
 * GET ?ics=1       → sessões de fim de semana em iCalendar (importar no Google/Apple Calendar).
 */
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  try {
    if (sp.get("guide")) {
      const md = await readGuide();
      return NextResponse.json({ ok: true, html: mdToHtml(md) });
    }
    if (sp.get("ics")) {
      const start = await getStudyStart();
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
      return new NextResponse(buildIcs(start, undefined, stamp), {
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": 'attachment; filename="trading-os-estudo.ics"',
        },
      });
    }
    const today = await studyToday();
    return NextResponse.json({ ok: true, today, plan: STUDY_PLAN, consolidation: CONSOLIDATION });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}

/** POST { action: "toggle", key } | { action: "start", date: "YYYY-MM-DD" } */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body?.action === "toggle" && typeof body.key === "string" && body.key.length < 40) {
      return NextResponse.json({ ok: true, progress: await toggleProgress(body.key) });
    }
    if (body?.action === "start" && typeof body.date === "string") {
      await setStudyStart(body.date);
      return NextResponse.json({ ok: true, today: await studyToday() });
    }
    return NextResponse.json({ ok: false, error: "Ação inválida" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Erro" }, { status: 500 });
  }
}
