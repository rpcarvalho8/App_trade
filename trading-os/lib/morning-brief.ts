/**
 * Morning Brief (versão integrada na app) — lógica partilhada.
 *
 * Usada por:
 *   - instrumentation.ts (cron 06:00 + catch-up no arranque)
 *   - app/api/morning-brief/route.ts (catch-up on-demand ao abrir a página)
 *
 * Recolhe dados GRATUITOS (sem chave, exceto Gemini), envia à Gemini que
 * filtra e escreve a síntese, e guarda um Markdown datado em:
 *   reports/morning-brief/brief_YYYY-MM-DD.md
 *
 * O script CLI standalone `scripts/morning-brief.js` mantém-se para uso manual.
 */
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
export const OUT_DIR = path.join(ROOT, "reports", "morning-brief");
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const UA = "Mozilla/5.0 (compatible; TradingOS-MorningBrief/1.0)";

export const ASSETS = ["XAUUSD", "EURUSD", "GBPUSD", "BTCUSD", "ETHUSD", "SOLUSD"] as const;

// ---------- helpers ----------
async function getJSON(url: string, timeout = 20000): Promise<any> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  return res.json();
}

async function getText(url: string, timeout = 25000): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  return res.text();
}

async function safe<T>(label: string, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e: any) {
    console.warn(`[MorningBrief] fonte '${label}' falhou: ${e?.message || e}`);
    return { ok: false, error: String(e?.message || e) };
  }
}

export function todayISO(tz = "Europe/Lisbon"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// ---------- fontes de dados ----------
export interface CalEvent {
  title: string;
  country: string;
  impact: string;
  date: string;
  forecast: string;
  previous: string;
  day: string;
}

export async function fetchCalendar(today: string) {
  const data = await getJSON("https://nfs.faireconomy.media/ff_calendar_thisweek.json");
  const events: CalEvent[] = (Array.isArray(data) ? data : []).map((e: any) => ({
    title: e.title,
    country: e.country,
    impact: e.impact,
    date: e.date,
    forecast: e.forecast || "",
    previous: e.previous || "",
    day: (e.date || "").slice(0, 10),
  }));
  const todays = events.filter((e) => e.day === today);
  return {
    today: todays,
    todayHighImpact: todays.filter((e) => e.impact === "High"),
    weekHighImpact: events.filter((e) => e.impact === "High"),
  };
}

async function fetchFX() {
  const [eur, gbp] = await Promise.all([
    getJSON("https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD"),
    getJSON("https://api.frankfurter.dev/v1/latest?base=GBP&symbols=USD"),
  ]);
  return {
    EURUSD: eur?.rates?.USD ?? null,
    GBPUSD: gbp?.rates?.USD ?? null,
    asOf: eur?.date || gbp?.date || null,
  };
}

async function fetchGold() {
  const g = await getJSON("https://api.gold-api.com/price/XAU");
  const price = typeof g?.price === "number" ? Math.round(g.price * 100) / 100 : null;
  return { XAUUSD: price, updatedAt: g?.updatedAt ?? null };
}

async function fetchCrypto() {
  const c = await getJSON(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true"
  );
  const round = (n: any) => (typeof n === "number" ? Math.round(n * 100) / 100 : null);
  return {
    BTCUSD: { price: c?.bitcoin?.usd ?? null, change24h: round(c?.bitcoin?.usd_24h_change) },
    ETHUSD: { price: c?.ethereum?.usd ?? null, change24h: round(c?.ethereum?.usd_24h_change) },
    SOLUSD: { price: c?.solana?.usd ?? null, change24h: round(c?.solana?.usd_24h_change) },
  };
}

async function fetchYields() {
  const csv = await getText(
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve&field_tdr_date_value=2026&page&_format=csv"
  );
  const lines = csv.trim().split("\n");
  const header = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
  const last = lines[1].split(",").map((v) => v.replace(/"/g, "").trim());
  const prev = lines[2] ? lines[2].split(",").map((v) => v.replace(/"/g, "").trim()) : null;
  const idx = (name: string) => header.indexOf(name);
  const pick = (row: string[] | null, name: string) => (row && idx(name) >= 0 ? parseFloat(row[idx(name)]) : null);
  const y2 = pick(last, "2 Yr");
  const y10 = pick(last, "10 Yr");
  return {
    date: last[0],
    y2,
    y10,
    y30: pick(last, "30 Yr"),
    y10_prev: prev ? pick(prev, "10 Yr") : null,
    y2_prev: prev ? pick(prev, "2 Yr") : null,
    spread_2s10s: y10 != null && y2 != null ? Math.round((y10 - y2) * 100) / 100 : null,
  };
}

// ---------- Gemini ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callGemini(prompt: string, attempt = 1): Promise<string> {
  const MAX_ATTEMPTS = 5;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY em falta no .env.local");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if ((res.status === 503 || res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
      const wait = 3000 * attempt;
      console.warn(`[MorningBrief] Gemini ${res.status}; retry ${attempt}/${MAX_ATTEMPTS - 1} em ${wait / 1000}s...`);
      await sleep(wait);
      return callGemini(prompt, attempt + 1);
    }
    throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 400)}`);
  }
  const json: any = await res.json();
  const cand = json?.candidates?.[0];
  const text: string | undefined = cand?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("");
  if (!text) {
    const reason = cand?.finishReason || json?.promptFeedback?.blockReason || "vazio";
    throw new Error(`Gemini sem resposta (${reason})`);
  }
  return text;
}

function extractSection(text: string, name: string): string {
  const re = new RegExp(`<<<${name}>>>([\\s\\S]*?)<<<FIM>>>`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

function buildPrompt(today: string, data: any): string {
  return `És um Analista de Macroeconomia e Especialista em Mercados Financeiros Sénior.
Gera um RESUMO MATINAL para trading dos ativos: Ouro (XAUUSD), EURUSD, GBPUSD, BTCUSD, ETHUSD, SOLUSD.

DATA DE HOJE: ${today} (dados até 06:00, hora de Portugal).

Usa EXCLUSIVAMENTE os dados fornecidos abaixo. NÃO inventes números. Se um dado estiver em falta (null/erro), escreve "n/d" e não especules valores.

=== DADOS RECOLHIDOS (JSON) ===
${JSON.stringify(data, null, 2)}
=== FIM DOS DADOS ===

REGRAS DE ESTILO:
- Português (PT). Profissional, extremamente conciso, técnico, objetivo. Frases curtas.
- Sem introduções cordiais nem conclusões genéricas. Sem opinião não fundamentada nos dados.
- No calendário, lista APENAS eventos de ALTO IMPACTO (impact "High"). Se não houver nenhum relevante para os ativos monitorizados, escreve explicitamente: "Sem catalisadores macroeconómicos de alto impacto programados para hoje".
- Para yields/dólar: usa y2, y10 e a variação vs. dia anterior. Não há valor de DXY nos dados — infere a direção do dólar a partir dos movimentos FX e yields, sem inventar um número de DXY.
- Para cripto: usa preços e variação 24h; comenta fluxos de ETFs apenas de forma qualitativa (não há números de fluxos nos dados).

FORMATO DE SAÍDA — devolve TEXTO PURO (não JSON) com exatamente três secções delimitadas. Escreve Markdown dentro de cada secção, SEM repetir os títulos numerados (eu adiciono-os):

<<<CALENDARIO>>>
Tabela ou lista Markdown dos eventos de ALTO IMPACTO de hoje no formato: Hora | Moeda | Indicador | Projeção vs. Anterior. Se não houver, escreve apenas: Sem catalisadores macroeconómicos de alto impacto programados para hoje.
<<<FIM>>>

<<<MACRO>>>
- **Estados Unidos (USD):** ...
- **Zona Euro (EUR) & Reino Unido (GBP):** ...
- **Sentimento de Risco & Liquidez Global:** ...
<<<FIM>>>

<<<ATIVOS>>>
- **Ouro (XAUUSD):** ...
- **EURUSD & GBPUSD:** ...
- **Cripto (BTC, ETH, SOL):** ...
<<<FIM>>>

Não escrevas nada fora destes três blocos.`;
}

const fmt = (v: any) => (v === null || v === undefined || Number.isNaN(v) ? "n/d" : String(v));
const pct = (v: any) => (v === null || v === undefined || Number.isNaN(v) ? "n/d" : `${v > 0 ? "+" : ""}${v}%`);

function assembleMarkdown(today: string, brief: { calendario_md: string; macro_md: string; ativos_md: string }, data: any): string {
  const fxAsOf = data?.fx?.asOf || "n/d";
  const yDate = data?.yields?.date || "n/d";
  return `# 🌅 Morning Brief — ${today}

> Ativos: XAUUSD · EURUSD · GBPUSD · BTCUSD · ETHUSD · SOLUSD
> Gerado automaticamente às 06:00 (hora de Portugal). Análise por Gemini (${MODEL}).

## 📅 1. CALENDÁRIO ECONÓMICO DO DIA

${brief.calendario_md || "_n/d_"}

## 🌍 2. SÍNTESE MACROECONÓMICA (ÚLTIMAS 24H)

${brief.macro_md || "_n/d_"}

## 📈 3. IMPACTO POTENCIAL POR ATIVO

${brief.ativos_md || "_n/d_"}

---

### 📊 Snapshot de dados (fontes gratuitas)

| Ativo/Métrica | Valor | Nota |
|---|---|---|
| XAU/USD | ${fmt(data?.gold?.XAUUSD)} | ouro spot |
| EUR/USD | ${fmt(data?.fx?.EURUSD)} | FX @ ${fxAsOf} |
| GBP/USD | ${fmt(data?.fx?.GBPUSD)} | FX @ ${fxAsOf} |
| BTC/USD | ${fmt(data?.crypto?.BTCUSD?.price)} | 24h ${pct(data?.crypto?.BTCUSD?.change24h)} |
| ETH/USD | ${fmt(data?.crypto?.ETHUSD?.price)} | 24h ${pct(data?.crypto?.ETHUSD?.change24h)} |
| SOL/USD | ${fmt(data?.crypto?.SOLUSD?.price)} | 24h ${pct(data?.crypto?.SOLUSD?.change24h)} |
| UST 2Y | ${fmt(data?.yields?.y2)}% | @ ${yDate} |
| UST 10Y | ${fmt(data?.yields?.y10)}% | @ ${yDate} |
| Spread 2s10s | ${fmt(data?.yields?.spread_2s10s)} pp | curva |

_Fontes: ForexFactory (calendário), Frankfurter (FX), gold-api (ouro), CoinGecko (cripto), U.S. Treasury (yields). DXY não incluído (sem fonte gratuita fiável) — direção do dólar inferida de FX/yields._
`;
}

// ---------- orquestração ----------
export function briefPath(date = todayISO()): string {
  return path.join(OUT_DIR, `brief_${date}.md`);
}

export function briefExists(date = todayISO()): boolean {
  return fs.existsSync(briefPath(date));
}

export function readBrief(date = todayISO()): string | null {
  const p = briefPath(date);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

/** Gera o brief do dia (força regeneração) e guarda o Markdown. Devolve o caminho. */
export async function generateBrief(date = todayISO()): Promise<string> {
  console.log(`[MorningBrief] a recolher dados para ${date}...`);
  const [cal, fx, gold, crypto, yields] = await Promise.all([
    safe("calendario", () => fetchCalendar(date)),
    safe("fx", fetchFX),
    safe("gold", fetchGold),
    safe("crypto", fetchCrypto),
    safe("yields", fetchYields),
  ]);

  const data = {
    date,
    calendar: cal.ok ? cal.value : { error: cal.error },
    fx: fx.ok ? fx.value : { error: fx.error },
    gold: gold.ok ? gold.value : { error: gold.error },
    crypto: crypto.ok ? crypto.value : { error: crypto.error },
    yields: yields.ok ? yields.value : { error: yields.error },
  };

  console.log("[MorningBrief] a pedir análise à Gemini...");
  const raw = await callGemini(buildPrompt(date, data));
  const brief = {
    calendario_md: extractSection(raw, "CALENDARIO"),
    macro_md: extractSection(raw, "MACRO"),
    ativos_md: extractSection(raw, "ATIVOS"),
  };
  if (!brief.calendario_md && !brief.macro_md && !brief.ativos_md) {
    brief.macro_md = raw.trim();
  }

  const md = assembleMarkdown(date, brief, data);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = briefPath(date);
  fs.writeFileSync(out, md, "utf8");
  console.log(`[MorningBrief] OK -> ${path.relative(ROOT, out)}`);
  return out;
}

/**
 * Garante que existe o brief de hoje. Se já existir, não faz nada (estático).
 * Se não existir (app ligada a meio do dia / arranque), gera-o uma única vez.
 */
export async function ensureTodayBrief(): Promise<{ generated: boolean; date: string; markdown: string | null }> {
  const date = todayISO();
  if (briefExists(date)) {
    return { generated: false, date, markdown: readBrief(date) };
  }
  await generateBrief(date);
  return { generated: true, date, markdown: readBrief(date) };
}
