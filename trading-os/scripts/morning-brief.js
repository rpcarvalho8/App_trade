#!/usr/bin/env node
/**
 * Morning Brief — resumo matinal macro/mercados para trading.
 *
 * Recolhe dados GRATUITOS (sem chave de API, exceto Gemini):
 *   - Calendário económico (ForexFactory JSON semanal)
 *   - FX: EUR/USD, GBP/USD (Frankfurter)
 *   - Ouro: XAU/USD (gold-api.com)
 *   - Cripto: BTC, ETH, SOL + variação 24h (CoinGecko)
 *   - Yields do Tesouro EUA: curva completa incl. 2Y/10Y (Treasury.gov CSV)
 *
 * Envia tudo à Gemini, que FILTRA e escreve a síntese + impacto por ativo
 * na estrutura pedida, e guarda um ficheiro Markdown datado em:
 *   reports/morning-brief/brief_YYYY-MM-DD.md
 *
 * Uso (a partir da pasta 'trading-os/'):
 *   node scripts/morning-brief.js              -> gera o brief agora
 *   node scripts/morning-brief.js --schedule   -> fica ativo e corre todos os dias às 06:00
 *
 * Ou via npm:
 *   npm run brief
 *   npm run brief:schedule
 *
 * Requer GEMINI_API_KEY em .env.local (mesma chave do AI Coach).
 */
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "reports", "morning-brief");
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const ASSETS = ["XAUUSD", "EURUSD", "GBPUSD", "BTCUSD", "ETHUSD", "SOLUSD"];
const UA = "Mozilla/5.0 (compatible; TradingOS-MorningBrief/1.0)";

// ---------- helpers ----------
function loadEnvLocal() {
  // Carrega .env.local sem dependências (dotenv não é garantido em runtime standalone).
  const p = path.join(ROOT, ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

async function getJSON(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(opts.timeout || 20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  return res.json();
}

async function getText(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(opts.timeout || 25000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  return res.text();
}

// tolerante a falhas: nunca deixa uma fonte partir o resumo todo
async function safe(label, fn) {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (e) {
    console.warn(`[MorningBrief] fonte '${label}' falhou: ${e?.message || e}`);
    return { ok: false, error: String(e?.message || e) };
  }
}

function todayISO(tz = "Europe/Lisbon") {
  // Data local (hora de Portugal por defeito).
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // YYYY-MM-DD
}

// ---------- fontes de dados ----------
async function fetchCalendar(today) {
  const data = await getJSON("https://nfs.faireconomy.media/ff_calendar_thisweek.json");
  const events = (Array.isArray(data) ? data : []).map((e) => ({
    title: e.title,
    country: e.country,
    impact: e.impact, // High | Medium | Low | Holiday
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
  const round = (n) => (typeof n === "number" ? Math.round(n * 100) / 100 : null);
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
  const last = lines[1].split(",").map((v) => v.replace(/"/g, "").trim()); // linha 2 = data mais recente
  const prev = lines[2] ? lines[2].split(",").map((v) => v.replace(/"/g, "").trim()) : null;
  const idx = (name) => header.indexOf(name);
  const pick = (row, name) => (row && idx(name) >= 0 ? parseFloat(row[idx(name)]) : null);
  return {
    date: last[0],
    y2: pick(last, "2 Yr"),
    y10: pick(last, "10 Yr"),
    y30: pick(last, "30 Yr"),
    y10_prev: prev ? pick(prev, "10 Yr") : null,
    y2_prev: prev ? pick(prev, "2 Yr") : null,
    spread_2s10s: pick(last, "10 Yr") != null && pick(last, "2 Yr") != null
      ? Math.round((pick(last, "10 Yr") - pick(last, "2 Yr")) * 100) / 100
      : null,
  };
}

// ---------- Gemini ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGemini(prompt, attempt = 1) {
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
        // Devolvemos texto puro com delimitadores (Markdown é frágil em JSON).
        // Desativa o "thinking" para todos os tokens irem para a resposta final.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Retry com backoff em erros transitórios (sobrecarga / rate limit).
    if ((res.status === 503 || res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
      const wait = 3000 * attempt;
      console.warn(`[MorningBrief] Gemini ${res.status}; retry ${attempt}/${MAX_ATTEMPTS - 1} em ${wait / 1000}s...`);
      await sleep(wait);
      return callGemini(prompt, attempt + 1);
    }
    throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = await res.json();
  const cand = json?.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text).filter(Boolean).join("");
  if (!text) {
    const reason = cand?.finishReason || json?.promptFeedback?.blockReason || "vazio";
    throw new Error(`Gemini sem resposta (${reason})`);
  }
  return text;
}

// Extrai uma secção delimitada por marcadores <<<NOME>>> ... <<<FIM>>>
function extractSection(text, name) {
  const re = new RegExp(`<<<${name}>>>([\\s\\S]*?)<<<FIM>>>`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

function buildPrompt(today, data) {
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

function assembleMarkdown(today, brief, data) {
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

const fmt = (v) => (v === null || v === undefined || Number.isNaN(v) ? "n/d" : String(v));
const pct = (v) =>
  v === null || v === undefined || Number.isNaN(v)
    ? "n/d"
    : `${v > 0 ? "+" : ""}${v}%`;

// ---------- orquestração ----------
async function generate() {
  loadEnvLocal();
  const today = todayISO();
  console.log(`[MorningBrief] a recolher dados para ${today}...`);

  const [cal, fx, gold, crypto, yields] = await Promise.all([
    safe("calendario", () => fetchCalendar(today)),
    safe("fx", fetchFX),
    safe("gold", fetchGold),
    safe("crypto", fetchCrypto),
    safe("yields", fetchYields),
  ]);

  const data = {
    date: today,
    calendar: cal.ok ? cal.value : { error: cal.error },
    fx: fx.ok ? fx.value : { error: fx.error },
    gold: gold.ok ? gold.value : { error: gold.error },
    crypto: crypto.ok ? crypto.value : { error: crypto.error },
    yields: yields.ok ? yields.value : { error: yields.error },
  };

  console.log("[MorningBrief] a pedir análise à Gemini...");
  const raw = await callGemini(buildPrompt(today, data));
  const brief = {
    calendario_md: extractSection(raw, "CALENDARIO"),
    macro_md: extractSection(raw, "MACRO"),
    ativos_md: extractSection(raw, "ATIVOS"),
  };
  // Fallback: se os delimitadores falharem, usa o texto integral no macro.
  if (!brief.calendario_md && !brief.macro_md && !brief.ativos_md) {
    brief.macro_md = raw.trim();
  }

  const md = assembleMarkdown(today, brief, data);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `brief_${today}.md`);
  fs.writeFileSync(out, md, "utf8");
  console.log(`[MorningBrief] OK -> ${path.relative(ROOT, out)}`);
  return out;
}

async function schedule() {
  loadEnvLocal();
  let cron;
  try {
    cron = require("node-cron");
  } catch {
    console.error("[MorningBrief] node-cron não instalado. Corre: npm install");
    process.exit(1);
  }
  // "0 6 * * *" = 06:00 todos os dias (hora do sistema).
  cron.schedule("0 6 * * *", () => {
    generate().catch((e) => console.error("[MorningBrief] falhou:", e?.message || e));
  });
  console.log("[MorningBrief] agendado: todos os dias às 06:00. A aguardar (Ctrl+C para sair)...");
  // Catch-up: gera já um no arranque se ainda não existir o de hoje.
  const todayFile = path.join(OUT_DIR, `brief_${todayISO()}.md`);
  if (!fs.existsSync(todayFile)) {
    generate().catch((e) => console.error("[MorningBrief] catch-up falhou:", e?.message || e));
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--schedule")) return schedule();
  generate()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("[MorningBrief] ERRO:", e?.message || e);
      process.exit(1);
    });
}

main();
