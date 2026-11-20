import { describe, expect, it } from "vitest";
import { STRATEGIES, STRATEGIES_BY_SYMBOL } from "../index";
import { confluenceKeysForStep, normalizeTf } from "../engine";

const KNOWN_STEPS = [
  "calendar_clean",
  "bias_h4",
  "liquidity_sweep",
  "mss_cisd",
  "ob_or_fvg",
  "choch_volume",
  "fvg_golden_ratio",
  "htf_zone_tap",
  "ltf_mss",
];
/** Confluências tratadas pelo buildSignal (não vêm de um passo). */
const isSoftKey = (k: string) =>
  k.startsWith("rr_min") || k === "session_window" || k === "spread_below_50pct_fvg" || k === "sequence_1_2_3_no_skip";
const TF_OK = /^(H4|H1|M15|M5|M1|4h|1h|15m|5m|1m)$/;

describe.each(Object.values(STRATEGIES))("config $id", (s) => {
  const steps = [...s.sequence].sort((a, b) => a.step - b.step);

  it("passos numerados 1..n sem repetição e só de tipos conhecidos", () => {
    expect(steps.map((x) => x.step)).toEqual(steps.map((_, i) => i + 1));
    for (const st of steps) expect(KNOWN_STEPS).toContain(st.type);
  });

  it("armOnStep refere um passo que existe (e não o último)", () => {
    const arm = s.alerts?.armOnStep;
    if (!arm) return;
    const i = steps.findIndex((x) => x.type === arm);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(steps.length - 1);
  });

  it("cada confluência é coberta por um passo ou é uma chave tratada no buildSignal", () => {
    const covered = new Set(steps.flatMap((st) => confluenceKeysForStep(st, s)));
    for (const k of s.confluences) {
      expect(isSoftKey(k) || covered.has(k), `confluência sem passo: ${k}`).toBe(true);
    }
  });

  it("timeframes e parâmetros de risco são coerentes", () => {
    for (const tf of [s.timeframes.bias, s.timeframes.entry, s.timeframes.trigger].filter(Boolean) as string[]) {
      expect(normalizeTf(tf)).toMatch(TF_OK);
    }
    for (const st of steps) {
      const tf = st.params?.timeframe;
      if (typeof tf === "string") expect(normalizeTf(tf)).toMatch(TF_OK);
    }
    expect(s.risk.rrMin).toBeGreaterThan(0);
    const { minStopPct, maxStopPct } = s.risk;
    if (minStopPct != null && maxStopPct != null) expect(minStopPct).toBeLessThan(maxStopPct);
    expect(s.risk.reducedPct).toBeLessThanOrEqual(s.risk.normalPct);
    expect(s.kill.maxTradesPerDay).toBeGreaterThan(0);
  });

  it("utcHours, se existir, é um intervalo [início, fim) válido", () => {
    const h = s.session.utcHours;
    if (!h) return;
    expect(h).toHaveLength(2);
    expect(h[0]).toBeGreaterThanOrEqual(0);
    expect(h[1]).toBeLessThanOrEqual(24);
    expect(h[0]).toBeLessThan(h[1]);
  });
});

describe("registo de estratégias", () => {
  it("ids únicos e STRATEGIES_BY_SYMBOL coerente com o símbolo", () => {
    const all = Object.values(STRATEGIES);
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (const [sym, list] of Object.entries(STRATEGIES_BY_SYMBOL)) {
      for (const s of list) {
        expect(s.symbol).toBe(sym);
        expect(STRATEGIES[s.id]).toBe(s);
      }
    }
  });
});
