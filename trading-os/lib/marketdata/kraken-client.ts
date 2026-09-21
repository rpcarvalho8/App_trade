/**
 * Cliente Kraken público para SOLUSD.
 * - REST OHLC para seed dos buffers 15m / 1m
 * - WebSocket ticker (ou polling REST) para ticks em tempo quase-real
 */
import { MultiTfBuffers, tfToMs, floorTime } from "./candle-buffer";
import type { Candle } from "@/lib/strategies/types";

const UA = "Mozilla/5.0 (compatible; TradingOS-KrakenClient/1.0)";
const REST = "https://api.kraken.com/0/public";
const WS_URL = "wss://ws.kraken.com";
/** Par Kraken spot SOL/USD */
export const KRAKEN_PAIR = "SOLUSD";
export const SOL_TIMEFRAMES = ["15m", "1m"] as const;

export interface KrakenTick {
  symbol: "SOLUSD";
  price: number;
  ts: number;
  spread?: number;
  source: "kraken";
}

export type KrakenTickHandler = (tick: KrakenTick, closed: Record<string, boolean>) => void;

interface KrakenState {
  started: boolean;
  buffers: MultiTfBuffers;
  lastPrice: number | null;
  lastSpread: number | null;
  handlers: Set<KrakenTickHandler>;
  pollTimer: NodeJS.Timeout | null;
  ws: any;
  pollMs: number;
  useWs: boolean;
}

function state(): KrakenState {
  const g = globalThis as any;
  if (!g.__tosKrakenClient) {
    g.__tosKrakenClient = {
      started: false,
      buffers: new MultiTfBuffers("SOLUSD", [...SOL_TIMEFRAMES], 800),
      lastPrice: null,
      lastSpread: null,
      handlers: new Set(),
      pollTimer: null,
      ws: null,
      pollMs: Number(process.env.SOL_POLL_MS || 10_000),
      useWs: process.env.SOL_USE_WS !== "0",
    } as KrakenState;
  }
  return g.__tosKrakenClient as KrakenState;
}

async function getJSON(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Intervalo OHLC Kraken: 1 | 5 | 15 | 30 | 60 | 240 | 1440 | 10080 | 21600 */
function krakenInterval(tf: string): number {
  if (tf === "1m" || tf === "M1") return 1;
  if (tf === "15m" || tf === "M15") return 15;
  return 1;
}

export async function fetchKrakenOhlc(tf: string, pair = KRAKEN_PAIR): Promise<Candle[]> {
  const interval = krakenInterval(tf);
  const j = await getJSON(`${REST}/OHLC?pair=${pair}&interval=${interval}`);
  if (j?.error?.length) throw new Error(j.error.join("; "));
  const result = j?.result || {};
  const key = Object.keys(result).find((k) => k !== "last");
  const rows: any[] = key ? result[key] : [];
  return rows.map((r) => ({
    time: Number(r[0]) * 1000,
    open: parseFloat(r[1]),
    high: parseFloat(r[2]),
    low: parseFloat(r[3]),
    close: parseFloat(r[4]),
    volume: parseFloat(r[6]),
  }));
}

async function fetchTicker(): Promise<{ price: number; spread: number } | null> {
  try {
    const j = await getJSON(`${REST}/Ticker?pair=${KRAKEN_PAIR}`);
    if (j?.error?.length) return null;
    const result = j?.result || {};
    const key = Object.keys(result)[0];
    if (!key) return null;
    const t = result[key];
    const bid = parseFloat(t.b?.[0]);
    const ask = parseFloat(t.a?.[0]);
    const last = parseFloat(t.c?.[0]);
    if (!Number.isFinite(last)) return null;
    const spread = Number.isFinite(bid) && Number.isFinite(ask) ? ask - bid : 0;
    return { price: last, spread };
  } catch {
    return null;
  }
}

export async function seedSolHistory(): Promise<void> {
  const s = state();
  for (const tf of SOL_TIMEFRAMES) {
    try {
      const candles = await fetchKrakenOhlc(tf);
      s.buffers.get(tf)?.seed(candles);
      console.log(`[kraken-client] seed ${tf}: ${candles.length} barras`);
    } catch (e: any) {
      console.warn(`[kraken-client] seed ${tf} falhou:`, e?.message || e);
    }
  }
}

function emitTick(price: number, ts: number, spread?: number): void {
  const s = state();
  s.lastPrice = price;
  if (spread != null) s.lastSpread = spread;
  const closed = s.buffers.pushTick(price, ts, 1);
  const tick: KrakenTick = {
    symbol: "SOLUSD",
    price,
    ts,
    spread: s.lastSpread ?? undefined,
    source: "kraken",
  };
  for (const h of s.handlers) {
    try {
      h(tick, closed);
    } catch (e: any) {
      console.warn("[kraken-client] handler error:", e?.message || e);
    }
  }
}

async function pollOnce(): Promise<void> {
  const t = await fetchTicker();
  if (!t) return;
  emitTick(t.price, Date.now(), t.spread);
}

async function connectWs(): Promise<void> {
  const s = state();
  if (!s.useWs) return;
  let WebSocketCtor: any;
  try {
    ({ default: WebSocketCtor } = await import("ws"));
  } catch {
    console.warn("[kraken-client] 'ws' indisponível — uso só polling REST.");
    return;
  }

  try {
    const ws = new WebSocketCtor(WS_URL);
    s.ws = ws;
    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          event: "subscribe",
          pair: ["SOL/USD"],
          subscription: { name: "ticker" },
        })
      );
      console.log("[kraken-client] WS ticker SOL/USD subscrito.");
    });
    ws.on("message", (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(String(raw));
        if (!Array.isArray(msg) || msg.length < 4) return;
        const data = msg[1];
        if (!data || typeof data !== "object") return;
        const last = parseFloat(data.c?.[0]);
        const bid = parseFloat(data.b?.[0]);
        const ask = parseFloat(data.a?.[0]);
        if (!Number.isFinite(last)) return;
        const spread = Number.isFinite(bid) && Number.isFinite(ask) ? ask - bid : undefined;
        emitTick(last, Date.now(), spread);
      } catch {}
    });
    ws.on("close", () => {
      console.warn("[kraken-client] WS fechado — reconnect em 5s.");
      s.ws = null;
      setTimeout(() => {
        if (s.started) connectWs().catch(() => {});
      }, 5000);
    });
    ws.on("error", (err: any) => {
      console.warn("[kraken-client] WS error:", err?.message || err);
    });
  } catch (e: any) {
    console.warn("[kraken-client] WS falhou:", e?.message || e);
  }
}

export function getSolBuffers(): MultiTfBuffers {
  return state().buffers;
}

export function getSolSpread(): number | null {
  return state().lastSpread;
}

export function onSolTick(handler: KrakenTickHandler): () => void {
  const s = state();
  s.handlers.add(handler);
  return () => s.handlers.delete(handler);
}

export function startKrakenClient(): void {
  const s = state();
  if (s.started) return;
  s.started = true;

  seedSolHistory()
    .then(() => pollOnce())
    .catch(() => {});

  s.pollTimer = setInterval(() => {
    pollOnce().catch((e) => console.warn("[kraken-client] poll:", e?.message || e));
  }, s.pollMs);

  connectWs().catch(() => {});
  console.log(`[kraken-client] SOLUSD ativo (poll ${s.pollMs}ms + WS=${s.useWs}).`);
}

export function stopKrakenClient(): void {
  const s = state();
  if (s.pollTimer) clearInterval(s.pollTimer);
  s.pollTimer = null;
  try {
    s.ws?.close();
  } catch {}
  s.ws = null;
  s.started = false;
}

// re-export helpers úteis para testes
export { tfToMs, floorTime };
