import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, initDB } from "@/lib/db";
import { generateContent, geminiResponseText, type GeminiPart } from "@/lib/gemini";
import { buildZoomImages, readScreenshot, clampRegion } from "@/lib/ai/chart-image";
import { buildSystemPrompt, knowledgeBlock } from "@/lib/ai/master-prompt";
import { checkScenarios, parseZoomResponse, validateZoomPlan, ZOOM_TASK } from "@/lib/ai/chart-zoom";
import { horizonForTimeframe, normalizeTimeframe, type Horizon } from "@/lib/ai/trade-plan";
import { searchKnowledge } from "@/lib/ai/knowledge";
import { accountForSymbol } from "@/lib/accounts-db";
import { INSTRUMENTS, RISK_RULES, positionSize } from "@/lib/risk";

// Visão em alta resolução + raciocínio: pode demorar.
export const maxDuration = 180;

const Body = z.object({
  imageUrl: z.string().min(1),
  region: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }),
  asset: z.enum(["XAUUSD", "SOLUSD"]),
  horizon: z.enum(["day", "swing", "auto"]).default("auto"),
  timeframe: z.string().optional().nullable(),
  question: z.string().max(1500).optional().nullable(),
  priceHint: z.string().max(200).optional().nullable(),
  includePriceAxis: z.boolean().default(true),
  /** Faixa do eixo de preço marcada na UI (fracções da largura). Sem ela usa-se a margem direita. */
  axis: z.object({ x: z.number(), w: z.number().positive() }).optional().nullable(),
});

async function ensureTable() {
  await initDB();
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS chart_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset TEXT NOT NULL,
      horizon TEXT,
      timeframe TEXT,
      image_url TEXT NOT NULL,
      region_json TEXT NOT NULL,
      question TEXT,
      summary TEXT,
      bias TEXT,
      plan_status TEXT,
      result_json TEXT NOT NULL,
      model TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

const KB_TAGS: Record<Horizon, string[]> = {
  day: ["smc", "liquidez", "padroes", "volume", "risco"],
  swing: ["wyckoff", "elliott", "liquidez", "risco", "macro"],
};

export async function POST(req: NextRequest) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "Pedido inválido", details: e instanceof Error ? e.message : null }, { status: 400 });
  }

  try {
    await ensureTable();
    const tf = normalizeTimeframe(body.timeframe);
    const fixedHorizon: Horizon | null = body.horizon === "auto" ? horizonForTimeframe(tf) : body.horizon;
    const region = clampRegion(body.region);

    // 1) Imagens: completo com a região marcada + recorte nativo ampliado com o eixo de preço.
    const src = await readScreenshot(body.imageUrl);
    const images = await buildZoomImages(src, region, { includePriceAxis: body.includePriceAxis, axis: body.axis ?? null });

    // 2) Conhecimento pessoal relevante (BM25 sobre as notas e o guia de estudo).
    const kbQuery = [
      body.question || "",
      body.asset === "XAUUSD" ? "ouro xauusd liquidez macro" : "solana solusd funding liquidações",
      fixedHorizon === "swing" ? "wyckoff acumulação distribuição fases elliott ondas correções" : "order block fvg choch bos sweep liquidez reteste fundos válidos",
      "volume esforço resultado",
    ].join(" ");
    const kb = await searchKnowledge(kbQuery, {
      limit: 6,
      boostTags: [...KB_TAGS[fixedHorizon ?? "day"], body.asset.toLowerCase()],
    }).catch(() => []);

    // 3) Prompt.
    const system = buildSystemPrompt(body.asset, fixedHorizon, ZOOM_TASK);
    const ctx = [
      `Activo: ${body.asset}.`,
      tf ? `Timeframe do gráfico: ${tf}.` : "Timeframe do gráfico: deduz pela imagem.",
      fixedHorizon ? `Horizonte pedido: ${fixedHorizon === "day" ? "Day Trade" : "Swing Trade"}.` : "Horizonte: escolhe e justifica.",
      `Hora atual (UTC): ${new Date().toISOString().slice(0, 16).replace("T", " ")} — só contexto, não é filtro.`,
      `Região ampliada: x=${(region.x * 100).toFixed(1)}%, y=${(region.y * 100).toFixed(1)}%, largura=${(region.w * 100).toFixed(1)}%, altura=${(region.h * 100).toFixed(1)}% do gráfico.`,
      images.meta.priceAxisAppended ? "A IMAGEM 2 inclui, à direita da linha amarela, a faixa do eixo de preço à mesma altura." : "A IMAGEM 2 já inclui o eixo de preço (ou foi pedido sem eixo).",
      body.priceHint ? `Calibração de preço dada pelo trader: ${body.priceHint}` : "",
      body.question ? `Pergunta do trader: ${body.question}` : "",
    ].filter(Boolean).join("\n");

    const parts: GeminiPart[] = [
      { text: ctx },
      ...(kb.length ? [{ text: knowledgeBlock(kb) }] : []),
      { text: "IMAGEM 1 — gráfico completo (contexto, região a amarelo):" },
      { inlineData: images.full },
      { text: "IMAGEM 2 — recorte em alta resolução da região (analisa isto):" },
      { inlineData: images.crop },
    ];

    const call = (mediaResolution?: string) =>
      generateContent({
        parts,
        systemInstruction: system,
        logLabel: "Zoom",
        timeoutMs: 150_000,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          ...(mediaResolution ? { mediaResolution } : {}),
        },
      });
    const mediaRes = process.env.GEMINI_MEDIA_RESOLUTION ?? "MEDIA_RESOLUTION_HIGH";
    let json: { modelVersion?: string } | undefined;
    try {
      json = await call(mediaRes || undefined);
    } catch (e) {
      // Modelos que não aceitam mediaResolution devolvem 400: repete sem o parâmetro.
      if (mediaRes && e instanceof Error && /\(400\)/.test(e.message)) json = await call();
      else throw e;
    }
    const analysis = parseZoomResponse(geminiResponseText(json));

    // 4) Gate matemático (o código decide, não a IA).
    const horizon: Horizon = fixedHorizon ?? analysis.horizon;
    const checked = validateZoomPlan(analysis, body.asset, horizon);
    const scenarioChecks = checkScenarios(analysis);

    // 5) Lote sugerido com o capital da conta do activo (só quando o plano não foi rejeitado).
    let sizing: ReturnType<typeof positionSize> | null = null;
    if (checked && checked.validation.status !== "rejected") {
      const acct = await accountForSymbol(body.asset).catch(() => null);
      if (acct?.equity) {
        sizing = positionSize({
          equity: acct.equity,
          riskPct: RISK_RULES.riskPct,
          entry: checked.validation.entryMid,
          sl: checked.plan.stopLoss,
          spec: INSTRUMENTS[body.asset],
          usdPerAccountUnit: acct.usdPerAccountUnit,
        });
      }
    }

    const result = {
      asset: body.asset,
      horizon,
      timeframe: tf ?? analysis.data_quality.timeframe_detected ?? null,
      analysis,
      plan: checked?.plan ?? null,
      validation: checked?.validation ?? null,
      scenarioChecks,
      sizing,
      riskPct: RISK_RULES.riskPct,
      kb: kb.map((k, i) => ({ ref: `KB${i + 1}`, title: k.title, source: k.source, score: k.score })),
      images: { cropPreview: images.cropPreview, meta: images.meta },
      model: json?.modelVersion ?? null,
    };

    const ins = await db.execute({
      sql: `INSERT INTO chart_analyses (asset, horizon, timeframe, image_url, region_json, question, summary, bias, plan_status, result_json, model)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        body.asset,
        horizon,
        result.timeframe,
        body.imageUrl,
        JSON.stringify(region),
        body.question ?? null,
        analysis.zone_summary,
        analysis.bias,
        checked?.validation.status ?? "none",
        JSON.stringify({ ...result, images: { meta: images.meta } }),
        result.model,
      ],
    });

    return NextResponse.json({ id: Number(ins.lastInsertRowid), ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro na análise" }, { status: 500 });
  }
}

/** GET → últimas 20 análises (metadados). GET ?id=N → análise completa. */
export async function GET(req: NextRequest) {
  await ensureTable();
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const r = await db.execute({ sql: "SELECT * FROM chart_analyses WHERE id=?", args: [Number(id)] });
    const row = r.rows[0] as unknown as Record<string, string> | undefined;
    if (!row) return NextResponse.json(null, { status: 404 });
    return NextResponse.json({ id: Number(row.id), imageUrl: row.image_url, region: JSON.parse(String(row.region_json)), question: row.question, created_at: row.created_at, ...JSON.parse(String(row.result_json)) });
  }
  const r = await db.execute(
    "SELECT id, asset, horizon, timeframe, image_url, summary, bias, plan_status, created_at FROM chart_analyses ORDER BY id DESC LIMIT 20"
  );
  return NextResponse.json({ analyses: r.rows });
}
