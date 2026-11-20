import { describe, expect, it } from "vitest";
import type { Candle } from "../../types";
import { liquiditySweep } from "../liquiditySweep";
import { mssCisd } from "../mssCisd";
import { chochVolume } from "../chochVolume";
import { fvgGoldenRatio } from "../fvgGoldenRatio";
import { obOrFvg } from "../obOrFvg";
import { atr, atrAt, findDrawLevel, findHtfZones, findTappedZone, swingPivots, type HtfZone } from "../htfZones";

const MIN = 60_000;
let seq = 0;
const bar = (o: number, h: number, l: number, c: number, v = 100, i = seq++): Candle => ({
  time: 1_700_000_000_000 + i * MIN,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: v,
});
/** Série a partir de [open, high, low, close, volume?]. */
const series = (rows: number[][]): Candle[] => rows.map((r, i) => bar(r[0], r[1], r[2], r[3], r[4] ?? 100, i));
const flat = (n: number, o = 100, h = 101, l = 99, c = 100): Candle[] =>
  Array.from({ length: n }, (_, i) => bar(o, h, l, c, 100, i));

/** Impulso bearish 110 → 100 com FVGs bearish; o de 3 velas centrado em ~107 cai na zona 0.618–0.786. */
const bearishImpulse = series([
  [110, 110, 109, 109.2],
  [109.2, 109.5, 107.5, 107.8],
  [107.8, 108, 105.5, 106],
  [106, 106.5, 104, 104.5],
  [104.5, 105, 100, 100.5],
]);

describe("liquiditySweep (casos limite)", () => {
  const base = flat(11);
  it("precisa de histórico mínimo", () => {
    expect(liquiditySweep(flat(5)).details.reason).toBe("insufficient_candles");
  });
  it("sweep bearish com desvio acima de maxDeviationPct não conta", () => {
    const r = liquiditySweep([...base, bar(100.5, 101.5, 100, 100.5)], { maxDeviationPct: 0.2 });
    expect(r.detected).toBe(false);
    expect(r.details.reason).toBe("deviation_too_large");
    expect(r.details.direction).toBe("bearish");
  });
  it("sweep bearish dentro da tolerância é detectado", () => {
    const r = liquiditySweep([...base, bar(100.5, 101.5, 100, 100.5)], { maxDeviationPct: 1 });
    expect(r.detected).toBe(true);
    expect(r.details.sweptLevel).toBe(101);
    expect(r.details.extreme).toBe(101.5);
  });
  it("requireCloseBackInside=false aceita fecho para lá do nível; com true rejeita", () => {
    const last = bar(101, 102, 100.5, 101.8);
    expect(liquiditySweep([...base, last], { requireCloseBackInside: false }).detected).toBe(true);
    const strict = liquiditySweep([...base, last]);
    expect(strict.detected).toBe(false);
    expect(strict.details.reason).toBe("no_close_back_inside");
  });
  it("máximos e mínimos varridos na mesma vela: ganha o de máximos (comportamento actual)", () => {
    const r = liquiditySweep([...base, bar(100, 101.5, 98.5, 100)]);
    expect(r.details.direction).toBe("bearish");
  });
});

describe("mssCisd (bearish e limites)", () => {
  const down = series([
    [101, 102, 100, 100.5],
    [100.5, 101.5, 99, 99.5],
    [99.5, 100.5, 98, 98.5],
    [98.5, 100, 99, 99.5],
    [99.5, 101, 100, 100.5],
    [100.5, 101, 99.5, 100],
    [100, 101, 100, 100.5],
    [100.5, 101, 100.5, 100.8],
  ]);
  it("detecta MSS bearish quando fecha abaixo do último mínimo de swing", () => {
    const r = mssCisd([...down, bar(100, 100.2, 98.8, 99)], "bearish");
    expect(r.detected).toBe(true);
    expect(r.details.direction).toBe("bearish");
    expect(r.details.brokenLevel).toBe(99.5);
  });
  it("sem quebra devolve no_bearish_break", () => {
    const r = mssCisd([...down, bar(100.5, 101, 100, 100.2)], "bearish");
    expect(r.detected).toBe(false);
    expect(r.details.reason).toBe("no_bearish_break");
  });
  it("bias neutro e poucas velas não detectam", () => {
    expect(mssCisd(down, "neutral").details.reason).toBe("bias_neutral");
    expect(mssCisd(down.slice(0, 4), "bearish").details.reason).toBe("insufficient_candles");
  });
});

describe("chochVolume (bearish e limites)", () => {
  const hist = flat(22);
  it("ChoCH bearish com volume ×3 é detectado", () => {
    const r = chochVolume([...hist, bar(100, 100.2, 98.5, 98.8, 300)]);
    expect(r.detected).toBe(true);
    expect(r.details.direction).toBe("bearish");
    expect(r.details.brokenLevel).toBe(99);
    expect(r.details.volumeMultipleActual).toBeCloseTo(3);
  });
  it("sem volume suficiente devolve choch_no_volume com a direcção", () => {
    const r = chochVolume([...hist, bar(100, 100.2, 98.5, 98.8, 100)]);
    expect(r.detected).toBe(false);
    expect(r.details.reason).toBe("choch_no_volume");
    expect(r.details.direction).toBe("bearish");
  });
  it("sem quebra devolve no_choch e com poucas velas insufficient_candles", () => {
    expect(chochVolume([...hist, bar(100, 100.5, 99.5, 100, 300)]).details.reason).toBe("no_choch");
    expect(chochVolume(flat(10)).details.reason).toBe("insufficient_candles");
  });
});

describe("fvgGoldenRatio (bearish)", () => {
  it("aceita o FVG bearish que cai na zona 0.618–0.786", () => {
    const r = fvgGoldenRatio(bearishImpulse, [0.618, 0.786], 0.1, { direction: "bearish" });
    expect(r.detected).toBe(true);
    expect(r.details.direction).toBe("bearish");
    expect(r.details.fibLevel).toBeCloseTo(0.7, 1);
    expect(r.details.index).toBe(3);
  });
  it("com a zona fib noutro sítio devolve fvg_out_of_zone (o mais recente)", () => {
    const r = fvgGoldenRatio(bearishImpulse, [0.1, 0.2], 0.1, { direction: "bearish" });
    expect(r.detected).toBe(false);
    expect(r.details.reason).toBe("fvg_out_of_zone");
    expect(r.details.index).toBe(4);
  });
  it("sem FVG devolve no_fvg", () => {
    expect(fvgGoldenRatio(flat(8)).details.reason).toBe("no_fvg");
  });
});

describe("obOrFvg (bearish e Order Block)", () => {
  it("FVG bearish mais recente", () => {
    const r = obOrFvg(bearishImpulse, "M5", "bearish");
    expect(r.detected).toBe(true);
    expect(r.details.kind).toBe("fvg");
    expect(r.details.reason).toBe("bearish_fvg");
    expect(r.details.index).toBe(4);
  });
  it("respeita a direcção preferida: só FVGs bearish e bias bullish não detecta", () => {
    expect(obOrFvg(bearishImpulse, "M5", "bullish").detected).toBe(false);
  });
  it("sem gaps, devolve o Order Block bullish antes do impulso", () => {
    const r = obOrFvg(
      series([
        [100, 101, 99, 100],
        [100, 101, 99.5, 99.6],
        [99.6, 101.6, 99.4, 101.5],
        [101.5, 101.8, 100.8, 101.2],
      ]),
      "M5",
      "bullish"
    );
    expect(r.details.kind).toBe("order_block");
    expect(r.details.reason).toBe("bullish_ob");
    expect(r.details.zoneHigh).toBe(101);
    expect(r.details.zoneLow).toBe(99.5);
  });
});

describe("atr / swingPivots", () => {
  it("ATR de velas com TR constante", () => {
    const c = flat(20);
    expect(atr(c, 14)).toBeCloseTo(2);
    expect(atrAt(c, 10, 5)).toBeCloseTo(2);
    expect(atr([c[0]])).toBe(0);
  });
  it("pivots fractais com side=2 e sem pivots nas pontas", () => {
    const h = [1, 2, 5, 2, 1, 2, 3, 2, 1];
    const c = h.map((x, i) => bar(x, x, x - 0.5, x, 100, i));
    const p = swingPivots(c, 2);
    expect(p.highs.map((x) => x.i)).toEqual([2, 6]);
    expect(p.lows.map((x) => x.i)).toEqual([4]);
  });
});

describe("findHtfZones (OB grande, idade e estado)", () => {
  // 16 velas calmas, OB bearish enorme (range 3), deslocamento bullish, vela sem FVG.
  const calm = flat(16, 100, 100.5, 99.5, 100);
  const withDisplacement = [
    ...calm,
    bar(102, 102.5, 99.5, 99.8, 100, 16),
    bar(99.8, 103.5, 99.7, 103.3, 100, 17),
    bar(103.3, 104, 101.8, 103.8, 100, 18),
  ];
  it("recusa OB acima de maxObAtr e aceita com tolerância maior", () => {
    expect(findHtfZones(withDisplacement, "H4").filter((z) => z.kind === "ob")).toHaveLength(0);
    const z = findHtfZones(withDisplacement, "H4", { maxObAtr: 3 }).filter((x) => x.kind === "ob");
    expect(z).toHaveLength(1);
    expect(z[0]).toMatchObject({ direction: "bullish", high: 102.5, low: 99.5 });
  });
  it("regista o primeiro toque e marca a zona como partida só depois de um fecho abaixo", () => {
    const touched = [...withDisplacement, bar(103, 103.2, 102.0, 102.8, 100, 19)];
    const z1 = findHtfZones(touched, "H4", { maxObAtr: 3 })[0];
    // a própria vela que completa o OB (índice 18) já toca na zona.
    expect(z1.firstTouchIndex).toBe(18);
    expect(z1.broken).toBe(false);
    const broken = [...touched, bar(102.8, 102.9, 98.8, 99, 100, 20)];
    const z2 = findHtfZones(broken, "H4", { maxObAtr: 3 })[0];
    expect(z2.broken).toBe(true);
  });
  it("com menos de period+3 velas não devolve zonas", () => {
    expect(findHtfZones(calm.slice(0, 10), "H4")).toEqual([]);
  });
});

const zone = (id: string, over: Partial<HtfZone> = {}): HtfZone => ({
  id,
  tf: "H4",
  kind: "fvg",
  direction: "bullish",
  high: 103,
  low: 101,
  createdAt: 1,
  atr: 2,
  broken: false,
  firstTouchIndex: null,
  ...over,
});

describe("findTappedZone", () => {
  const by = (zones: HtfZone[], tf = "H4", closedCount = 10) => [{ tf, zones, closedCount }];
  it("devolve a zona fresca onde o preço está e respeita a tolerância (0,1 ATR = 0,2)", () => {
    const zs = by([zone("a")]);
    expect(findTappedZone(zs, 102, "bullish")?.id).toBe("a");
    expect(findTappedZone(zs, 103.15, "bullish")?.id).toBe("a");
    expect(findTappedZone(zs, 103.25, "bullish")).toBeNull();
    expect(findTappedZone(zs, 103.25, "bullish", { toleranceAtr: 0.2 })?.id).toBe("a");
  });
  it("ignora zonas partidas, excluídas e já tocadas antes da última vela fechada", () => {
    const zs = by([zone("broken", { broken: true }), zone("excl"), zone("old", { firstTouchIndex: 5 })]);
    expect(findTappedZone(zs, 102, "bullish", { exclude: ["excl"] })).toBeNull();
    expect(findTappedZone(by([zone("last", { firstTouchIndex: 9 })]), 102, "bullish")?.id).toBe("last");
  });
  it("com requireBiasAlignment só aceita a zona do lado do bias", () => {
    const zs = by([zone("a")]);
    expect(findTappedZone(zs, 102, "bearish", { requireBiasAlignment: true })).toBeNull();
    expect(findTappedZone(zs, 102, "bearish")?.id).toBe("a");
  });
  it("prefere o primeiro TF da lista e, dentro dele, a zona mais recente", () => {
    const h4 = { tf: "H4", closedCount: 10, zones: [zone("h4-old", { createdAt: 1 }), zone("h4-new", { createdAt: 5 })] };
    const h1 = { tf: "H1", closedCount: 10, zones: [zone("h1", { tf: "H1", createdAt: 9 })] };
    expect(findTappedZone([h4, h1], 102, "bullish")?.id).toBe("h4-new");
    expect(findTappedZone([h1, h4], 102, "bullish")?.id).toBe("h1");
  });
});

describe("findDrawLevel (short e limites)", () => {
  const swing = flat(3);
  it("short: limite superior da zona de procura abaixo da entrada", () => {
    const zs = [zone("d", { direction: "bullish", high: 95, low: 93 })];
    expect(findDrawLevel("short", 100, zs, swing)).toEqual({ level: 95, source: "d" });
  });
  it("ignora zonas partidas e do lado errado", () => {
    const zs = [
      zone("b", { direction: "bullish", high: 95, low: 93, broken: true }),
      zone("w", { direction: "bearish", high: 95, low: 93 }),
    ];
    expect(findDrawLevel("short", 100, zs, swing)).toBeNull();
  });
  it("escolhe o nível mais próximo que respeita a distância mínima", () => {
    const zs = [zone("near", { direction: "bullish", high: 98, low: 96 }), zone("far", { direction: "bullish", high: 94, low: 92 })];
    expect(findDrawLevel("short", 100, zs, swing)?.source).toBe("near");
    expect(findDrawLevel("short", 100, zs, swing, 4)?.source).toBe("far");
    expect(findDrawLevel("short", 100, zs, swing, 20)).toBeNull();
  });
});
