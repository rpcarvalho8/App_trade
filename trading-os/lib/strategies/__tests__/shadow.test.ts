import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { STRATEGIES, STRATEGY_XAUUSD, STRATEGY_XAUUSD_ROTATION } from "../index";
import { buildShadowVariants, createShadowStore, runShadowVariant, withRrCap, type ShadowVariant } from "../shadow";
import type { EngineContext, StrategyDefinition } from "../types";
import type { EngineLogRow } from "@/lib/engine-log";

const T = (h: number, day = 18) => Date.UTC(2026, 10, day, h, 0, 0);

/** Estratégia mínima que fecha em 2 passos: calendário + bias → sinal (níveis vêm do contexto). */
const quick: StrategyDefinition = {
  id: "quick",
  symbol: "TEST",
  name: "quick",
  category: "test",
  timeframes: { bias: "H4", entry: "M5" },
  session: {},
  sequence: [
    { step: 1, type: "calendar_clean", params: {} },
    { step: 2, type: "bias_h4", params: {} },
  ],
  confluences: [],
  invalidation: [],
  risk: { normalPct: 1, reducedPct: 0.5, rrMin: 2 },
  kill: { consecutiveLosses: 2, pauseMinutes: 30, maxTradesPerDay: 2, maxDailyDrawdownPct: 1, blockIf: {} },
};
const variant = (over: Partial<ShadowVariant> = {}): ShadowVariant => ({
  id: "quick@x",
  symbol: "TEST",
  description: "t",
  definition: { ...quick, id: "quick@x" },
  ...over,
});
const ctx: EngineContext = {
  calendarClean: true,
  bias: "bullish",
  price: 100,
  stopLossLevel: 99,
  takeProfitLevel: 102,
  candlesByTf: {},
};

function harness(v = variant()) {
  const store = createShadowStore([v]);
  const rows: { row: EngineLogRow; at: number }[] = [];
  const run = (now: number, cooldown = 15 * 60_000) =>
    runShadowVariant(v, store, ctx, now, cooldown, (row, at) => rows.push({ row, at }));
  return { store, rows, run };
}

describe("definição das variantes", () => {
  const variants = buildShadowVariants();

  it("duas variantes de XAUUSD com ids próprios, fora do registo das estratégias reais", () => {
    expect(variants.map((v) => v.id)).toEqual([
      "xauusd-london-structure@sem-londres",
      "xauusd-htf-rotation@rrcap2",
    ]);
    for (const v of variants) {
      expect(v.symbol).toBe("XAUUSD");
      expect(STRATEGIES[v.id]).toBeUndefined();
      expect(v.definition.id).toBe(v.id);
    }
  });

  it("'sem Londres' exclui 7–12h UTC e mantém a estratégia original igual", () => {
    const v = variants[0];
    expect(v.excludeUtcHours).toEqual([7, 12]);
    expect(v.definition.sequence).toEqual(STRATEGY_XAUUSD.sequence);
    expect(v.definition.risk).toEqual(STRATEGY_XAUUSD.risk);
  });

  it("'rrCap=2' altera só o passo ltf_mss e não muta a estratégia original", () => {
    const v = variants[1];
    const cap = (s: StrategyDefinition) => s.sequence.find((x) => x.type === "ltf_mss")!.params.rrCap;
    expect(cap(v.definition)).toBe(2);
    expect(cap(STRATEGY_XAUUSD_ROTATION)).not.toBe(2);
    expect(v.definition.sequence.filter((x) => x.type !== "ltf_mss")).toEqual(
      STRATEGY_XAUUSD_ROTATION.sequence.filter((x) => x.type !== "ltf_mss")
    );
  });

  it("withRrCap devolve cópia", () => {
    const c = withRrCap(STRATEGY_XAUUSD_ROTATION, 2.5, "x");
    expect(c).not.toBe(STRATEGY_XAUUSD_ROTATION);
    expect(c.id).toBe("x");
  });
});

describe("runShadowVariant", () => {
  it("regista passos e sinal (com SL/TP) só através do log", () => {
    const { rows, run, store } = harness();
    run(T(13));
    expect(rows.map((r) => r.row.kind)).toEqual(["step", "signal"]);
    const sig = rows[1].row;
    expect(sig.strategyId).toBe("quick@x");
    expect(sig.price).toBe(100);
    expect(sig.reason).toMatch(/^long rr=2\.00 sl=99 tp=102$/);
    expect(rows[1].at).toBe(T(13));
    expect(store.signalsDay["quick@x"].count).toBe(1);
  });

  it("cooldown depois do sinal e limite diário", () => {
    const { rows, run } = harness();
    run(T(13));
    const n = rows.length;
    run(T(13) + 5 * 60_000); // dentro do cooldown
    expect(rows).toHaveLength(n);
    run(T(14)); // 2.º sinal do dia
    expect(rows.filter((r) => r.row.kind === "signal")).toHaveLength(2);
    run(T(15)); // limite de 2/dia
    expect(rows.filter((r) => r.row.kind === "signal")).toHaveLength(2);
    run(T(13, 19)); // dia seguinte: volta a avaliar
    expect(rows.filter((r) => r.row.kind === "signal")).toHaveLength(3);
  });

  it("não avalia dentro da janela excluída e retoma fora dela", () => {
    const { rows, run, store } = harness(variant({ excludeUtcHours: [7, 12] }));
    run(T(8));
    run(T(11));
    expect(rows).toHaveLength(0);
    expect(store.states["quick@x"].currentStepIndex).toBe(0);
    run(T(12)); // fim exclusivo
    expect(rows.some((r) => r.row.kind === "signal")).toBe(true);
  });

  it("invalidações ficam registadas com o motivo", () => {
    // 3.º passo (sweep) nunca confirma com buffers vazios: o setup fica armado e depois cai com o calendário.
    const def: StrategyDefinition = {
      ...quick,
      id: "quick@x",
      sequence: [...quick.sequence, { step: 3, type: "liquidity_sweep", params: { timeframe: "M15" } }],
    };
    const { rows, run } = harness(variant({ definition: def }));
    run(T(13));
    expect(rows.map((r) => r.row.kind)).toEqual(["step", "step"]);
    const v = variant({ definition: def });
    const store = createShadowStore([v]);
    const out: EngineLogRow[] = [];
    runShadowVariant(v, store, ctx, T(13), 0, (r) => out.push(r));
    runShadowVariant(v, store, { ...ctx, calendarClean: false }, T(13) + 60_000, 0, (r) => out.push(r));
    expect(out.at(-1)).toMatchObject({ kind: "invalidated", reason: "news_blackout", strategyId: "quick@x" });
  });
});

describe("isolamento", () => {
  it("o módulo não importa alertas nem a tabela de sinais", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "shadow.ts"), "utf8");
    const imports = src.split("\n").filter((l) => /^import /.test(l)).join("\n");
    expect(imports).not.toMatch(/alert|@\/lib\/signals|signal-journal|emitSignalAlert|emitSetupAlert/i);
    expect(imports).not.toMatch(/from "@\/lib\/db"/);
  });
});
