/**
 * Cache persistente de candles OHLCV em SQLite.
 * Evita repetir backfill completo em cada restart da app.
 */
import { db } from "@/lib/db";
import type { Candle } from "@/lib/strategies/types";

export async function ensureCandleCacheTable(): Promise<void> {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS candle_cache (
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      time INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL DEFAULT 0,
      source TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (symbol, timeframe, time)
    );
    CREATE INDEX IF NOT EXISTS idx_candle_cache_sym_tf
      ON candle_cache (symbol, timeframe, time);
  `);
}

export async function loadCachedCandles(
  symbol: string,
  timeframe: string,
  sinceMs?: number
): Promise<Candle[]> {
  await ensureCandleCacheTable();
  const res = sinceMs
    ? await db.execute({
        sql: `SELECT time, open, high, low, close, volume FROM candle_cache
              WHERE symbol=? AND timeframe=? AND time>=? ORDER BY time ASC`,
        args: [symbol, timeframe, sinceMs],
      })
    : await db.execute({
        sql: `SELECT time, open, high, low, close, volume FROM candle_cache
              WHERE symbol=? AND timeframe=? ORDER BY time ASC`,
        args: [symbol, timeframe],
      });
  return (res.rows as any[]).map((r) => ({
    time: Number(r.time),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume || 0),
  }));
}

/** Grava/atualiza um lote de candles (transação em batch). */
export async function saveCandlesToCache(
  symbol: string,
  timeframe: string,
  candles: Candle[],
  source: string
): Promise<void> {
  if (!candles.length) return;
  await ensureCandleCacheTable();
  // Batch em chunks para não saturar o driver
  const chunk = 80;
  for (let i = 0; i < candles.length; i += chunk) {
    const slice = candles.slice(i, i + chunk);
    for (const c of slice) {
      await db.execute({
        sql: `INSERT INTO candle_cache (symbol, timeframe, time, open, high, low, close, volume, source, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))
              ON CONFLICT(symbol, timeframe, time) DO UPDATE SET
                open=excluded.open, high=excluded.high, low=excluded.low,
                close=excluded.close, volume=excluded.volume, source=excluded.source,
                updated_at=datetime('now')`,
        args: [symbol, timeframe, c.time, c.open, c.high, c.low, c.close, c.volume, source],
      });
    }
  }
}

export async function cacheStats(symbol: string): Promise<Record<string, number>> {
  await ensureCandleCacheTable();
  const res = await db.execute({
    sql: `SELECT timeframe, COUNT(*) as c FROM candle_cache WHERE symbol=? GROUP BY timeframe`,
    args: [symbol],
  });
  const out: Record<string, number> = {};
  for (const r of res.rows as any[]) out[String(r.timeframe)] = Number(r.c);
  return out;
}
