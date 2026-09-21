/**
 * Cliente de mercado para XAUUSD.
 *
 * Nota: a XTB não disponibiliza API pública REST/WS para clientes retail.
 * Este módulo usa gold-api.com como fonte de preço (ticks) e agrega candles
 * H4/M15/M5 localmente. Mantém o nome `xtb-client` porque o playbook opera
 * ouro via XTB — a execução continua manual no xStation.
 */
import { MultiTfBuffers } from "./candle-buffer";
import type { Candle } from "@/lib/strategies/types";

const UA = "Mozilla/5.0 (compatible; TradingOS-XTBClient/1.0)";
const GOLD_URL = "https://api.gold-api.com/price/XAU";

export const XAU_TIMEFRAMES = ["H4", "M15", "M5"] as const;

export interface XtbTick {
  symbol: "XAUUSD";
  price: number;
  ts: number;
  source: "gold-api";
}

export type XtbTickHandler = (tick: XtbTick, closed: Record<string, boolean>) => void;

interface XtbState {
  started: boolean;
  timer: NodeJS.Timeout | null;
  buffers: MultiTfBuffers;
  lastPrice: number | null;
  handlers: Set<XtbTickHandler>;
  pollMs: number;
}

function state(): XtbState {
  const g = globalThis as any;
  if (!g.__tosXtbClient) {
    g.__tosXtbClient = {
      started: false,
      timer: null,
      buffers: new MultiTfBuffers("XAUUSD", [...XAU_TIMEFRAMES], 600),
      lastPrice: null,
      handlers: new Set(),
      pollMs: Number(process.env.XAU_POLL_MS || 15_000),
    } as XtbState;
  }
  return g.__tosXtbClient as XtbState;
}

async function fetchGoldPrice(): Promise<number | null> {
  try {
    const res = await fetch(GOLD_URL, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return typeof j?.price === "number" ? j.price : null;
  } catch {
    return null;
  }
}

/**
 * Seed opcional: gera histórico sintético a partir do preço atual
 * (útil até haver OHLC real). Amplitude ~0.05% por barra.
 */
export function seedSyntheticHistory(price: number, bars = 80): void {
  const s = state();
  const now = Date.now();
  for (const tf of XAU_TIMEFRAMES) {
    const buf = s.buffers.get(tf)!;
    const tfMs =
      tf === "H4" ? 4 * 3600_000 : tf === "M15" ? 15 * 60_000 : 5 * 60_000;
    const candles: Candle[] = [];
    let p = price * (1 - 0.002);
    for (let i = bars; i >= 1; i--) {
      const t = floorAlign(now - i * tfMs, tfMs);
      const drift = (Math.sin(i / 5) + Math.cos(i / 7)) * price * 0.0004;
      const open = p;
      const close = p + drift;
      const high = Math.max(open, close) + price * 0.00015;
      const low = Math.min(open, close) - price * 0.00015;
      candles.push({ time: t, open, high, low, close, volume: 100 + (i % 20) });
      p = close;
    }
    // força última perto do preço real
    const last = candles[candles.length - 1];
    last.close = price;
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
    buf.seed(candles);
  }
}

function floorAlign(ts: number, tfMs: number): number {
  return Math.floor(ts / tfMs) * tfMs;
}

async function pollOnce(): Promise<void> {
  const s = state();
  const price = await fetchGoldPrice();
  if (price == null) return;
  const ts = Date.now();
  if (s.lastPrice == null) {
    seedSyntheticHistory(price);
  }
  s.lastPrice = price;
  const closed = s.buffers.pushTick(price, ts, 1);
  const tick: XtbTick = { symbol: "XAUUSD", price, ts, source: "gold-api" };
  for (const h of s.handlers) {
    try {
      h(tick, closed);
    } catch (e: any) {
      console.warn("[xtb-client] handler error:", e?.message || e);
    }
  }
}

export function getXauBuffers(): MultiTfBuffers {
  return state().buffers;
}

export function onXauTick(handler: XtbTickHandler): () => void {
  const s = state();
  s.handlers.add(handler);
  return () => s.handlers.delete(handler);
}

/** Arranca o polling de ouro (idempotente). */
export function startXtbClient(): void {
  const s = state();
  if (s.started) return;
  s.started = true;
  pollOnce().catch(() => {});
  s.timer = setInterval(() => {
    pollOnce().catch((e) => console.warn("[xtb-client] poll:", e?.message || e));
  }, s.pollMs);
  console.log(`[xtb-client] XAUUSD polling a cada ${s.pollMs}ms (gold-api → buffers H4/M15/M5).`);
}

export function stopXtbClient(): void {
  const s = state();
  if (s.timer) clearInterval(s.timer);
  s.timer = null;
  s.started = false;
}
