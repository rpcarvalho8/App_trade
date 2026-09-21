/**
 * Cliente de mercado XAUUSD — OHLC reais via Twelve Data (fonte PRIMÁRIA).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * XTB xAPI DESCONTINUADA (14 mar 2025): ws.xtb.com / xapi.xtb.com foram
 * desligados pela XTB sem substituto oficial. Qualquer tentativa de login
 * WebSocket falha independentemente das credenciais. O código xAPI antigo
 * está em `xtb-xapi.dead.ts` só como referência histórica — NÃO é chamado.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Env (.env.local):
 *   TWELVE_DATA_API_KEY=...   ← obrigatório para XAUUSD
 *
 * Fluxo (inalterado em conceito):
 *   1. Carrega cache SQLite (candle_cache)
 *   2. Backfill time_series H4 / M15 / M5
 *   3. Warm-up completo → motor pode avaliar
 *   4. Poll periódico rate-limit-aware (plano Basic free)
 *
 * Plano Basic free (twelvedata.com/pricing, confirmado):
 *   · 8 créditos API / minuto
 *   · 800 créditos / dia
 *   · time_series = 1 crédito por pedido
 *
 * Orçamento de polling (default):
 *   · M5  a cada 5 min  → ~288/dia
 *   · M15 a cada 15 min → ~96/dia
 *   · H4  a cada 60 min → ~24/dia
 *   · Backfill arranque  → 3 créditos
 *   · Total ≈ 411/dia  (< 800, margem ~50%)
 *
 * Nunca sintetiza mechas a partir de um preço spot.
 */
import { MultiTfBuffers } from "./candle-buffer";
import { fetchTwelveDataOhlc } from "./twelvedata-client";
import { loadCachedCandles, saveCandlesToCache, cacheStats } from "./candle-cache";
import type { Candle } from "@/lib/strategies/types";

export const XAU_TIMEFRAMES = ["H4", "M15", "M5"] as const;
export type XauSource = "twelvedata" | "cache" | "none";

export interface XtbTick {
  symbol: "XAUUSD";
  price: number;
  ts: number;
  source: XauSource;
  open?: number;
  high?: number;
  low?: number;
}

export type XtbTickHandler = (tick: XtbTick, closed: Record<string, boolean>) => void;

export type XauWarmUpStatus = "idle" | "warming_up" | "ready" | "error";

export interface XauMarketStatus {
  status: XauWarmUpStatus;
  source: XauSource;
  beta: boolean;
  symbol: string;
  bars: Record<string, number>;
  ready: boolean;
  message: string;
  disclaimer: string;
  lastError?: string;
  pollPlan?: string;
}

/** Mínimos para considerar backfill completo. */
const MIN_BARS: Record<string, number> = {
  H4: 80,
  M15: 200,
  M5: 100,
};

const LOOKBACK_MS: Record<string, number> = {
  H4: 30 * 24 * 60 * 60 * 1000,
  M15: 5 * 24 * 60 * 60 * 1000,
  M5: 1 * 24 * 60 * 60 * 1000,
};

/** Intervalos de refresh (ms) — cabem no Basic 800/dia. Override via env. */
const DEFAULT_POLL_MS: Record<string, number> = {
  M5: Number(process.env.XAU_POLL_M5_MS || 5 * 60_000),
  M15: Number(process.env.XAU_POLL_M15_MS || 15 * 60_000),
  H4: Number(process.env.XAU_POLL_H4_MS || 60 * 60_000),
};

const DISCLAIMER =
  "Preço/OHLC via agregador Twelve Data (XAU/USD), não diretamente da corretora XTB — " +
  "pode haver divergência de spread/cotação face ao xStation. Entrada continua manual.";

interface XauState {
  started: boolean;
  buffers: MultiTfBuffers;
  handlers: Set<XtbTickHandler>;
  status: XauWarmUpStatus;
  source: XauSource;
  lastPrice: number | null;
  lastError?: string;
  timers: NodeJS.Timeout[];
}

function state(): XauState {
  const g = globalThis as any;
  if (!g.__tosXauClientV3) {
    g.__tosXauClientV3 = {
      started: false,
      buffers: new MultiTfBuffers("XAUUSD", [...XAU_TIMEFRAMES], 2000),
      handlers: new Set(),
      status: "idle",
      source: "none",
      lastPrice: null,
      timers: [],
    } as XauState;
  }
  return g.__tosXauClientV3 as XauState;
}

function hasTwelveData(): boolean {
  return !!process.env.TWELVE_DATA_API_KEY;
}

function seedBuffer(tf: string, candles: Candle[]): void {
  const buf = state().buffers.get(tf);
  if (!buf) return;
  buf.seed(candles);
}

function emitFromLast(source: XauSource): void {
  const s = state();
  const m5 = s.buffers.get("M5")?.last();
  const price = m5?.close ?? s.lastPrice;
  if (price == null) return;
  s.lastPrice = price;
  const tick: XtbTick = {
    symbol: "XAUUSD",
    price,
    ts: Date.now(),
    source,
    open: m5?.open,
    high: m5?.high,
    low: m5?.low,
  };
  for (const h of s.handlers) {
    try {
      h(tick, {});
    } catch (e: any) {
      console.warn("[xtb-client] handler:", e?.message || e);
    }
  }
}

function barsSnapshot(): Record<string, number> {
  const s = state();
  const out: Record<string, number> = {};
  for (const tf of XAU_TIMEFRAMES) out[tf] = s.buffers.get(tf)?.length || 0;
  return out;
}

function warmUpComplete(): boolean {
  const bars = barsSnapshot();
  return XAU_TIMEFRAMES.every((tf) => (bars[tf] || 0) >= MIN_BARS[tf]);
}

function markReady(source: XauSource, msg: string): void {
  const s = state();
  s.source = source;
  s.status = warmUpComplete() ? "ready" : "warming_up";
  if (s.status === "ready") {
    console.log(`[xtb-client] READY via ${source} — ${msg}`, barsSnapshot());
  } else {
    console.warn(`[xtb-client] still warming_up via ${source}:`, barsSnapshot(), MIN_BARS);
  }
}

function pollPlanSummary(): string {
  const m5 = DEFAULT_POLL_MS.M5 / 60_000;
  const m15 = DEFAULT_POLL_MS.M15 / 60_000;
  const h4 = DEFAULT_POLL_MS.H4 / 60_000;
  const perDay =
    Math.ceil((24 * 60) / m5) + Math.ceil((24 * 60) / m15) + Math.ceil((24 * 60) / h4) + 3;
  return `M5/${m5}min · M15/${m15}min · H4/${h4}min ≈ ${perDay} créditos/dia (Basic free ≤800)`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function refreshTf(tf: string, outputsize: number): Promise<void> {
  const s = state();
  const candles = await fetchTwelveDataOhlc(tf, outputsize);
  if (!candles.length) return;
  const buf = s.buffers.get(tf)!;
  const merged = new Map<number, Candle>();
  for (const e of buf.candles) merged.set(e.time, e);
  for (const c of candles) merged.set(c.time, c);
  buf.seed([...merged.values()]);
  await saveCandlesToCache("XAUUSD", tf, candles.slice(-20), "twelvedata");
}

async function backfillViaTwelveData(): Promise<boolean> {
  const sizes: Record<string, number> = { H4: 250, M15: 500, M5: 400 };
  // Espaça pedidos para respeitar 8 créditos/min no Basic
  for (const tf of XAU_TIMEFRAMES) {
    const candles = await fetchTwelveDataOhlc(tf, sizes[tf]);
    seedBuffer(tf, candles);
    await saveCandlesToCache("XAUUSD", tf, candles, "twelvedata");
    console.log(`[xtb-client] TwelveData backfill ${tf}: ${candles.length} barras`);
    await sleep(8_000); // ≤8/min com margem
  }
  markReady("twelvedata", "fonte primária OHLC (agregador de mercado)");
  emitFromLast("twelvedata");

  const s = state();
  // Poll staggered por TF
  for (const tf of XAU_TIMEFRAMES) {
    const interval = DEFAULT_POLL_MS[tf];
    const t = setInterval(() => {
      refreshTf(tf, 30)
        .then(() => emitFromLast("twelvedata"))
        .catch((e: any) => console.warn(`[xtb-client] refresh ${tf}:`, e?.message || e));
    }, interval);
    s.timers.push(t);
  }
  console.log(`[xtb-client] poll plan: ${pollPlanSummary()}`);
  return warmUpComplete();
}

async function loadFromCache(): Promise<void> {
  for (const tf of XAU_TIMEFRAMES) {
    const since = Date.now() - LOOKBACK_MS[tf] * 1.2;
    const cached = await loadCachedCandles("XAUUSD", tf, since);
    if (cached.length) {
      seedBuffer(tf, cached);
      console.log(`[xtb-client] cache ${tf}: ${cached.length} barras`);
    }
  }
  if (warmUpComplete()) {
    state().source = "cache";
  }
}

/** Arranca o cliente XAU (idempotente). */
export function startXtbClient(): void {
  const s = state();
  if (s.started) return;
  s.started = true;
  s.status = "warming_up";

  console.log(
    "[xtb-client] XTB xAPI descontinuada (14 mar 2025) — fonte primária: Twelve Data. " +
      "Ver xtb-xapi.dead.ts para o código histórico."
  );

  (async () => {
    try {
      await loadFromCache();

      if (hasTwelveData()) {
        await backfillViaTwelveData();
        return;
      }

      if (warmUpComplete()) {
        markReady("cache", "apenas cache local (sem TWELVE_DATA_API_KEY)");
        emitFromLast("cache");
      } else {
        s.status = "error";
        s.lastError =
          "TWELVE_DATA_API_KEY em falta — obrigatória para XAUUSD (xAPI XTB descontinuada em mar/2025).";
        console.error("[xtb-client]", s.lastError);
      }
    } catch (e: any) {
      s.status = "error";
      s.lastError = e?.message || String(e);
      console.error("[xtb-client] arranque falhou:", s.lastError);
    }
  })();
}

export function stopXtbClient(): void {
  const s = state();
  for (const t of s.timers) clearInterval(t);
  s.timers = [];
  s.started = false;
  s.status = "idle";
}

export function getXauBuffers(): MultiTfBuffers {
  return state().buffers;
}

export function onXauTick(handler: XtbTickHandler): () => void {
  const s = state();
  s.handlers.add(handler);
  return () => s.handlers.delete(handler);
}

export function isXauReady(): boolean {
  return state().status === "ready" && warmUpComplete();
}

/**
 * XAUUSD permanece BETA/OBSERVAÇÃO: a cotação vem de um agregador (Twelve Data),
 * não do feed da corretora — possível divergência de spread vs xStation.
 */
export function getXauMarketStatus(): XauMarketStatus {
  const s = state();
  const bars = barsSnapshot();
  const ready = s.status === "ready" && warmUpComplete();
  const beta = true; // sempre beta enquanto a fonte ≠ corretora
  let message = "";
  if (s.status === "warming_up") message = "A carregar OHLC histórico (backfill Twelve Data)…";
  else if (s.status === "error") message = s.lastError || "Erro na fonte de dados XAU";
  else if (s.source === "twelvedata")
    message = "OHLC via Twelve Data (agregador) — não é o feed XTB/xStation";
  else if (s.source === "cache") message = "A usar só cache local — beta";
  else message = "Define TWELVE_DATA_API_KEY em .env.local";

  return {
    status: s.status,
    source: s.source,
    beta,
    symbol: "XAU/USD",
    bars,
    ready,
    message,
    disclaimer: DISCLAIMER,
    lastError: s.lastError,
    pollPlan: pollPlanSummary(),
  };
}

export async function getXauCacheStats() {
  return cacheStats("XAUUSD");
}

/** @deprecated */
export function seedSyntheticHistory(_price: number, _bars = 80): void {
  console.warn("[xtb-client] seedSyntheticHistory removido — use Twelve Data OHLC.");
}
