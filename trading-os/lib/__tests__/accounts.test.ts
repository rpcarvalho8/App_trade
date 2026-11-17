import { describe, expect, it } from "vitest";
import { accountForSymbolIn, costInR, costsByAccount, DEFAULT_ACCOUNTS, netPnl, nextPeak, parseSymbols, toEur, tradeFees, usdPerAccountUnit } from "@/lib/accounts";

describe("contas", () => {
  it("conta por activo: ouro na prop firm, SOL na Kraken", () => {
    expect(accountForSymbolIn(DEFAULT_ACCOUNTS, "XAUUSD")?.name).toBe("FundingPips");
    expect(accountForSymbolIn(DEFAULT_ACCOUNTS, "XAUUSD")?.kind).toBe("prop");
    expect(accountForSymbolIn(DEFAULT_ACCOUNTS, "solusd")?.name).toBe("Kraken");
    expect(accountForSymbolIn(DEFAULT_ACCOUNTS, "EURUSD")).toBeNull();
  });

  it("lê a lista de activos", () => {
    expect(parseSymbols("xauusd, SOLUSD xauusd")).toEqual(["XAUUSD", "SOLUSD"]);
    expect(parseSymbols(["solusd"])).toEqual(["SOLUSD"]);
    expect(parseSymbols("")).toEqual([]);
  });

  it("USD por unidade da conta", () => {
    expect(usdPerAccountUnit("EUR", 1.08)).toBe(1.08);
    expect(usdPerAccountUnit("EUR", null)).toBe(1);
    expect(usdPerAccountUnit("USD", 1.08)).toBe(1);
  });

  it("pico nunca desce", () => {
    expect(nextPeak(1000, 900)).toBe(1000);
    expect(nextPeak(1000, 1100)).toBe(1100);
    expect(nextPeak(null, 500)).toBe(500);
  });

  it("converte para EUR", () => {
    expect(toEur(108, "USD", 1.08)).toBeCloseTo(100);
    expect(toEur(100, "EUR", 1.08)).toBe(100);
    expect(toEur(100, "USD", null)).toBe(100);
  });
});

describe("custos", () => {
  it("P&L líquido desconta comissão e swap", () => {
    expect(tradeFees({ commission: 2, swap_funding: -0.5 })).toBeCloseTo(1.5);
    expect(netPnl({ pnl: 10, commission: 2, swap_funding: 1 })).toBe(7);
    expect(netPnl({ pnl: -5, commission: "", swap_funding: null })).toBe(-5);
  });

  it("custo em R", () => {
    // spread 0,2 com SL a 2 pontos = 0,1R; taxas 1 com risco 10 (20/2R) = 0,1R
    expect(costInR({ entry: 100, stop_loss: 98, spread_pts: 0.2, commission: 1, pnl: 20, rr_real: 2 })).toBeCloseTo(0.2);
    expect(costInR({ entry: 100, stop_loss: 98 })).toBeNull();
  });

  it("agrega por conta", () => {
    const out = costsByAccount([
      { pair: "XAUUSD", pnl: 10, commission: 1 },
      { pair: "XAUUSD", pnl: -5, commission: 1 },
      { pair: "SOLUSD", pnl: 4, swap_funding: 0.5 },
      { pair: "EURUSD", pnl: 1 },
    ], DEFAULT_ACCOUNTS);
    const fp = out.find((b) => b.account === "FundingPips")!;
    expect(fp.trades).toBe(2);
    expect(fp.fees).toBe(2);
    expect(fp.netPnl).toBe(3);
    expect(fp.grossPnl).toBe(5);
    expect(out.find((b) => b.account === "Kraken")!.netPnl).toBe(3.5);
    expect(out.find((b) => b.account === "Outra")!.trades).toBe(1);
  });
});
