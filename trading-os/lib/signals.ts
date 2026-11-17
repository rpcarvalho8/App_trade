/**
 * Persistência e disparo de alertas quando o motor confirma um sinal completo.
 * Só ALERTA — nunca envia ordens à corretora.
 */
import { db, initDB, getSetting } from "@/lib/db";
import { STRATEGIES } from "@/lib/strategies";
import { accountForSymbol } from "@/lib/accounts-db";
import {
  buildPendingTrade,
  checkContraTrigger,
  STRATEGY_SETUP_NAME,
  type ActiveSignal,
  type ContraTrigger,
} from "@/lib/signal-journal";
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

function mkAlert(signal: EngineSignal, signalId: number, tradeId: number | null, executable: number | null): MarketAlert {
  const dir = signal.direction === "long" ? "LONG ▲" : "SHORT ▼";
  const d = signal.symbol === "XAUUSD" ? 2 : 3;
  const sl = signal.stopLoss != null ? signal.stopLoss.toFixed(d) : "—";
  const tp = signal.takeProfit != null ? signal.takeProfit.toFixed(d) : "—";
  // Passos em linguagem humana (antes saía "1:liquidity_sweep → …", que parecia um setup à parte).
  const stepsSummary = signal.confirmedSteps.map((s) => STEP_TEXT[String(s.type)] || s.type).join(" → ");
  const setupName = STRATEGY_SETUP_NAME[signal.strategyId] || STRATEGIES[signal.strategyId]?.name || signal.strategyId;
  const entry = signal.entry != null ? signal.entry.toFixed(signal.symbol === "XAUUSD" ? 2 : 3) : "—";
  const rr = signal.rr.toFixed(2);
  return {
    id: `signal-${signalId}-${signal.emittedAt}`,
    ts: signal.emittedAt,
    type: "signal",
    level: "critical",
    asset: signal.symbol,
    title: `${signal.symbol} · ${dir} · ${setupName}`,
    message: `${executable === 0 ? "NÃO EXECUTÁVEL (stop acima do máximo para o capital) | " : ""}PE ${entry} | SL ${sl} | TP ${tp} | R:R ${rr} (mín ${signal.rrMin}) | ${stepsSummary}`,
    meta: {
      signalId,
      tradeId,
      executable,
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
 * Capital da conta da corretora do activo (ouro → XTB, SOL → Kraken), com câmbio automático.
 * Recurso: o valor antigo guardado pela Mesa em settings.
 */
async function accountForSizing(symbol: string) {
  const acct = await accountForSymbol(symbol).catch(() => null);
  if (acct?.equity) return { equity: acct.equity, usdPerAccountUnit: acct.usdPerAccountUnit };
  const equity = Number(await getSetting("equity").catch(() => null)) || null;
  const fx = Number(await getSetting("usd_per_account_unit").catch(() => null)) || 1;
  return { equity, usdPerAccountUnit: fx };
}

export async function recordSignalEvent(
  signalId: number,
  ev: { type: string; reason: string; price?: number | null },
  meta: { tradeId?: number | null; strategyId?: string; symbol?: string } = {}
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO signal_events (signal_id, trade_id, strategy_id, symbol, type, reason, price) VALUES (?,?,?,?,?,?,?)`,
    args: [signalId, meta.tradeId ?? null, meta.strategyId ?? null, meta.symbol ?? null, ev.type, ev.reason, ev.price ?? null],
  });
}

/**
 * Contra-trigger: o sinal deixa de estar activo e a linha pendente do journal fica marcada.
 * NÃO cria trade nova — o evento fica ligado ao sinal original.
 */
async function closeSignal(sig: { id: number; trade_id: number | null; strategy_id: string; symbol: string }, ev: ContraTrigger & { price?: number }) {
  await db.execute({ sql: "UPDATE signals SET status=? WHERE id=? AND status='active'", args: [ev.type, sig.id] });
  if (sig.trade_id) {
    await db.execute({
      sql: "UPDATE trades SET signal_status=? WHERE id=? AND outcome='PENDING'",
      args: [ev.type, sig.trade_id],
    });
  }
  await recordSignalEvent(sig.id, ev, { tradeId: sig.trade_id, strategyId: sig.strategy_id, symbol: sig.symbol });
  broadcastAlert({
    id: `signal-${sig.id}-${ev.type}-${Date.now()}`,
    ts: Date.now(),
    type: "setup",
    level: "info",
    asset: sig.symbol,
    title: `${sig.symbol} · sinal #${sig.id} ${ev.type === "expired" ? "expirou" : ev.type === "reversal" ? "contrariado" : "invalidado"}`,
    message: `${ev.reason}. Não entres; a linha do journal fica marcada para rever.`,
    meta: { signalId: sig.id, tradeId: sig.trade_id, event: ev.type },
  });
}

type ActiveRow = { id: number; trade_id: number | null; strategy_id: string; symbol: string; direction: string; invalidation_price: number | null; expires_at: string | null };

async function activeSignals(symbol: string): Promise<ActiveRow[]> {
  const r = await db.execute({
    sql: `SELECT s.id, s.trade_id, s.strategy_id, s.symbol, s.direction, s.invalidation_price, s.expires_at
          FROM signals s LEFT JOIN trades t ON t.id = s.trade_id
          WHERE s.symbol=? AND s.status='active' AND (s.trade_id IS NULL OR t.outcome='PENDING')`,
    args: [symbol],
  });
  return r.rows as unknown as ActiveRow[];
}

/** Chamado pelo runner a cada avaliação: fecha sinais pendentes cujo preço invalidou ou cuja validade acabou. */
export async function checkActiveSignals(symbol: string, price: number, now = Date.now()): Promise<void> {
  for (const row of await activeSignals(symbol)) {
    const sig: ActiveSignal = {
      id: row.id,
      symbol: row.symbol,
      direction: row.direction === "long" ? "long" : "short",
      invalidationPrice: Number(row.invalidation_price),
      expiresAt: row.expires_at ? Date.parse(row.expires_at) : Infinity,
    };
    const ev = checkContraTrigger(sig, price, now);
    if (ev) await closeSignal(row, { ...ev, price });
  }
}

/**
 * Grava o sinal, cria a linha "Pendente de Validação" no journal e dispara alertas (WS, email, Telegram).
 * Um sinal novo na direcção oposta é contra-trigger dos sinais ainda pendentes do mesmo activo.
 */
export async function emitSignalAlert(signal: EngineSignal): Promise<{ id: number; tradeId: number | null }> {
  await initDB();
  const id = await persistSignal(signal);

  for (const row of await activeSignals(signal.symbol)) {
    if (row.id !== id && row.direction !== signal.direction) {
      await closeSignal(row, { type: "reversal", reason: `sinal oposto #${id} (${signal.direction})`, price: signal.entry });
    }
  }

  let tradeId: number | null = null;
  let executable: number | null = null;
  const strategy = STRATEGIES[signal.strategyId];
  try {
    const pending = strategy ? buildPendingTrade(signal, strategy, id, await accountForSizing(signal.symbol)) : null;
    if (pending) {
      const cols = Object.keys(pending);
      const res = await db.execute({
        sql: `INSERT INTO trades (${cols.join(",")}, signal_id, followed_plan) VALUES (${cols.map(() => "?").join(",")}, ?, NULL)`,
        args: [...Object.values(pending), id],
      });
      tradeId = Number(res.lastInsertRowid);
      executable = pending.executable;
      await db.execute({
        sql: "UPDATE signals SET trade_id=?, expires_at=?, invalidation_price=? WHERE id=?",
        args: [tradeId, pending.expires_at, pending.invalidation_price, id],
      });
    }
  } catch (e) {
    console.warn("[signals] journal pendente falhou:", e instanceof Error ? e.message : e);
  }

  const alert = mkAlert(signal, id, tradeId, executable);
  broadcastAlert(alert);
  sendSignalEmail(signal, id).catch((e) =>
    console.warn("[signals] email falhou:", e?.message || e)
  );
  console.log(
    `[signals] #${id} ${signal.symbol} ${signal.direction} rr=${signal.rr.toFixed(2)} steps=${signal.confirmedSteps.length} journal=${tradeId ?? "—"}`
  );
  return { id, tradeId };
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
    sql: `SELECT s.*, t.outcome AS trade_outcome, t.signal_status AS trade_signal_status, t.lot_suggested, t.max_stop, t.executable, t.tp1
          FROM signals s LEFT JOIN trades t ON t.id = s.trade_id
          ORDER BY s.id DESC LIMIT ?`,
    args: [limit],
  });
  return res.rows as any[];
}
