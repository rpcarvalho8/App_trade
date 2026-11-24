import { describe, expect, it } from "vitest";
import { parseFeed } from "@/lib/news/rss";
import { classifyHeadline } from "@/lib/news/classify";
import { allowByRate, isDuplicate, titleTokens } from "@/lib/news/dedupe";

const level = (title: string, opts = {}) =>
  Object.fromEntries(classifyHeadline(title, opts).map((x) => [x.asset, x.level]));

describe("parseFeed", () => {
  it("lê RSS 2.0 com CDATA e entidades", () => {
    const xml = `<rss><channel><title>x</title>
      <item><title><![CDATA[Fed cuts rates by 50 bps &amp; signals more]]></title>
      <link><![CDATA[https://example.com/a?utm=1]]></link><guid isPermaLink="false">g1</guid>
      <pubDate>Mon, 23 Nov 2026 17:42:18 +0000</pubDate><description><![CDATA[<p>Body</p>]]></description></item>
      <item><title>Gold &#8217;s rally</title><link>https://example.com/b</link></item>
    </channel></rss>`;
    const items = parseFeed(xml);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "g1", title: "Fed cuts rates by 50 bps & signals more", link: "https://example.com/a?utm=1", summary: "Body" });
    expect(items[0].publishedAt).toBe(Date.parse("2026-11-23T17:42:18Z"));
    expect(items[1].title).toBe("Gold ’s rally");
    expect(Number.isNaN(items[1].publishedAt)).toBe(true);
  });

  it("lê Atom", () => {
    const xml = `<feed><entry><title>Solana network outage</title><id>urn:1</id>
      <link rel="alternate" href="https://example.com/c"/><updated>2026-11-24T10:00:00Z</updated></entry></feed>`;
    expect(parseFeed(xml)[0]).toMatchObject({ id: "urn:1", link: "https://example.com/c", title: "Solana network outage" });
  });
});

describe("classifyHeadline", () => {
  it("decisão da Fed com surpresa é crítica para ouro e SOL", () => {
    expect(level("Fed unexpectedly cuts rates by 50 bps", { boost: 1 })).toEqual({ XAUUSD: "critical", SOLUSD: "critical" });
  });

  it("comunicado oficial da Fed sobre juros é crítico", () => {
    expect(level("Federal Reserve issues FOMC statement", { boost: 2, official: true }).XAUUSD).toBe("critical");
  });

  it("comunicado da Fed sem tema de mercado não alerta", () => {
    expect(level("Federal Reserve announces College Fed Challenge winners", { boost: 2, official: true }).XAUUSD ?? null).toBe(null);
  });

  it("geopolítica alerta o ouro, não a SOL", () => {
    expect(level("Breaking: Israel launches missile strikes on Iran", { boost: 1 })).toEqual({ XAUUSD: "critical" });
  });

  it("hack em Solana é crítico", () => {
    expect(level("Solana DeFi protocol exploited, $120M drained").SOLUSD).toBe("critical");
  });

  it("ETF de Solana aprovado pela SEC é crítico", () => {
    expect(level("SEC approves first spot Solana ETF", { boost: 1, official: true }).SOLUSD).toBe("critical");
  });

  it("análise/previsão de preço é ruído", () => {
    expect(level("Solana price prediction: SOL could hit $300 — here's why").SOLUSD).toBe(null);
    expect(level("Will gold hit a record high this week?").XAUUSD ?? null).toBe(null);
  });

  it("notícia sem relação com os activos não alerta", () => {
    expect(classifyHeadline("Nvidia board reinstates Jensen Huang as CEO")).toEqual([]);
  });

  it("cripto genérica fica abaixo do limiar", () => {
    expect(level("Bitcoin rebounds 17% from $55K lows as Nvidia rally sparks $500M crypto liquidations").SOLUSD).toBe(null);
  });
});

describe("dedupe e limite de frequência", () => {
  it("o mesmo facto em duas fontes é duplicado", () => {
    const now = Date.now();
    const recent = [{ tokens: titleTokens("Fed cuts rates by 50 bps in surprise move"), at: now - 60_000 }];
    expect(isDuplicate("BREAKING: Fed cuts rates by 50 bps", recent, now)).toBe(true);
    expect(isDuplicate("Solana network halted after validator bug", recent, now)).toBe(false);
  });

  it("depois da janela deixa de ser duplicado", () => {
    const now = Date.now();
    const recent = [{ tokens: titleTokens("Fed cuts rates by 50 bps"), at: now - 7 * 3600_000 }];
    expect(isDuplicate("Fed cuts rates by 50 bps", recent, now)).toBe(false);
  });

  it("warning respeita intervalo mínimo; crítico passa, mas há teto por hora", () => {
    const cfg = { minGapMs: 10 * 60_000, maxPerHour: 4 };
    const now = 10_000_000;
    expect(allowByRate([now - 5 * 60_000], "warning", now, cfg)).toBe(false);
    expect(allowByRate([now - 11 * 60_000], "warning", now, cfg)).toBe(true);
    expect(allowByRate([now - 60_000], "critical", now, cfg)).toBe(true);
    const six = Array.from({ length: 6 }, (_, i) => now - i * 60_000);
    expect(allowByRate(six, "critical", now, cfg)).toBe(false);
  });
});
