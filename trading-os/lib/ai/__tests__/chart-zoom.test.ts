import { describe, expect, it } from "vitest";
import { checkScenarios, parseZoomResponse, validateZoomPlan } from "../chart-zoom";
import { buildSystemPrompt } from "../master-prompt";

const sample = {
  data_quality: { price_axis_readable: true, timeframe_detected: "M15", notes: "" },
  horizon: "day",
  zone_summary: "Sweep do PDL seguido de CHoCH.",
  reading: { candles: "x", volume: "y", structure: "z", liquidity: "w", wyckoff: "Spring", elliott: "" },
  context_from_full_chart: "",
  key_levels: [{ price: "2376.4", type: "ssl", note: "PDL" }],
  bias: "bullish",
  scenarios: {
    bullish: { probability: 65, thesis: "t", triggers: ["fecho M15 acima de 2384"], entry_zone: { low: 2380, high: 2382 }, invalidation: { price: 2376, reason: "abaixo do Spring" }, targets: [{ price: 2400, label: "BSL" }] },
    bearish: { probability: 35, thesis: "t", triggers: [], entry_zone: { low: 2390, high: 2392 }, invalidation: { price: 2389, reason: "x" }, targets: [{ price: 2395 }] },
  },
  trade_plan: {
    direction: "long", setup_timeframe: "M15", entry_zone: { low: 2380, high: 2382 }, stop_loss: 2376, stop_logic: "abaixo do Spring",
    targets: [{ price: 2400, label: "BSL" }], confluences: ["Spring", "OB"], checklist: { htf_bias_aligned: true }, invalidation: "fecho abaixo de 2376", confidence: 60,
  },
  no_trade_reason: "",
  kb_refs: ["KB1"],
};

describe("chart-zoom", () => {
  it("faz parse tolerante (texto à volta, números como string)", () => {
    const r = parseZoomResponse("Aqui está:\n" + JSON.stringify(sample) + "\nfim");
    expect(r.key_levels[0].price).toBe(2376.4);
    expect(r.bias).toBe("bullish");
  });

  it("aceita resposta incompleta sem rebentar", () => {
    const r = parseZoomResponse(JSON.stringify({ zone_summary: "só isto", trade_plan: null }));
    expect(r.zone_summary).toBe("só isto");
    expect(r.trade_plan).toBeNull();
    expect(r.scenarios.bullish).toBeNull();
  });

  it("valida o plano e assinala cenários incoerentes", () => {
    const r = parseZoomResponse(JSON.stringify(sample));
    const checked = validateZoomPlan(r, "XAUUSD", "day")!;
    expect(checked.validation.status).toBe("watch");
    const checks = checkScenarios(r);
    expect(checks.find((c) => c.side === "bullish")!.warnings).toEqual([]);
    const bear = checks.find((c) => c.side === "bearish")!.warnings.join(" ");
    expect(bear).toMatch(/Invalidação bearish/);
    expect(bear).toMatch(/alvo/);
    expect(bear).toMatch(/gatilho/);
  });

  it("o system prompt não impõe janela horária e inclui os limites do activo", () => {
    const p = buildSystemPrompt("SOLUSD", "swing", "TAREFA");
    expect(p).toMatch(/NÃO existe janela horária fixa/);
    expect(p).toMatch(/funding/);
    expect(p).toMatch(/entre 1.5% e 12%/);
    expect(buildSystemPrompt("XAUUSD", null, "T")).toMatch(/HORIZONTE NÃO DEFINIDO/);
  });
});
