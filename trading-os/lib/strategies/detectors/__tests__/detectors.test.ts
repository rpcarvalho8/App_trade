import { describe, it, expect } from "vitest";
import { liquiditySweep } from "../liquiditySweep";
import { mssCisd } from "../mssCisd";
import { obOrFvg } from "../obOrFvg";
import { chochVolume } from "../chochVolume";
import { fvgGoldenRatio } from "../fvgGoldenRatio";
import {
  xauSweepPositive,
  xauSweepInvalidation,
  xauMssPositive,
  xauMssInvalidation,
  xauObFvgPositive,
  xauObFvgInvalidation,
  solChochPositive,
  solChochInvalidation,
  solFvgPositive,
  solFvgInvalidation,
  solSweepPositive,
  solSweepInvalidation,
} from "../../__fixtures__/candles";

describe("liquiditySweep", () => {
  it("deteta sweep bullish XAUUSD com fecho de volta", () => {
    const res = liquiditySweep(xauSweepPositive, { requireCloseBackInside: true });
    expect(res.detected).toBe(true);
    expect(res.details.direction).toBe("bullish");
    expect(res.details.extreme).not.toBeNull();
  });

  it("invalida quando fecha através do nível", () => {
    const res = liquiditySweep(xauSweepInvalidation, { requireCloseBackInside: true });
    expect(res.detected).toBe(false);
    expect(res.details.reason).toMatch(/no_close_back_inside|no_sweep/);
  });

  it("deteta sweep SOLUSD dentro da tolerância 0.2%", () => {
    const res = liquiditySweep(solSweepPositive, {
      requireCloseBackInside: true,
      maxDeviationPct: 0.2,
    });
    expect(res.detected).toBe(true);
  });

  it("invalida sweep SOLUSD com desvio excessivo", () => {
    const res = liquiditySweep(solSweepInvalidation, {
      requireCloseBackInside: true,
      maxDeviationPct: 0.2,
    });
    expect(res.detected).toBe(false);
    expect(res.details.reason).toBe("deviation_too_large");
  });
});

describe("mssCisd", () => {
  it("deteta MSS bullish alinhado com bias", () => {
    const res = mssCisd(xauMssPositive, "bullish");
    expect(res.detected).toBe(true);
    expect(res.details.alignedWithBias).toBe(true);
    expect(res.details.direction).toBe("bullish");
  });

  it("não deteta MSS sem quebra de estrutura", () => {
    const res = mssCisd(xauMssInvalidation, "bullish");
    expect(res.detected).toBe(false);
  });
});

describe("obOrFvg", () => {
  it("identifica OB ou FVG bullish no M5", () => {
    const res = obOrFvg(xauObFvgPositive, "M5", "bullish");
    expect(res.detected).toBe(true);
    expect(["order_block", "fvg"]).toContain(res.details.kind);
  });

  it("não inventa zona em range apertado", () => {
    const res = obOrFvg(xauObFvgInvalidation, "M5");
    expect(res.detected).toBe(false);
  });
});

describe("chochVolume", () => {
  it("deteta ChoCH com spike de volume ×1.5", () => {
    const res = chochVolume(solChochPositive, 1.5, 20);
    expect(res.detected).toBe(true);
    expect(res.details.volumeMultipleActual).toBeGreaterThanOrEqual(1.5);
  });

  it("invalida ChoCH sem volume", () => {
    const res = chochVolume(solChochInvalidation, 1.5, 20);
    expect(res.detected).toBe(false);
    expect(res.details.reason).toMatch(/choch_no_volume|no_choch/);
  });
});

describe("fvgGoldenRatio", () => {
  it("aceita FVG na zona 0.618–0.786", () => {
    const res = fvgGoldenRatio(solFvgPositive, [0.618, 0.786], 0.1, {
      direction: "bullish",
      impulseStart: 100,
      impulseExtreme: 110,
    });
    expect(res.detected).toBe(true);
    expect(res.details.inZone).toBe(true);
    expect(res.details.fibLevel!).toBeGreaterThanOrEqual(0.618);
    expect(res.details.fibLevel!).toBeLessThanOrEqual(0.786);
  });

  it("rejeita FVG fora da zona ou demasiado pequeno", () => {
    const res = fvgGoldenRatio(solFvgInvalidation, [0.618, 0.786], 0.1, {
      direction: "bullish",
      impulseStart: 100,
      impulseExtreme: 110,
    });
    expect(res.detected).toBe(false);
  });
});
