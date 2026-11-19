/**
 * Análise visual com zoom: formato de saída, normalização (zod) e validação do plano.
 * A orquestração (imagens + KB + Gemini + DB) está em app/api/chart-zoom/route.ts.
 */
import { z } from "zod";
import { validateTradePlan, type AiAsset, type Horizon, type PlanValidation, type TradePlan, REQUIRED_CHECKLIST } from "./trade-plan";

export const ZOOM_TASK = `# TAREFA: ANÁLISE VISUAL COM ZOOM
Recebes DUAS imagens do mesmo gráfico:
- IMAGEM 1 = gráfico completo. A região ampliada está marcada com um retângulo amarelo tracejado. Usa-a só para CONTEXTO: tendência, swings maiores, liquidez fora da zona, onde está a zona dentro do range maior (prémio/desconto).
- IMAGEM 2 = recorte em alta resolução da região amarela. Se tiver uma faixa à direita separada por uma linha amarela, essa faixa é o EIXO DE PREÇO à mesma altura: usa-a para ler os níveis exatos.

Analisa EXCLUSIVAMENTE o que acontece dentro da região ampliada, interpretado à luz do gráfico completo.

1. Descrição detalhada da zona: leitura vela a vela dos pontos relevantes (pavios de rejeição, velas de deslocamento, corpos de absorção), volume (esforço vs resultado, clímax, secagem), estrutura SMC (BOS/CHoCH com corpo vs pavio, OB, FVG), evento/fase de Wyckoff em formação, posição provável na contagem de Elliott, e que liquidez foi capturada ou está por capturar.
2. Cenários: bullish E bearish, cada um com probabilidade (somam ~100), tese, gatilhos de confirmação concretos e observáveis (ex.: "fecho M15 acima de 2384,50 com corpo"), zona de entrada, nível EXATO de invalidação com a razão, e alvos na liquidez.
3. trade_plan: preenche SÓ se um dos cenários já cumpre a confluência mínima ou está a um gatilho de distância; caso contrário null e explica em no_trade_reason. Na checklist, marca true apenas o que JÁ está visível no gráfico.

Devolve APENAS JSON válido com esta forma (preços como números, sem separador de milhares):
{
  "data_quality": { "price_axis_readable": true, "timeframe_detected": "M15", "notes": "" },
  "horizon": "day",
  "zone_summary": "2-3 frases com a leitura principal",
  "reading": { "candles": "", "volume": "", "structure": "", "liquidity": "", "wyckoff": "", "elliott": "" },
  "context_from_full_chart": "",
  "key_levels": [ { "price": 0, "type": "ssl|bsl|ob|fvg|suporte|resistencia|poi|invalidacao", "note": "" } ],
  "bias": "bullish|bearish|neutral",
  "scenarios": {
    "bullish": { "probability": 0, "thesis": "", "triggers": [""], "entry_zone": { "low": 0, "high": 0 }, "invalidation": { "price": 0, "reason": "" }, "targets": [ { "price": 0, "label": "TP1 — BSL ..." } ] },
    "bearish": { "probability": 0, "thesis": "", "triggers": [""], "entry_zone": { "low": 0, "high": 0 }, "invalidation": { "price": 0, "reason": "" }, "targets": [ { "price": 0, "label": "" } ] }
  },
  "trade_plan": {
    "direction": "long|short",
    "setup_timeframe": "M15",
    "entry_zone": { "low": 0, "high": 0 },
    "stop_loss": 0,
    "stop_logic": "",
    "targets": [ { "price": 0, "label": "" } ],
    "confluences": ["Fase C de Wyckoff (Spring) + OB H1 + sweep de SSL"],
    "checklist": { ${REQUIRED_CHECKLIST.map((k) => `"${k}": false`).join(", ")} },
    "invalidation": "",
    "confidence": 0
  },
  "no_trade_reason": "",
  "kb_refs": ["KB1"]
}`;

const num = z.coerce.number().catch(NaN);
const str = z.coerce.string().catch("");
const zone = z.object({ low: num, high: num }).nullable().catch(null);
const target = z.object({ price: num, label: str.optional() });

const scenario = z
  .object({
    probability: num,
    thesis: str,
    triggers: z.array(str).catch([]),
    entry_zone: zone,
    invalidation: z.object({ price: num, reason: str }).nullable().catch(null),
    targets: z.array(target).catch([]),
  })
  .nullable()
  .catch(null);

export const ZoomResponseSchema = z.object({
  data_quality: z
    .object({ price_axis_readable: z.coerce.boolean().catch(false), timeframe_detected: str.nullable().catch(null), notes: str })
    .catch({ price_axis_readable: false, timeframe_detected: null, notes: "" }),
  horizon: z.enum(["day", "swing"]).catch("day"),
  zone_summary: str,
  reading: z
    .object({ candles: str, volume: str, structure: str, liquidity: str, wyckoff: str, elliott: str })
    .catch({ candles: "", volume: "", structure: "", liquidity: "", wyckoff: "", elliott: "" }),
  context_from_full_chart: str,
  key_levels: z.array(z.object({ price: num, type: str, note: str })).catch([]),
  bias: z.enum(["bullish", "bearish", "neutral"]).catch("neutral"),
  scenarios: z.object({ bullish: scenario, bearish: scenario }).catch({ bullish: null, bearish: null }),
  trade_plan: z
    .object({
      direction: z.enum(["long", "short"]),
      setup_timeframe: str.nullable().catch(null),
      entry_zone: z.object({ low: num, high: num }),
      stop_loss: num,
      stop_logic: str,
      targets: z.array(target).catch([]),
      confluences: z.array(str).catch([]),
      checklist: z.record(z.string(), z.coerce.boolean()).catch({}),
      invalidation: str,
      confidence: num,
    })
    .nullable()
    .catch(null),
  no_trade_reason: str,
  kb_refs: z.array(str).catch([]),
});

export type ZoomResponse = z.infer<typeof ZoomResponseSchema>;

export interface ScenarioCheck {
  side: "bullish" | "bearish";
  warnings: string[];
}

/** Coerência de cada cenário: invalidação do lado certo da zona, alvos do lado certo. */
export function checkScenarios(r: ZoomResponse): ScenarioCheck[] {
  const out: ScenarioCheck[] = [];
  for (const side of ["bullish", "bearish"] as const) {
    const s = r.scenarios[side];
    if (!s) continue;
    const w: string[] = [];
    const z = s.entry_zone;
    const inv = s.invalidation?.price;
    if (z && Number.isFinite(z.low) && Number.isFinite(z.high) && Number.isFinite(inv)) {
      const lo = Math.min(z.low, z.high);
      const hi = Math.max(z.low, z.high);
      if (side === "bullish" && inv! >= lo) w.push("Invalidação bullish não está abaixo da zona de entrada.");
      if (side === "bearish" && inv! <= hi) w.push("Invalidação bearish não está acima da zona de entrada.");
      const bad = s.targets.filter((t) => (side === "bullish" ? t.price <= hi : t.price >= lo));
      if (bad.length) w.push(`${bad.length} alvo(s) do lado errado da zona.`);
    }
    if (!s.triggers.filter(Boolean).length) w.push("Sem gatilho de confirmação definido.");
    out.push({ side, warnings: w });
  }
  return out;
}

/** Converte o trade_plan da IA no formato do validador e corre o gate matemático. */
export function validateZoomPlan(r: ZoomResponse, asset: AiAsset, horizon: Horizon): { plan: TradePlan; validation: PlanValidation } | null {
  const p = r.trade_plan;
  if (!p) return null;
  const plan: TradePlan = {
    asset,
    direction: p.direction,
    horizon,
    setupTimeframe: p.setup_timeframe,
    entryZone: { low: p.entry_zone.low, high: p.entry_zone.high },
    stopLoss: p.stop_loss,
    stopLogic: p.stop_logic,
    targets: p.targets.map((t) => ({ price: t.price, label: t.label })),
    confluences: p.confluences.filter(Boolean),
    checklist: p.checklist,
    invalidation: p.invalidation,
    confidence: Number.isFinite(p.confidence) ? p.confidence : undefined,
  };
  return { plan, validation: validateTradePlan(plan) };
}

/** Parse tolerante do texto do modelo (JSON puro ou embrulhado em texto). */
export function parseZoomResponse(text: string): ZoomResponse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("A IA não devolveu JSON.");
    raw = JSON.parse(m[0]);
  }
  return ZoomResponseSchema.parse(raw);
}
