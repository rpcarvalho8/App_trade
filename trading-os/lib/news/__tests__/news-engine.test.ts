import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: { type: string; level: string; asset?: string; message: string }[] = [];
const emails: string[] = [];
vi.mock("@/lib/alert-ws", () => ({ broadcastAlert: (a: never) => sent.push(a) }));
vi.mock("@/lib/alert-email", () => ({ sendAlertEmail: async (subject: string) => (emails.push(subject), true) }));
vi.mock("@/lib/alert-engine", () => ({ priceReaction: () => ({ price: 2650.5, changePct: 0.42 }) }));

import { newsShockActive, processItem } from "@/lib/news-engine";

const feed = { id: "investinglive", name: "investingLive", url: "https://x", boost: 1 };
const item = (title: string, id = title) => ({ id, title, link: "https://example.com/n", publishedAt: Date.now() - 60_000, summary: "" });

describe("news-engine.processItem", () => {
  beforeEach(() => {
    sent.length = 0;
    emails.length = 0;
    delete (globalThis as { __tosNewsEngine?: unknown }).__tosNewsEngine;
  });

  it("notícia crítica: alerta, email e pausa de sinais no activo", () => {
    const now = Date.now();
    const a = processItem(item("Breaking: Israel launches missile strikes on Iran"), feed, now);
    expect(a?.level).toBe("critical");
    expect(a?.asset).toBe("XAUUSD");
    expect(a?.message).toContain("(+0.42% em 15 min)");
    expect(emails).toHaveLength(1);
    expect(newsShockActive("XAUUSD", now + 60_000)).toBe(true);
    expect(newsShockActive("SOLUSD", now + 60_000)).toBe(false);
    expect(newsShockActive("XAUUSD", now + 16 * 60_000)).toBe(false);
  });

  it("a mesma notícia noutra fonte não repete o alerta", () => {
    const now = Date.now();
    processItem(item("Fed unexpectedly cuts rates by 50 bps"), feed, now);
    processItem(item("BREAKING: Fed cuts rates by 50 bps", "other"), { ...feed, id: "coindesk", name: "CoinDesk" }, now + 30_000);
    expect(sent).toHaveLength(1);
  });

  it("warning: sem email e sem pausa", () => {
    const a = processItem(item("Gold climbs as Treasury yields slide"), feed);
    expect(a?.level).toBe("warning");
    expect(emails).toHaveLength(0);
    expect(newsShockActive("XAUUSD")).toBe(false);
  });

  it("ruído não gera alerta", () => {
    expect(processItem(item("Solana price prediction: SOL could hit $300"), feed)).toBeNull();
    expect(sent).toHaveLength(0);
  });
});
