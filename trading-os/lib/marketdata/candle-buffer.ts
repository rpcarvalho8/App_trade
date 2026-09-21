import type { Candle } from "@/lib/strategies/types";

export type TfMinutes = number;

const TF_MS: Record<string, number> = {
  H4: 4 * 60 * 60 * 1000,
  H1: 60 * 60 * 1000,
  M15: 15 * 60 * 1000,
  M5: 5 * 60 * 1000,
  M1: 60 * 1000,
  "15m": 15 * 60 * 1000,
  "5m": 5 * 60 * 1000,
  "1m": 60 * 1000,
};

export function tfToMs(tf: string): number {
  return TF_MS[tf] || TF_MS[tf.toUpperCase()] || 60_000;
}

export function floorTime(ts: number, tfMs: number): number {
  return Math.floor(ts / tfMs) * tfMs;
}

/**
 * Buffer de candles OHLCV por timeframe, atualizado a partir de ticks.
 * Mantém no máximo `maxBars` velas fechadas + 1 em formação.
 */
export class CandleBuffer {
  readonly tf: string;
  readonly tfMs: number;
  readonly maxBars: number;
  private bars: Candle[] = [];

  constructor(tf: string, maxBars = 500) {
    this.tf = tf;
    this.tfMs = tfToMs(tf);
    this.maxBars = maxBars;
  }

  /** Substitui o histórico (ex.: OHLC REST). */
  seed(candles: Candle[]): void {
    this.bars = candles
      .slice()
      .sort((a, b) => a.time - b.time)
      .slice(-this.maxBars);
  }

  get candles(): Candle[] {
    return this.bars.slice();
  }

  get length(): number {
    return this.bars.length;
  }

  last(): Candle | undefined {
    return this.bars[this.bars.length - 1];
  }

  /**
   * Injeta um tick de preço. Devolve true se uma vela fechou (nova barra aberta).
   */
  pushTick(price: number, ts = Date.now(), volume = 0): boolean {
    if (!Number.isFinite(price) || price <= 0) return false;
    const t0 = floorTime(ts, this.tfMs);
    const last = this.bars[this.bars.length - 1];
    if (!last || last.time < t0) {
      this.bars.push({ time: t0, open: price, high: price, low: price, close: price, volume });
      if (this.bars.length > this.maxBars) this.bars.shift();
      return !!last; // fechou a anterior
    }
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
    last.close = price;
    last.volume += volume;
    return false;
  }
}

/** Conjunto de buffers para um símbolo. */
export class MultiTfBuffers {
  readonly symbol: string;
  readonly buffers: Map<string, CandleBuffer> = new Map();

  constructor(symbol: string, timeframes: string[], maxBars = 500) {
    this.symbol = symbol;
    for (const tf of timeframes) {
      this.buffers.set(tf, new CandleBuffer(tf, maxBars));
    }
  }

  get(tf: string): CandleBuffer | undefined {
    return this.buffers.get(tf) || this.buffers.get(tf.toUpperCase());
  }

  pushTick(price: number, ts = Date.now(), volume = 0): Record<string, boolean> {
    const closed: Record<string, boolean> = {};
    for (const [tf, buf] of this.buffers) {
      closed[tf] = buf.pushTick(price, ts, volume);
    }
    return closed;
  }

  snapshot(): Record<string, Candle[]> {
    const out: Record<string, Candle[]> = {};
    for (const [tf, buf] of this.buffers) {
      out[tf] = buf.candles;
    }
    return out;
  }
}
