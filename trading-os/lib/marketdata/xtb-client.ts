/**
 * Cliente de mercado XAUUSD — OHLC reais via Twelve Data (fonte PRIMÁRIA).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * XTB xAPI DESCONTINUADA (14 mar 2025): ws.xtb.com / xapi.xtb.com foram
 * desligados pela XTB sem substituto oficial. Código histórico em
 * `xtb-xapi.dead.ts` — NÃO é chamado.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Env: TWELVE_DATA_API_KEY (obrigatória)
 *
 * Polling alinhado ao FECHO de vela (não mais curto que o TF):
 *   · M5  → no máximo a cada 5 min  (só se a barra M5 mudou)
 *   · M15 → no máximo a cada 15 min
 *   · H4  → no máximo a cada 4 h
 *
 * Orçamento créditos (Basic free ≤800/dia, 1 crédito = 1 time_series):
 *
 *   24h contínuo (gold quase 24/5):
 *     M5  288 + M15 96 + H4 6 + backfill 3 = ~393/dia  (~49% da quota)
 *
 *   Só sessões London/NY ~8h (se o processo só correr nesse período):
 *     M5   96 + M15 32 + H4 2 + backfill 3 = ~133/dia  (~17% da quota)
 *
 * Margem confortável em ambos os cenários — sem necessidade de polir mais.
 */
import { MultiTfBuffers, tfToMs, floorTime } from "./candle-buffer";
import { fetchTwelveDataOhlc, getTwelveDataCreditStats } from "./twelvedata-client";
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
  credits?: ReturnType<typeof getTwelveDataCreditStats>;
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

/**
 * Intervalo mínimo = duração da vela (nunca mais curto).
 * H4 = 4h (antes estava 60 min — pedíamos a mais).
 */
const CANDLE_MS: Record<string, number> = {
  M5: 5 * 60_000,
  M15: 15 * 60_000,
  H4: 4 * 60 * 60_000,
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
  /** Última barra (epoch floor) para a qual já pedimos dados, por TF. */
  lastFetchedBar: Record<string, number>;
  skippedPolls: number;
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
      lastFetchedBar: {},
      skippedPolls: 0,
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

/** Estimativa diária a 24h vs ~8h London/NY. */
export function estimateDailyCredits(): {
  continuous24h: number;
  session8h: number;
  breakdown24h: Record<string, number>;
  breakdown8h: Record<string, number>;
  note: string;
} {
  const m5 = Math.ceil((24 * 60) / 5);
  const m15 = Math.ceil((24 * 60) / 15);
  const h4 = Math.ceil((24 * 60) / 240);
  const backfill = 3;
  const m5_8 = Math.ceil((8 * 60) / 5);
  const m15_8 = Math.ceil((8 * 60) / 15);
  const h4_8 = Math.ceil((8 * 60) / 240);
  return {
    continuous24h: m5 + m15 + h4 + backfill,
    session8h: m5_8 + m15_8 + h4_8 + backfill,
    breakdown24h: { M5: m5, M15: m15, H4: h4, backfill },
    breakdown8h: { M5: m5_8, M15: m15_8, H4: h4_8, backfill },
    note: "1 crédito = 1 time_series; Basic free ≤800/dia",
  };
}

function pollPlanSummary(): string {
  const e = estimateDailyCredits();
  return (
    `fecho-alinhado M5/5m · M15/15m · H4/4h → ` +
    `~${e.continuous24h}/dia (24h) ou ~${e.session8h}/dia (8h London/NY) · Basic ≤800`
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Só pede se uma nova vela do TF pode ter aberto/fechado desde o último fetch.
 * Ex.: M5 só quando floor(now, 5m) > lastFetchedBar.
 */
function shouldFetchForNewCandle(tf: string, now = Date.now()): boolean {
  const s = state();
  const period = CANDLE_MS[tf] || tfToMs(tf);
  const currentBar = floorTime(now, period);
  const last = s.lastFetchedBar[tf];
  if (last != null && currentBar <= last) {
    s.skippedPolls++;
    return false;
  }
  return true;
}

async function refreshTf(tf: string, outputsize: number): Promise<boolean> {
  if (!shouldFetchForNewCandle(tf)) return false;
  const s = state();
  const candles = await fetchTwelveDataOhlc(tf, outputsize);
  if (!candles.length) return false;
  const buf = s.buffers.get(tf)!;
  const merged = new Map<number, Candle>();
  for (const e of buf.candles) merged.set(e.time, e);
  for (const c of candles) merged.set(c.time, c);
  buf.seed([...merged.values()]);
  await saveCandlesToCache("XAUUSD", tf, candles.slice(-20), "twelvedata");
  const period = CANDLE_MS[tf] || tfToMs(tf);
  s.lastFetchedBar[tf] = floorTime(Date.now(), period);
  return true;
}

async function backfillViaTwelveData(): Promise<boolean> {
  const sizes: Record<string, number> = { H4: 250, M15: 500, M5: 400 };
  const s = state();
  for (const tf of XAU_TIMEFRAMES) {
    const candles = await fetchTwelveDataOhlc(tf, sizes[tf]);
    seedBuffer(tf, candles);
    await saveCandlesToCache("XAUUSD", tf, candles, "twelvedata");
    const period = CANDLE_MS[tf];
    s.lastFetchedBar[tf] = floorTime(Date.now(), period);
    console.log(`[xtb-client] TwelveData backfill ${tf}: ${candles.length} barras`);
    await sleep(8_000); // ≤8/min
  }
  markReady("twelvedata", "fonte primária OHLC (agregador de mercado)");
  emitFromLast("twelvedata");

  // Tick a cada 60s: cada TF só dispara pedido se a barra mudou (gate acima).
  const tick = setInterval(() => {
    (async () => {
      let any = false;
      for (const tf of XAU_TIMEFRAMES) {
        try {
          if (await refreshTf(tf, 30)) any = true;
        } catch (e: any) {
          console.warn(`[xtb-client] refresh ${tf}:`, e?.message || e);
        }
      }
      if (any) emitFromLast("twelvedata");
    })().catch(() => {});
  }, 60_000);
  s.timers.push(tick);

  const est = estimateDailyCredits();
  console.log(
    `[xtb-client] poll plan: ${pollPlanSummary()} | créditos agora:`,
    getTwelveDataCreditStats()
  );
  console.log(
    `[xtb-client] orçamento: 24h≈${est.continuous24h} · 8h≈${est.session8h} · breakdown24h=`,
    est.breakdown24h
  );
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

export function getXauMarketStatus(): XauMarketStatus {
  const s = state();
  const bars = barsSnapshot();
  const ready = s.status === "ready" && warmUpComplete();
  const beta = true;
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
    credits: getTwelveDataCreditStats(),
  };
}

export async function getXauCacheStats() {
  return cacheStats("XAUUSD");
}

/** @deprecated */
export function seedSyntheticHistory(_price: number, _bars = 80): void {
  console.warn("[xtb-client] seedSyntheticHistory removido — use Twelve Data OHLC.");
}
