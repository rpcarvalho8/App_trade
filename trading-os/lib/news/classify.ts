/**
 * Classificador de impacto por palavras-chave (determinístico, sem IA, sem custo).
 *
 * Pontuação por activo = soma das regras-âncora do activo + urgência + peso da fonte − ruído.
 * Só há alerta se pelo menos uma regra-âncora do activo bater (urgência sozinha não conta).
 *   score ≥ NEWS_CRITICAL_SCORE (8) → critical  (toast + som + Telegram + email)
 *   score ≥ NEWS_MIN_SCORE      (5) → warning   (toast + Telegram)
 */
export type NewsAsset = "XAUUSD" | "SOLUSD";

interface Rule {
  re: RegExp;
  w: number;
  assets: NewsAsset[];
  label: string;
}

const BOTH: NewsAsset[] = ["XAUUSD", "SOLUSD"];

const ANCHORS: Rule[] = [
  // --- macro / política monetária (mexe com ouro e cripto) ---
  { label: "decisão de juros", w: 5, assets: BOTH, re: /\b(fed|fomc|ecb|boj|central bank) (cuts?|hikes?|holds?|raises?|lowers?|keeps?|leaves?)\b|\brates? (cut|hike|decision)s?\b|\bfomc statement\b|\bbasis points?\b|\bbps\b/i },
  { label: "reunião de emergência", w: 6, assets: BOTH, re: /\bemergency (rate|meeting|cut|action)\b|\bintermeeting\b/i },
  { label: "Fed/Powell", w: 3, assets: BOTH, re: /\b(fomc|federal reserve|powell|fed chair|fed governor|fed's|fed officials?)\b/i },
  { label: "dado macro", w: 3, assets: BOTH, re: /\b(cpi|inflation|pce|non-?farm|payrolls|nfp|jobs report|unemployment rate|gdp|ism)\b/i },
  { label: "tarifas/sanções", w: 2, assets: BOTH, re: /\b(sanctions?|tariffs?|trade war)\b/i },
  // --- ouro ---
  { label: "ouro", w: 3, assets: ["XAUUSD"], re: /\b(gold|bullion|xau(\/?usd)?|precious metals?)\b/i },
  { label: "geopolítica", w: 4, assets: ["XAUUSD"], re: /\b(war|invasion|invades?|missiles?|air ?strikes?|military strikes?|strikes on|nuclear|ceasefire|troops|drone attack|attacks? on)\b/i },
  { label: "yields/dólar", w: 1, assets: ["XAUUSD"], re: /\b(treasury yields?|bond yields?|dollar index|dxy)\b/i },
  { label: "bancos centrais compram ouro", w: 2, assets: ["XAUUSD"], re: /\bcentral banks? (buy|buying|purchases?|sell|selling)\b/i },
  // --- Solana / cripto ---
  { label: "Solana", w: 3, assets: ["SOLUSD"], re: /\b(solana|sol)\b/i },
  { label: "ecossistema Solana", w: 1, assets: ["SOLUSD"], re: /\b(firedancer|jupiter|phantom|pump\.fun|raydium|jito)\b/i },
  { label: "hack/exploit", w: 5, assets: ["SOLUSD"], re: /\b(hack(ed|s)?|exploit(ed|s)?|drained|stolen|breach(ed)?)\b/i },
  { label: "rede parada", w: 3, assets: ["SOLUSD"], re: /\b(outage|halted|downtime|network (stall|halt|down)|degraded performance)\b/i },
  { label: "ETF", w: 2, assets: ["SOLUSD"], re: /\betfs?\b/i },
  { label: "SEC/CFTC", w: 1, assets: ["SOLUSD"], re: /\b(sec|cftc)\b/i },
  { label: "liquidações/delisting", w: 2, assets: ["SOLUSD"], re: /\b(liquidat(ion|ions|ed)|delist(s|ing|ed)?)\b/i },
  { label: "exchange", w: 1, assets: ["SOLUSD"], re: /\b(binance|coinbase|kraken|tether|usdt|usdc)\b/i },
  { label: "cripto", w: 1, assets: ["SOLUSD"], re: /\b(bitcoin|btc|crypto|cryptocurrency)\b/i },
];

const URGENCY: { re: RegExp; w: number; label: string }[] = [
  { label: "última hora", w: 3, re: /\b(breaking|urgent|flash|just in)\b/i },
  { label: "movimento forte", w: 2, re: /\b(surges?|plunges?|plummets?|crash(es|ed)?|soars?|tumbles?|spikes?|collapses?|record high|all-time high|skyrockets?|nosedives?)\b/i },
  { label: "surpresa", w: 2, re: /\b(unexpected(ly)?|surprise[sd]?|shock)\b/i },
  { label: "decisão oficial", w: 2, re: /\b(approv(es|ed|al)|rejects?|rejected|denie[sd]|charges|charged|sues|lawsuit|bans?|banned)\b/i },
];

const NOISE: RegExp[] = [
  /\bprice (analysis|prediction|forecast|outlook)\b/i,
  /\b(predictions?|could|might|may)\b/i,
  /\bhere'?s (why|what|how)\b/i,
  /\bwhat to (know|expect|watch)\b/i,
  /\b(how to|opinion|weekly|recap|podcast|newsletter|explained|guide|sponsored|preview|week ahead|morning kickstart)\b/i,
];

export interface NewsScore {
  asset: NewsAsset;
  score: number;
  level: "warning" | "critical" | null;
  reasons: string[];
}

export interface ClassifyOpts {
  boost?: number;
  official?: boolean;
  minScore?: number;
  criticalScore?: number;
}

export function classifyHeadline(title: string, opts: ClassifyOpts = {}): NewsScore[] {
  const minScore = opts.minScore ?? 5;
  const criticalScore = opts.criticalScore ?? 8;
  const text = title.replace(/[’‘]/g, "'");

  const urg = URGENCY.filter((u) => u.re.test(text));
  const urgW = urg.reduce((a, u) => a + u.w, 0);
  let noise = NOISE.filter((n) => n.test(text)).length * -3;
  if (text.trim().endsWith("?")) noise -= 2;

  const out: NewsScore[] = [];
  for (const asset of ["XAUUSD", "SOLUSD"] as NewsAsset[]) {
    // Num feed oficial (Fed), o nome da própria instituição não é notícia: precisa de um tema real.
    const hits = ANCHORS.filter(
      (r) => r.assets.includes(asset) && r.re.test(text) && !(opts.official && r.label === "Fed/Powell")
    );
    if (!hits.length) continue;
    let score = hits.reduce((a, r) => a + r.w, 0) + urgW + noise;
    // Fonte oficial (Fed, SEC) só soma quando o tema já é relevante para o activo.
    score += opts.boost ?? 0;
    if (opts.official && hits.some((h) => h.label === "decisão de juros" || h.label === "reunião de emergência")) score += 2;
    const level = score >= criticalScore ? "critical" : score >= minScore ? "warning" : null;
    out.push({ asset, score, level, reasons: [...hits.map((h) => h.label), ...urg.map((u) => u.label)] });
  }
  return out;
}
