import { describe, expect, it } from "vitest";
import { dayStartFor, FUNDINGPIPS_DEFAULT, propDay, propRiskBlock, propStatus, rollDayStart, type PropAccountLike } from "@/lib/prop-rules";

// 17 Nov 2026, 07:52 UTC (dia FundingPips = 17; reset às 22h UTC).
const NOW = Date.UTC(2026, 10, 17, 7, 52);

const fp = (over: Partial<PropAccountLike> = {}): PropAccountLike => ({
  name: "FundingPips",
  kind: "prop",
  equity: 5012.81,
  peak_equity: 5052.84,
  ...FUNDINGPIPS_DEFAULT,
  day_start_equity: 5026.85,
  day_start_date: "2026-11-17",
  ...over,
});

describe("dia da prop firm", () => {
  it("muda às 22h UTC", () => {
    expect(propDay(Date.UTC(2026, 10, 17, 21, 59), 22)).toBe("2026-11-17");
    expect(propDay(Date.UTC(2026, 10, 17, 22, 0), 22)).toBe("2026-11-18");
    expect(propDay(Date.UTC(2026, 10, 17, 12, 0), 0)).toBe("2026-11-17");
  });

  it("início do dia: valor de hoje, senão o equity actual", () => {
    expect(dayStartFor(fp(), NOW)).toBe(5026.85);
    expect(dayStartFor(fp({ day_start_date: "2026-11-16" }), NOW)).toBe(5012.81);
  });

  it("ao mudar de dia o início passa a ser o equity anterior", () => {
    const prev = { equity: 5012.81, day_start_equity: 5026.85, day_start_date: "2026-11-17", reset_hour_utc: 22 };
    expect(rollDayStart(prev, NOW)).toEqual({ day_start_equity: 5026.85, day_start_date: "2026-11-17" });
    expect(rollDayStart(prev, Date.UTC(2026, 10, 17, 23, 0))).toEqual({ day_start_equity: 5012.81, day_start_date: "2026-11-18" });
  });
});

describe("regras FundingPips (igual ao dashboard)", () => {
  it("limites diário, total e target", () => {
    const s = propStatus(fp(), NOW)!;
    expect(s.dailyLimit).toBe(251.34);
    expect(s.dailyFloor).toBe(4775.51);
    expect(s.dailyLoss).toBe(14.04);
    expect(s.dailyRemaining).toBe(237.3);
    expect(s.totalFloor).toBe(4500);
    expect(s.totalRemaining).toBe(512.81);
    expect(s.target).toBe(400);
    expect(s.profit).toBe(12.81);
    expect(s.progressPct).toBeCloseTo(3.2, 1);
    expect(s.maxRiskMoney).toBe(237.3);
    expect(s.breached).toBe(false);
  });

  it("trava a trade que arrisca mais do que falta", () => {
    const s = propStatus(fp(), NOW)!;
    expect(propRiskBlock(s, 25)).toBeNull();
    expect(propRiskBlock(s, 300)).toMatch(/limite diário/);
  });

  it("conta violada e target atingido", () => {
    expect(propStatus(fp({ equity: 4770 }), NOW)!.breached).toBe(true);
    expect(propStatus(fp({ equity: 4499, day_start_date: null }), NOW)!.reason).toMatch(/perda total/);
    const won = propStatus(fp({ equity: 5401, day_start_date: null }), NOW)!;
    expect(won.passed).toBe(true);
    expect(propRiskBlock(won, 10)).toMatch(/profit target/);
  });

  it("trailing: o mínimo sobe com o pico até ao tamanho inicial", () => {
    expect(propStatus(fp({ max_dd_type: "trailing", peak_equity: 5200 }), NOW)!.totalFloor).toBe(4700);
    expect(propStatus(fp({ max_dd_type: "trailing", peak_equity: 6000 }), NOW)!.totalFloor).toBe(5000);
  });

  it("corretora não tem regras", () => {
    expect(propStatus({ name: "Kraken", kind: "broker", equity: 100, peak_equity: 100 }, NOW)).toBeNull();
    expect(propRiskBlock(null, 1000)).toBeNull();
  });
});
