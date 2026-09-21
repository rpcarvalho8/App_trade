/**
 * Persistência e disparo de alertas quando o motor confirma um sinal completo.
 * Só ALERTA — nunca envia ordens à corretora.
 */
import { db } from "@/lib/db";
import { broadcastAlert, type MarketAlert } from "@/lib/alert-ws";
import { sendSignalEmail } from "@/lib/alert-email";
import type { EngineSignal } from "@/lib/strategies/types";

export async function ensureSignalsTable(): Promise<void> {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry REAL,
      stop_loss REAL,
      take_profit REAL,
      rr REAL,
      rr_min REAL,
      confluences TEXT DEFAULT '[]',
      confirmed_steps TEXT DEFAULT '[]',
      audit_json TEXT DEFAULT '{}',
      payload_json TEXT DEFAULT '{}',
      alerted INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

export async function persistSignal(signal: EngineSignal): Promise<number> {
  await ensureSignalsTable();
  const result = await db.execute({
    sql: `INSERT INTO signals
      (strategy_id, symbol, direction, entry, stop_loss, take_profit, rr, rr_min,
       confluences, confirmed_steps, audit_json, payload_json, alerted)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`,
    args: [
      signal.strategyId,
      signal.symbol,
      signal.direction,
      signal.entry ?? null,
      signal.stopLoss ?? null,
      signal.takeProfit ?? null,
      signal.rr,
      signal.rrMin,
      JSON.stringify(signal.confluencesValidated),
      JSON.stringify(signal.confirmedSteps),
      JSON.stringify(signal.audit),
      JSON.stringify(signal),
    ],
  });
  return Number(result.lastInsertRowid);
}

function mkAlert(signal: EngineSignal, signalId: number): MarketAlert {
  const dir = signal.direction === "long" ? "LONG ▲" : "SHORT ▼";
  const stepsSummary = signal.confirmedSteps
    .map((s) => `${s.step}:${s.type}`)
    .join(" → ");
  const entry = signal.entry != null ? signal.entry.toFixed(signal.symbol === "XAUUSD" ? 2 : 4) : "—";
  const rr = signal.rr.toFixed(2);
  return {
    id: `signal-${signalId}-${signal.emittedAt}`,
    ts: signal.emittedAt,
    type: "signal",
    level: "critical",
    asset: signal.symbol,
    title: `${signal.symbol} · ${dir} · ${signal.strategyId}`,
    message: `Entrada ~${entry} | R:R ${rr} (mín ${signal.rrMin}) | ${stepsSummary}`,
    meta: {
      signalId,
      strategyId: signal.strategyId,
      direction: signal.direction,
      entry: signal.entry,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      rr: signal.rr,
      confluencesValidated: signal.confluencesValidated,
      audit: signal.audit,
      confirmedSteps: signal.confirmedSteps,
    },
  };
}

/**
 * Grava o sinal e dispara alertas in-app (WS + som no cliente) e email.
 */
export async function emitSignalAlert(signal: EngineSignal): Promise<{ id: number }> {
  const id = await persistSignal(signal);
  const alert = mkAlert(signal, id);
  broadcastAlert(alert);
  sendSignalEmail(signal, id).catch((e) =>
    console.warn("[signals] email falhou:", e?.message || e)
  );
  console.log(
    `[signals] #${id} ${signal.symbol} ${signal.direction} rr=${signal.rr.toFixed(2)} steps=${signal.confirmedSteps.length}`
  );
  return { id };
}

export async function listRecentSignals(limit = 50): Promise<any[]> {
  await ensureSignalsTable();
  const res = await db.execute({
    sql: `SELECT * FROM signals ORDER BY id DESC LIMIT ?`,
    args: [limit],
  });
  return res.rows as any[];
}
