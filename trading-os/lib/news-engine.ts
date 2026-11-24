/**
 * Motor de Notícias de Última Hora.
 *
 * Sonda feeds RSS gratuitos (lib/news/feeds.ts) a cada NEWS_POLL_SEC, classifica cada título
 * por impacto em XAUUSD / SOLUSD (lib/news/classify.ts), deduplica entre fontes e aplica
 * limite de frequência antes de emitir um alerta "news" pelo mesmo canal dos restantes
 * (toast/notificação do sistema + Telegram; email só nos críticos).
 *
 * Proteção de capital: uma notícia CRÍTICA abre um "news shock" no activo durante
 * NEWS_SHOCK_BLOCK_MIN minutos; o motor de sinais trata-o como calendário sujo (sem sinais).
 *
 * A primeira leitura de cada feed só regista o que já existe (sem alertas), para o arranque
 * da app não disparar notícias antigas.
 */
import { broadcastAlert, type MarketAlert } from "@/lib/alert-ws";
import { sendAlertEmail } from "@/lib/alert-email";
import { priceReaction } from "@/lib/alert-engine";
import { activeFeeds, type NewsFeed } from "@/lib/news/feeds";
import { parseFeed, type FeedItem } from "@/lib/news/rss";
import { classifyHeadline, type NewsAsset } from "@/lib/news/classify";
import { allowByRate, isDuplicate, titleTokens, type RecentHeadline } from "@/lib/news/dedupe";

const UA = "Mozilla/5.0 (compatible; TradingOS-NewsEngine/1.0)";

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && process.env[name]?.trim() ? n : fallback;
}

export function newsConfig() {
  return {
    enabled: process.env.NEWS_ALERTS !== "off",
    pollSec: envNum("NEWS_POLL_SEC", 90),
    maxAgeMin: envNum("NEWS_MAX_AGE_MIN", 30),
    minScore: envNum("NEWS_MIN_SCORE", 5),
    criticalScore: envNum("NEWS_CRITICAL_SCORE", 8),
    minGapMin: envNum("NEWS_MIN_GAP_MIN", 10),
    maxPerHour: envNum("NEWS_MAX_PER_HOUR", 4),
    shockBlockMin: envNum("NEWS_SHOCK_BLOCK_MIN", 15),
    emailCritical: process.env.NEWS_EMAIL !== "off",
  };
}

export interface NewsHit {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: number;
  detectedAt: number;
  assets: NewsAsset[];
  level: "warning" | "critical";
  score: number;
  reasons: string[];
  /** Motivo por que não gerou alerta (dedupe/limite) — fica no histórico para auditoria. */
  suppressed?: string;
}

interface NewsState {
  started: boolean;
  timer: NodeJS.Timeout | null;
  seen: Record<string, Set<string>>;
  baselined: Record<string, boolean>;
  feedErrors: Record<string, { at: number; msg: string }>;
  recentHeadlines: RecentHeadline[];
  rateHistory: Record<NewsAsset, number[]>;
  shockUntil: Record<NewsAsset, number>;
  hits: NewsHit[];
  lastPollAt: number;
}

function state(): NewsState {
  const g = globalThis as typeof globalThis & { __tosNewsEngine?: NewsState };
  if (!g.__tosNewsEngine) {
    g.__tosNewsEngine = {
      started: false,
      timer: null,
      seen: {},
      baselined: {},
      feedErrors: {},
      recentHeadlines: [],
      rateHistory: { XAUUSD: [], SOLUSD: [] },
      shockUntil: { XAUUSD: 0, SOLUSD: 0 },
      hits: [],
      lastPollAt: 0,
    };
  }
  return g.__tosNewsEngine;
}

/** true enquanto uma notícia crítica recente bloqueia sinais no activo. */
export function newsShockActive(asset: string, now = Date.now()): boolean {
  const until = state().shockUntil[asset as NewsAsset];
  return !!until && now < until;
}

export function getNewsStatus() {
  const s = state();
  return {
    config: newsConfig(),
    lastPollAt: s.lastPollAt || null,
    feeds: activeFeeds().map((f) => ({ id: f.id, name: f.name, ok: !s.feedErrors[f.id], error: s.feedErrors[f.id]?.msg ?? null })),
    shock: { XAUUSD: s.shockUntil.XAUUSD || null, SOLUSD: s.shockUntil.SOLUSD || null },
    recent: s.hits.slice(-30).reverse(),
  };
}

async function fetchFeed(feed: NewsFeed): Promise<FeedItem[]> {
  const res = await fetch(feed.url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text());
}

function fmtReaction(asset: NewsAsset): string {
  const r = priceReaction(asset, 15 * 60_000);
  if (!r) return "";
  const p = r.price >= 100 ? r.price.toLocaleString("pt-PT", { maximumFractionDigits: 2 }) : r.price.toFixed(2);
  const ch = r.changePct == null ? "" : ` (${r.changePct >= 0 ? "+" : ""}${r.changePct.toFixed(2)}% em 15 min)`;
  return `${asset} ${p}${ch}`;
}

function remember(hit: NewsHit) {
  const s = state();
  s.hits.push(hit);
  if (s.hits.length > 200) s.hits.splice(0, s.hits.length - 200);
}

/** Avalia um item novo; devolve o alerta emitido (ou null). Exportado para testes manuais. */
export function processItem(item: FeedItem, feed: NewsFeed, now = Date.now()): MarketAlert | null {
  const s = state();
  const cfg = newsConfig();
  const scores = classifyHeadline(item.title, {
    boost: feed.boost,
    official: feed.official,
    minScore: cfg.minScore,
    criticalScore: cfg.criticalScore,
  }).filter((x) => x.level);
  if (!scores.length) return null;

  const level: "warning" | "critical" = scores.some((x) => x.level === "critical") ? "critical" : "warning";
  const best = Math.max(...scores.map((x) => x.score));
  const hit: NewsHit = {
    id: `${feed.id}:${item.id}`,
    title: item.title,
    link: item.link,
    source: feed.name,
    publishedAt: item.publishedAt,
    detectedAt: now,
    assets: scores.map((x) => x.asset),
    level,
    score: best,
    reasons: [...new Set(scores.flatMap((x) => x.reasons))],
  };

  s.recentHeadlines = s.recentHeadlines.filter((r) => now - r.at < 6 * 3600_000);
  if (isDuplicate(item.title, s.recentHeadlines, now)) {
    hit.suppressed = "duplicado (já alertado por outra fonte)";
    remember(hit);
    return null;
  }

  const rateCfg = { minGapMs: cfg.minGapMin * 60_000, maxPerHour: cfg.maxPerHour };
  const allowed = scores.filter((x) => allowByRate(s.rateHistory[x.asset], x.level!, now, rateCfg));
  if (!allowed.length) {
    hit.suppressed = "limite de frequência";
    remember(hit);
    return null;
  }

  const assets = allowed.map((x) => x.asset);
  for (const a of assets) {
    s.rateHistory[a] = [...s.rateHistory[a].filter((t) => now - t < 3600_000), now];
    if (level === "critical") s.shockUntil[a] = now + cfg.shockBlockMin * 60_000;
  }
  s.recentHeadlines.push({ tokens: titleTokens(item.title), at: now });
  hit.assets = assets;
  remember(hit);

  const reaction = assets.map(fmtReaction).filter(Boolean).join(" · ");
  const ageMin = Number.isFinite(item.publishedAt) ? Math.max(0, Math.round((now - item.publishedAt) / 60000)) : null;
  const shockNote = level === "critical" ? ` Sinais em pausa ${cfg.shockBlockMin} min.` : "";
  const alert: MarketAlert = {
    id: `news-${now}-${Math.random().toString(36).slice(2, 8)}`,
    ts: now,
    type: "news",
    level,
    asset: assets.join(" · "),
    title: `${level === "critical" ? "🚨" : "📰"} ${assets.join(" · ")} · ${hit.reasons.slice(0, 2).join(", ")}`,
    message: `${item.title} — ${feed.name}${ageMin != null ? ` (há ${ageMin} min)` : ""}.${reaction ? ` ${reaction}.` : ""}${shockNote}`,
    meta: { kind: "news", url: item.link, source: feed.name, score: best, reasons: hit.reasons },
  };
  broadcastAlert(alert);

  if (level === "critical" && cfg.emailCritical) {
    sendAlertEmail(
      `Notícia crítica ${assets.join("/")}: ${item.title.slice(0, 90)}`,
      [
        item.title,
        `Fonte: ${feed.name}${ageMin != null ? ` · publicada há ${ageMin} min` : ""}`,
        item.link,
        "",
        `Activos: ${assets.join(", ")} · motivos: ${hit.reasons.join(", ")} · score ${best}`,
        reaction ? `Preço: ${reaction}` : "",
        "",
        `Motor de sinais em pausa ${cfg.shockBlockMin} min nestes activos. Revê posições abertas e stops.`,
      ].join("\n")
    ).catch((e) => console.warn("[News] email falhou:", e instanceof Error ? e.message : e));
  }
  return alert;
}

async function pollFeed(feed: NewsFeed, now: number): Promise<void> {
  const s = state();
  const cfg = newsConfig();
  let items: FeedItem[];
  try {
    items = await fetchFeed(feed);
    delete s.feedErrors[feed.id];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const prev = s.feedErrors[feed.id];
    if (!prev || now - prev.at > 3600_000) console.warn(`[News] ${feed.name} falhou: ${msg}`);
    s.feedErrors[feed.id] = { at: prev && now - prev.at <= 3600_000 ? prev.at : now, msg };
    return;
  }
  const seen = (s.seen[feed.id] ??= new Set());
  const fresh = items.filter((it) => !seen.has(it.id));
  for (const it of fresh) seen.add(it.id);
  if (seen.size > 2000) s.seen[feed.id] = new Set([...seen].slice(-1000));

  if (!s.baselined[feed.id]) {
    s.baselined[feed.id] = true;
    return;
  }
  const maxAge = cfg.maxAgeMin * 60_000;
  for (const it of fresh) {
    if (Number.isFinite(it.publishedAt) && now - it.publishedAt > maxAge) continue;
    processItem(it, feed, now);
  }
}

export async function newsTick(): Promise<void> {
  const now = Date.now();
  state().lastPollAt = now;
  await Promise.all(activeFeeds().map((f) => pollFeed(f, now)));
}

/** Arranca o motor de notícias (idempotente). NEWS_ALERTS=off desliga. */
export function startNewsEngine(): void {
  const s = state();
  const cfg = newsConfig();
  if (s.started || !cfg.enabled) return;
  s.started = true;
  newsTick().catch(() => {});
  s.timer = setInterval(() => {
    newsTick().catch((e) => console.warn("[News] tick:", e instanceof Error ? e.message : e));
  }, cfg.pollSec * 1000);
  console.log(`[News] motor ativo — ${activeFeeds().length} fontes a cada ${cfg.pollSec}s (mín. score ${cfg.minScore}, crítico ${cfg.criticalScore}).`);
}
