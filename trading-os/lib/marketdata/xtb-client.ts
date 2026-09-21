/**
 * Cliente XAUUSD via XTB xAPI (WebSocket) — OHLC reais.
 *
 * Docs: http://developers.xstore.pro/documentation/
 * Endpoints: wss://ws.xtb.com/{demo|real} + {demo|real}Stream
 *
 * Env (.env.local):
 *   XTB_LOGIN, XTB_PASSWORD, XTB_ACCOUNT_TYPE=demo|real
 *   XTB_SYMBOL=GOLD          (símbolo xStation; default GOLD)
 *   TWELVE_DATA_API_KEY=...  (fallback OHLC se xAPI falhar / sem creds)
 *
 * Fluxo:
 *   1. Carrega cache SQLite (candle_cache)
 *   2. Backfill getChartLastRequest H4 (~30d) / M15 (~5d) / M5 (~1d)
 *      ou TwelveData time_series se xAPI indisponível
 *   3. Só depois marca warm-up completo → motor pode avaliar
 *   4. Stream getCandles (M1) + refresh periódico dos TFs superiores
 *
 * Nunca sintetiza mechas a partir de um preço spot.
 */
import { MultiTfBuffers } from "./candle-buffer";
import { upsertCandle, aggregateCandles } from "./ohlc-utils";
import { rateInfosToCandles, streamCandleToCandle, type XtbRateInfoRecord } from "./xtb-chart";
import { fetchTwelveDataOhlc } from "./twelvedata-client";
import { loadCachedCandles, saveCandlesToCache, cacheStats } from "./candle-cache";
import type { Candle } from "@/lib/strategies/types";

export const XAU_TIMEFRAMES = ["H4", "M15", "M5"] as const;
export type XauSource = "xtb-xapi" | "twelvedata" | "cache" | "none";

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
  lastError?: string;
}

const PERIOD: Record<string, number> = { M1: 1, M5: 5, M15: 15, H4: 240 };

/** Mínimos para considerar backfill completo (após cache + fetch). */
const MIN_BARS: Record<string, number> = {
  H4: 80, // ~30 dias úteis de H4
  M15: 200, // ~5 dias
  M5: 100, // ~1 dia
};

const LOOKBACK_MS: Record<string, number> = {
  H4: 30 * 24 * 60 * 60 * 1000,
  M15: 5 * 24 * 60 * 60 * 1000,
  M5: 1 * 24 * 60 * 60 * 1000,
};

interface XtbState {
  started: boolean;
  buffers: MultiTfBuffers;
  m1: Candle[];
  handlers: Set<XtbTickHandler>;
  status: XauWarmUpStatus;
  source: XauSource;
  lastPrice: number | null;
  lastError?: string;
  streamSessionId?: string;
  mainWs: any;
  streamWs: any;
  refreshTimer: NodeJS.Timeout | null;
  pingTimer: NodeJS.Timeout | null;
  pending: Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>;
  reqId: number;
  xtbSymbol: string;
}

function state(): XtbState {
  const g = globalThis as any;
  if (!g.__tosXtbClientV2) {
    g.__tosXtbClientV2 = {
      started: false,
      buffers: new MultiTfBuffers("XAUUSD", [...XAU_TIMEFRAMES], 2000),
      m1: [],
      handlers: new Set(),
      status: "idle",
      source: "none",
      lastPrice: null,
      mainWs: null,
      streamWs: null,
      refreshTimer: null,
      pingTimer: null,
      pending: new Map(),
      reqId: 1,
      xtbSymbol: process.env.XTB_SYMBOL || "GOLD",
    } as XtbState;
  }
  return g.__tosXtbClientV2 as XtbState;
}

function accountType(): "demo" | "real" {
  const t = (process.env.XTB_ACCOUNT_TYPE || "demo").toLowerCase();
  return t === "real" ? "real" : "demo";
}

function hasXtbCreds(): boolean {
  return !!(process.env.XTB_LOGIN && process.env.XTB_PASSWORD);
}

function hasTwelveData(): boolean {
  return !!process.env.TWELVE_DATA_API_KEY;
}

function seedBuffer(tf: string, candles: Candle[]): void {
  const s = state();
  const buf = s.buffers.get(tf);
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

// ---------- xAPI WebSocket helpers ----------

function sendCommand(ws: any, command: string, arguments_?: Record<string, unknown>): Promise<any> {
  const s = state();
  const customTag = `tos-${s.reqId++}`;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      s.pending.delete(customTag);
      reject(new Error(`xAPI timeout: ${command}`));
    }, 25_000);
    s.pending.set(customTag, {
      resolve: (v) => {
        clearTimeout(t);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(t);
        reject(e);
      },
    });
    const payload: any = { command, customTag };
    if (arguments_) payload.arguments = arguments_;
    ws.send(JSON.stringify(payload));
  });
}

async function xtbLogin(WebSocketCtor: any): Promise<{ main: any; streamSessionId: string }> {
  const type = accountType();
  const url = `wss://ws.xtb.com/${type}`;
  const main = new WebSocketCtor(url);

  await new Promise<void>((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("WS main connect timeout")), 15_000);
    main.on("open", () => {
      clearTimeout(to);
      resolve();
    });
    main.on("error", (e: any) => {
      clearTimeout(to);
      reject(e);
    });
  });

  main.on("message", (raw: Buffer | string) => {
    try {
      const msg = JSON.parse(String(raw));
      const tag = msg.customTag;
      if (tag && state().pending.has(tag)) {
        const p = state().pending.get(tag)!;
        state().pending.delete(tag);
        if (msg.status === false) {
          p.reject(new Error(msg.errorDescr || msg.errorCode || "xAPI error"));
        } else {
          p.resolve(msg);
        }
      }
    } catch {}
  });

  const login = await sendCommand(main, "login", {
    userId: Number(process.env.XTB_LOGIN) || process.env.XTB_LOGIN,
    password: process.env.XTB_PASSWORD,
    appName: "TradingOS-SignalMotor",
  });

  const streamSessionId = login?.returnData?.streamSessionId;
  if (!streamSessionId) throw new Error("login sem streamSessionId");
  return { main, streamSessionId };
}

async function fetchChartLast(main: any, tf: string, lookbackMs: number): Promise<Candle[]> {
  const s = state();
  const period = PERIOD[tf];
  const start = Date.now() - lookbackMs;
  const msg = await sendCommand(main, "getChartLastRequest", {
    info: { period, start, symbol: s.xtbSymbol },
  });
  const data = msg?.returnData;
  const digits = Number(data?.digits ?? 2);
  const rateInfos = (data?.rateInfos || []) as XtbRateInfoRecord[];
  return rateInfosToCandles(rateInfos, digits);
}

async function connectStream(WebSocketCtor: any, streamSessionId: string): Promise<any> {
  const type = accountType();
  const url = `wss://ws.xtb.com/${type}Stream`;
  const ws = new WebSocketCtor(url);
  await new Promise<void>((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("WS stream connect timeout")), 15_000);
    ws.on("open", () => {
      clearTimeout(to);
      resolve();
    });
    ws.on("error", (e: any) => {
      clearTimeout(to);
      reject(e);
    });
  });

  const s = state();
  // getCandles entrega M1; agregamos para M5/M15/H4
  ws.send(
    JSON.stringify({
      command: "getCandles",
      streamSessionId,
      symbol: s.xtbSymbol,
    })
  );
  ws.send(JSON.stringify({ command: "getKeepAlive", streamSessionId }));

  ws.on("message", (raw: Buffer | string) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.command === "candle" && msg.data) {
        const c = streamCandleToCandle(msg.data);
        s.m1 = upsertCandle(s.m1, c, 4000);
        // Atualiza TFs superiores a partir de M1 reais
        for (const tf of XAU_TIMEFRAMES) {
          const agg = aggregateCandles(s.m1, tf);
          const buf = s.buffers.get(tf);
          if (buf && agg.length) {
            // merge: mantém histórico backfill + actualiza barras recentes
            const existing = buf.candles;
            const merged = new Map<number, Candle>();
            for (const e of existing) merged.set(e.time, e);
            for (const a of agg.slice(-50)) merged.set(a.time, a);
            buf.seed([...merged.values()]);
          }
        }
        emitFromLast("xtb-xapi");
        // Persistência assíncrona (não bloqueia)
        saveCandlesToCache("XAUUSD", "M5", s.buffers.get("M5")?.candles.slice(-5) || [], "xtb-xapi").catch(
          () => {}
        );
      }
    } catch {}
  });

  ws.on("close", () => {
    console.warn("[xtb-client] stream fechado — reconnect em 8s.");
    s.streamWs = null;
    setTimeout(() => {
      if (s.started && s.streamSessionId) {
        connectStream(WebSocketCtor, s.streamSessionId).then((w) => {
          s.streamWs = w;
        }).catch((e) => console.warn("[xtb-client] reconnect stream:", e?.message || e));
      }
    }, 8000);
  });

  return ws;
}

async function backfillViaXtb(): Promise<boolean> {
  let WebSocketCtor: any;
  try {
    ({ default: WebSocketCtor } = await import("ws"));
  } catch {
    throw new Error("pacote 'ws' indisponível");
  }

  const { main, streamSessionId } = await xtbLogin(WebSocketCtor);
  const s = state();
  s.mainWs = main;
  s.streamSessionId = streamSessionId;

  for (const tf of XAU_TIMEFRAMES) {
    const candles = await fetchChartLast(main, tf, LOOKBACK_MS[tf]);
    if (candles.length) {
      seedBuffer(tf, candles);
      await saveCandlesToCache("XAUUSD", tf, candles, "xtb-xapi");
      console.log(`[xtb-client] xAPI backfill ${tf}: ${candles.length} barras (${s.xtbSymbol})`);
    } else {
      console.warn(`[xtb-client] xAPI ${tf}: 0 barras`);
    }
  }

  // ping keep-alive na conexão main
  s.pingTimer = setInterval(() => {
    sendCommand(main, "ping").catch(() => {});
  }, 20_000);

  // refresh periódico dos TFs (últimas ~2 janelas) — OHLC real, não spot
  s.refreshTimer = setInterval(() => {
    (async () => {
      for (const tf of XAU_TIMEFRAMES) {
        try {
          const candles = await fetchChartLast(main, tf, LOOKBACK_MS[tf] / 4);
          if (!candles.length) continue;
          const buf = s.buffers.get(tf)!;
          const merged = new Map<number, Candle>();
          for (const e of buf.candles) merged.set(e.time, e);
          for (const c of candles) merged.set(c.time, c);
          buf.seed([...merged.values()]);
          await saveCandlesToCache("XAUUSD", tf, candles.slice(-30), "xtb-xapi");
        } catch (e: any) {
          console.warn(`[xtb-client] refresh ${tf}:`, e?.message || e);
        }
      }
      emitFromLast("xtb-xapi");
    })().catch(() => {});
  }, 60_000);

  s.streamWs = await connectStream(WebSocketCtor, streamSessionId);
  markReady("xtb-xapi", `symbol=${s.xtbSymbol}`);
  emitFromLast("xtb-xapi");
  return warmUpComplete();
}

async function backfillViaTwelveData(): Promise<boolean> {
  const sizes: Record<string, number> = { H4: 250, M15: 500, M5: 400 };
  for (const tf of XAU_TIMEFRAMES) {
    const candles = await fetchTwelveDataOhlc(tf, sizes[tf]);
    seedBuffer(tf, candles);
    await saveCandlesToCache("XAUUSD", tf, candles, "twelvedata");
    console.log(`[xtb-client] TwelveData backfill ${tf}: ${candles.length} barras`);
  }
  markReady("twelvedata", "fallback OHLC real (não XTB)");
  emitFromLast("twelvedata");

  // Poll periódico time_series (últimas barras) — ainda OHLC, não spot
  const s = state();
  s.refreshTimer = setInterval(() => {
    (async () => {
      for (const tf of XAU_TIMEFRAMES) {
        try {
          const candles = await fetchTwelveDataOhlc(tf, 30);
          const buf = s.buffers.get(tf)!;
          const merged = new Map<number, Candle>();
          for (const e of buf.candles) merged.set(e.time, e);
          for (const c of candles) merged.set(c.time, c);
          buf.seed([...merged.values()]);
          await saveCandlesToCache("XAUUSD", tf, candles.slice(-10), "twelvedata");
        } catch (e: any) {
          console.warn(`[xtb-client] TwelveData refresh ${tf}:`, e?.message || e);
        }
      }
      emitFromLast("twelvedata");
    })().catch(() => {});
  }, 90_000);

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
    // ainda warming até confirmar fonte live, mas permite progresso visual
  }
}

/** Arranca o cliente XAU (idempotente). */
export function startXtbClient(): void {
  const s = state();
  if (s.started) return;
  s.started = true;
  s.status = "warming_up";

  (async () => {
    try {
      await loadFromCache();

      if (hasXtbCreds()) {
        try {
          await backfillViaXtb();
          return;
        } catch (e: any) {
          s.lastError = e?.message || String(e);
          console.warn(
            "[xtb-client] xAPI falhou — a tentar TwelveData. Motivo:",
            s.lastError
          );
        }
      } else {
        console.warn(
          "[xtb-client] XTB_LOGIN/XTB_PASSWORD ausentes — usa TwelveData se TWELVE_DATA_API_KEY estiver definida."
        );
      }

      if (hasTwelveData()) {
        await backfillViaTwelveData();
        return;
      }

      // Só cache — se suficiente, ready mas beta; senão erro
      if (warmUpComplete()) {
        markReady("cache", "apenas cache local (sem fonte live)");
        emitFromLast("cache");
      } else {
        s.status = "error";
        s.lastError =
          s.lastError ||
          "Sem XTB_LOGIN/PASSWORD nem TWELVE_DATA_API_KEY — impossível obter OHLC real.";
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
  if (s.refreshTimer) clearInterval(s.refreshTimer);
  if (s.pingTimer) clearInterval(s.pingTimer);
  s.refreshTimer = null;
  s.pingTimer = null;
  try {
    s.mainWs?.close();
  } catch {}
  try {
    s.streamWs?.close();
  } catch {}
  s.mainWs = null;
  s.streamWs = null;
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
 * XAUUSD fica em beta/observação até a fonte ser xAPI XTB verificada.
 * TwelveData e cache contam como beta (não são a cotação XTB).
 */
export function getXauMarketStatus(): XauMarketStatus {
  const s = state();
  const bars = barsSnapshot();
  const ready = s.status === "ready" && warmUpComplete();
  const beta = s.source !== "xtb-xapi" || !ready;
  let message = "";
  if (s.status === "warming_up") message = "A carregar OHLC histórico (backfill)…";
  else if (s.status === "error") message = s.lastError || "Erro na fonte de dados XAU";
  else if (s.source === "xtb-xapi") message = "OHLC via XTB xAPI";
  else if (s.source === "twelvedata")
    message = "OHLC via TwelveData (fallback) — beta/observação vs XTB";
  else if (s.source === "cache") message = "A usar só cache local — beta";
  else message = "Fonte XAU não configurada";

  return {
    status: s.status,
    source: s.source,
    beta,
    symbol: s.xtbSymbol,
    bars,
    ready,
    message,
    lastError: s.lastError,
  };
}

export async function getXauCacheStats() {
  return cacheStats("XAUUSD");
}

/** @deprecated — removido. Mantido só para não partir imports acidentais. */
export function seedSyntheticHistory(_price: number, _bars = 80): void {
  console.warn(
    "[xtb-client] seedSyntheticHistory foi removido — use xAPI / TwelveData OHLC real."
  );
}
