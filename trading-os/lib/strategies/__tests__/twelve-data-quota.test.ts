import { describe, it, expect } from "vitest";
import { estimateDailyCredits } from "../../marketdata/xtb-client";
import {
  recordTwelveDataCredit,
  getTwelveDataCreditStats,
  TD_DAILY_LIMIT,
} from "../../marketdata/twelve-data-credits";

describe("Twelve Data quota budget", () => {
  it("24h contínuo fica confortavelmente abaixo de 800", () => {
    const e = estimateDailyCredits();
    // M5=288, M15=96, H4=6, backfill=3 → 393
    expect(e.breakdown24h.M5).toBe(288);
    expect(e.breakdown24h.M15).toBe(96);
    expect(e.breakdown24h.H4).toBe(6);
    expect(e.continuous24h).toBe(393);
    expect(e.continuous24h).toBeLessThan(TD_DAILY_LIMIT * 0.6);
  });

  it("8h London/NY fica muito abaixo de 800", () => {
    const e = estimateDailyCredits();
    // M5=96, M15=32, H4=2, backfill=3 → 133
    expect(e.breakdown8h.M5).toBe(96);
    expect(e.breakdown8h.M15).toBe(32);
    expect(e.breakdown8h.H4).toBe(2);
    expect(e.session8h).toBe(133);
    expect(e.session8h).toBeLessThan(200);
  });

  it("contador de créditos incrementa e reporta dia UTC", () => {
    const before = getTwelveDataCreditStats().used;
    recordTwelveDataCredit("M5", 1);
    const after = getTwelveDataCreditStats();
    expect(after.used).toBe(before + 1);
    expect(after.limit).toBe(800);
    expect(after.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
