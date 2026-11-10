/**
 * Persistência e disparo de alertas quando o motor confirma um sinal completo.
 * Só ALERTA — nunca envia ordens à corretora.
 */
import { db } from "@/lib/db";
import { broadcastAlert, type MarketAlert } from "@/lib/alert-ws";
import { sendSignalEmail } from "@/lib/alert-email";
import type { EngineSignal, EngineState, StrategyDefinition } from "@/lib/strategies/types";

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
  const d = signal.symbol === "XAUUSD" ? 2 : 3;
  const sl = signal.stopLoss != null ? signal.stopLoss.toFixed(d) : "—";
  const tp = signal.takeProfit != null ? signal.takeProfit.toFixed(d) : "—";
  const stepsSummary = signal.confirmedSteps
    .map((s) => `${s.step}:${s.type}`)
    .join(" → ");
  const entry = signal.entry != null ? signal.entry.toFixed(signal.symbol === "XAUUSD" ? 2 : 3) : "—";
  const rr = signal.rr.toFixed(2);
  return {
    id: `signal-${signalId}-${signal.emittedAt}`,
    ts: signal.emittedAt,
    type: "signal",
    level: "critical",
    asset: signal.symbol,
    title: `${signal.symbol} · ${dir} · ${signal.strategyId}`,
    message: `PE ${entry} | SL ${sl} | TP ${tp} | R:R ${rr} (mín ${signal.rrMin}) | ${stepsSummary}`,
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

const STEP_TEXT: Record<string, string> = {
  calendar_clean: "calendário limpo",
  bias_h4: "bias H4",
  liquidity_sweep: "sweep de liquidez",
  mss_cisd: "MSS/CISD M15",
  ob_or_fvg: "OB/FVG no M5",
  choch_volume: "CHoCH com volume no M1",
  fvg_golden_ratio: "FVG na zona 0,618–0,786",
  htf_zone_tap: "toque numa zona H4/H1",
  ltf_mss: "MSS no M5 dentro da zona",
};

/**
 * Alerta "setup armado": parte da sequência confirmou, falta a entrada.
 * Serve para estares à frente do gráfico quando o sinal sair (ou entrares tu, com o plano).
 */
export async function emitSetupAlert(strategy: StrategyDefinition, st: EngineState, price?: number): Promise<void> {
  const steps = [...strategy.sequence].sort((a, b) => a.step - b.step);
  const next = steps[st.currentStepIndex];
  const d = strategy.symbol === "XAUUSD" ? 2 : 3;
  const dir = st.bias === "bullish" ? "LONG ▲" : st.bias === "bearish" ? "SHORT ▼" : "";
  let what = `${st.confirmed.map((c) => STEP_TEXT[String(c.type)] || c.type).join(" + ")} confirmados`;
  if (st.zone) {
    const z = st.zone;
    what = `Preço numa ${z.kind === "fvg" ? "FVG" : "OB"} ${z.tf} ${z.direction === "bullish" ? "de compra" : "de venda"} ${z.low.toFixed(d)}–${z.high.toFixed(d)}`;
  }
  const max = next?.params?.maxCandles;
  const wait = next ? `à espera de ${STEP_TEXT[String(next.type)] || next.type}${typeof max === "number" ? ` (até ${max} velas ${strategy.timeframes.entry})` : ""}` : "";
  broadcastAlert({
    id: `setup-${strategy.id}-${Date.now()}`,
    ts: Date.now(),
    type: "setup",
    level: "warning",
    asset: strategy.symbol,
    title: `${strategy.symbol} · ARMADO ${dir} · ${strategy.name}`,
    message: `${what}${price != null ? ` · preço ${price.toFixed(d)}` : ""} · ${wait}`,
    meta: { strategyId: strategy.id, step: st.currentStepIndex, zone: st.zone ?? null },
  });
}

export async function listRecentSignals(limit = 50): Promise<any[]> {
  await ensureSignalsTable();
  const res = await db.execute({
    sql: `SELECT * FROM signals ORDER BY id DESC LIMIT ?`,
    args: [limit],
  });
  return res.rows as any[];
}
