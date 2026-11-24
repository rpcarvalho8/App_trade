/**
 * Fontes de notícias gratuitas e sem chave (verificadas em 24/11/2026).
 *
 *  - investingLive (ex-ForexLive): squawk macro em tempo real — Fed, dados, geopolítica, ouro.
 *  - Federal Reserve: comunicados oficiais (decisões FOMC, declarações de emergência).
 *  - SEC: comunicados oficiais (ETFs, processos contra exchanges).
 *  - CoinDesk / Cointelegraph / Decrypt: cripto (hacks, ETFs, Solana).
 *
 * Testadas e postas de parte: FXStreet RSS (parado desde out/2026), status.solana.com
 * (sem incidentes desde 2024), Google News RSS (bloqueia acessos automáticos), Kitco (erro).
 *
 * `boost` soma à pontuação: fontes oficiais pesam mais. `official` = tudo o que a fonte
 * publica sobre política monetária conta como alto impacto.
 */
export interface NewsFeed {
  id: string;
  name: string;
  url: string;
  boost: number;
  official?: boolean;
}

export const NEWS_FEEDS: NewsFeed[] = [
  { id: "investinglive", name: "investingLive", url: "https://investinglive.com/feed/", boost: 1 },
  { id: "fed", name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml", boost: 2, official: true },
  { id: "sec", name: "SEC", url: "https://www.sec.gov/news/pressreleases.rss", boost: 1, official: true },
  { id: "coindesk", name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", boost: 0 },
  { id: "cointelegraph", name: "Cointelegraph", url: "https://cointelegraph.com/rss", boost: 0 },
  { id: "decrypt", name: "Decrypt", url: "https://decrypt.co/feed", boost: 0 },
];

/** Fontes extra por env, separadas por vírgula: NEWS_EXTRA_FEEDS=https://a/rss,https://b/rss */
export function activeFeeds(): NewsFeed[] {
  const disabled = new Set((process.env.NEWS_DISABLED_FEEDS || "").split(",").map((x) => x.trim()).filter(Boolean));
  const extra = (process.env.NEWS_EXTRA_FEEDS || "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => /^https?:\/\//.test(x))
    .map((url, i) => ({ id: `extra${i + 1}`, name: new URL(url).hostname, url, boost: 0 }));
  return [...NEWS_FEEDS.filter((f) => !disabled.has(f.id)), ...extra];
}
