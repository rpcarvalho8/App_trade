/**
 * Registo persistente do motor de sinais (SQLite): cada passo confirmado, setup descartado,
 * sinal emitido e mudança de estado (pausa por notícia, feed parado…).
 * O diagnóstico em memória perde-se a cada reinício; isto fica para comparar com o replay.
 */
import { db } from "@/lib/db";

export interface EngineLogRow {
  strategyId: string;
  symbol: string;
  kind: "step" | "invalidated" | "signal" | "idle" | "wait";
  step?: number | null;
  type?: string | null;
  reason?: string | null;
  price?: number | null;
}

let ready: Promise<void> | null = null;

function ensure(): Promise<void> {
  if (!ready) {
    ready = db
      .executeMultiple(`
        CREATE TABLE IF NOT EXISTS engine_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at INTEGER NOT NULL,
          strategy_id TEXT NOT NULL,
          symbol TEXT NOT NULL,
          kind TEXT NOT NULL,
          step INTEGER,
          type TEXT,
          reason TEXT,
          price REAL
        );
        CREATE INDEX IF NOT EXISTS idx_engine_log_at ON engine_log (symbol, at);
      `)
      .catch((e) => {
        ready = null;
        throw e;
      });
  }
  return ready;
}

export async function logEngine(row: EngineLogRow, at = Date.now()): Promise<void> {
  try {
    await ensure();
    await db.execute({
      sql: `INSERT INTO engine_log (at, strategy_id, symbol, kind, step, type, reason, price) VALUES (?,?,?,?,?,?,?,?)`,
      args: [at, row.strategyId, row.symbol, row.kind, row.step ?? null, row.type ?? null, row.reason ?? null, row.price ?? null],
    });
  } catch (e) {
    console.warn("[engine-log]", e instanceof Error ? e.message : e);
  }
}

export async function readEngineLog(symbol: string, since: number): Promise<Record<string, unknown>[]> {
  await ensure();
  const r = await db.execute({
    sql: `SELECT at, strategy_id, kind, step, type, reason, price FROM engine_log WHERE symbol=? AND at>=? ORDER BY at ASC LIMIT 2000`,
    args: [symbol, since],
  });
  return (r.rows as unknown as Record<string, unknown>[]).map((x) => ({
    ...x,
    at: new Date(Number(x.at)).toISOString().slice(0, 16).replace("T", " "),
  }));
}
