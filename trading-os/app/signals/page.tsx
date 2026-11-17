"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { validateLevels } from "@/lib/risk";
import { PLAYBOOKS } from "@/lib/playbooks";

type AssetStatus = {
  status?: string;
  source?: string;
  beta?: boolean;
  mode?: string;
  label?: string;
  message?: string;
  disclaimer?: string;
  bars?: Record<string, number>;
  cacheBars?: Record<string, number>;
  lastError?: string;
  pollPlan?: string;
  credits?: { used?: number; limit?: number; pct?: number; byTf?: Record<string, number> };
};

type AssetDiag = {
  strategyId?: string;
  waitingReason?: string | null;
  lastArmedAt?: number | null;
  signalsToday?: number;
  lastEvalAt: number | null;
  idleReason: string | null;
  step: number;
  totalSteps: number;
  nextStepType: string | null;
  lastReject: { reason: string; at: number } | null;
  rejects: { day: string; counts: Record<string, number> };
  lastSignalAt: number | null;
};

type StrategyInfo = {
  id: string;
  symbol: "XAUUSD" | "SOLUSD";
  name: string;
  description?: string | null;
  utcHours?: [number, number] | null;
  entryTf?: string;
  steps?: string[];
};

const SETUP_NAME: Record<string, string> = {
  "xauusd-london-structure": "XAUUSD — London Structure",
  "solusd-smc-3step": "SMC 3-Step Scalping",
  "xauusd-htf-rotation": "HTF Imbalance Rotation",
  "solusd-htf-rotation": "HTF Imbalance Rotation",
};

const STEP_LABELS: Record<string, string> = {
  calendar_clean: "calendário sem notícias fortes",
  bias_h4: "bias H4 claro",
  liquidity_sweep: "sweep de liquidez",
  mss_cisd: "MSS / CISD",
  ob_or_fvg: "OB ou FVG no M5",
  choch_volume: "CHoCH com volume no M1",
  fvg_golden_ratio: "FVG na zona 0,618–0,786",
  htf_zone_tap: "preço numa FVG/OB fresca H4 ou H1, a favor do bias",
  ltf_mss: "MSS no M5 dentro da zona",
};

/** Porque é que o passo actual ainda não confirmou. */
const WAIT_LABELS: Record<string, string> = {
  no_zone_tap: "nenhuma zona fresca tocada agora",
  bias_neutral: "H4 sem BOS claro",
  no_sweep: "sem sweep nas últimas 3 velas fechadas",
  sweep_against_bias: "houve sweep, mas contra o bias H4",
  no_bullish_break: "ainda sem quebra de estrutura",
  no_bearish_break: "ainda sem quebra de estrutura",
  choch_no_volume: "CHoCH sem volume suficiente",
  choch_against_sweep: "CHoCH contra o sweep",
  no_choch: "sem CHoCH",
  range_or_phaseB: "H4 em range",
  news_blackout: "notícia forte em menos de 30 min",
  fvg_out_of_zone: "FVG fora da zona Fibonacci",
  no_fvg: "sem FVG",
  deviation_too_large: "sweep demasiado profundo",
  no_close_back_inside: "sweep sem fecho de volta",
};

const REJECT_LABELS: Record<string, string> = {
  no_direction: "sem direcção definida",
  levels_missing: "sem SL/TP calculável",
  levels_wrong_side: "preço já passou o SL (setup falhado)",
  stop_too_tight: "SL demasiado curto (ruído)",
  rr_below_min: "R:R abaixo do mínimo",
  spread_too_wide: "spread demasiado largo",
  outside_session: "fora da sessão",
  confluences_missing: "confluências em falta",
  maxCandlesAfterSweep_exceeded: "setup expirou depois do sweep",
  maxCandlesAfterStep1ForChoCH_exceeded: "CHoCH não apareceu a tempo",
  step_maxCandles_exceeded: "passo expirou",
  stop_too_wide: "SL demasiado largo para o risco diário",
  zone_broken: "zona partida (M15 fechou para lá dela)",
  bias_changed: "bias H4 mudou a meio do setup",
  news_blackout: "notícia forte a meio do setup",
};

const hhmm = (ts: number | null | undefined) =>
  ts ? new Date(ts).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }) : "—";

const fmtPrice = (v: unknown, symbol?: string) => {
  const n = Number(v);
  return v == null || v === "" || !Number.isFinite(n) || n <= 0 ? "—" : n.toFixed(symbol === "SOLUSD" ? 3 : 2);
};

type Badge = { label: string; cls: string };

/** Um único estado por cartão: o que interessa para decidir se olhas para o gráfico. */
function cardBadge(st: StrategyInfo, asset: AssetStatus, diag?: AssetDiag): Badge {
  if (diag?.idleReason?.startsWith("fora do horário")) return { label: "FORA DE HORÁRIO", cls: "bg-slate-800 text-slate-400 border-slate-600" };
  if (PLAYBOOKS[st.symbol]?.status === "observacao") return { label: "OBSERVAÇÃO / DEMO", cls: "bg-purple-950 text-purple-300 border-purple-700" };
  if (asset.status === "error") return { label: "ERRO DE DADOS", cls: "bg-red-950 text-red-300 border-red-700" };
  if (asset.status === "ready") return { label: "READY / LIVE", cls: "bg-emerald-950 text-emerald-300 border-emerald-700" };
  return { label: "A AQUECER", cls: "bg-amber-950 text-amber-300 border-amber-700" };
}

export default function SignalsPage() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");

  const load = () => {
    fetch("/api/signals", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => {
        setData(d);
        setErr("");
      })
      .catch((e) => setErr(String(e?.message || e)));
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  const status = data?.status || "—";
  const assets: Record<string, AssetStatus> = { XAUUSD: data?.assets?.XAUUSD || {}, SOLUSD: data?.assets?.SOLUSD || {} };
  const signals: any[] = data?.signals || [];
  const strategies: StrategyInfo[] = data?.runner?.strategies || [];

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] tracking-[0.2em] text-slate-500">TRADING OS</div>
          <h1 className="text-2xl font-semibold text-[#4af0c4]">Motor de Sinais</h1>
          <div className="mt-1 text-xs text-slate-400">
            Só alertas, execução manual. Cada sinal cria uma linha pendente no journal.{" "}
            <span className={status === "ready" ? "text-emerald-400" : status === "error" ? "text-red-400" : "text-amber-400"}>
              Motor: {status}
            </span>
          </div>
        </div>
        <button className="btn-ghost text-xs" onClick={load}>
          Atualizar
        </button>
      </div>

      {err && <div className="rounded-md border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-300">Falha a carregar: {err}</div>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {strategies.map((st) => (
          <StrategyCard key={st.id} st={st} asset={assets[st.symbol] || {}} diag={data?.runner?.diag?.[st.id]} now={data?.now} />
        ))}
      </div>

      <section>
        <h2 className="mb-3 text-xs font-semibold tracking-wider text-slate-400">SINAIS RECENTES ({signals.length})</h2>
        {signals.length === 0 ? (
          <div className="rounded-lg border border-[#1e2d45] bg-[#0d1929] p-4 text-sm text-slate-400">Ainda sem sinais emitidos.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {signals.map((sig) => (
              <SignalRow key={sig.id} sig={sig} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const SIGNAL_STATE: Record<string, { label: string; cls: string }> = {
  active: { label: "ACTIVO", cls: "text-emerald-300 border-emerald-700" },
  invalidated: { label: "INVALIDADO", cls: "text-red-300 border-red-700" },
  expired: { label: "EXPIRADO", cls: "text-slate-400 border-slate-600" },
  reversal: { label: "CONTRARIADO", cls: "text-red-300 border-red-700" },
};

function SignalRow({ sig }: { sig: Record<string, any> }) {
  const symbol = String(sig.symbol);
  const side = String(sig.direction).toLowerCase() === "long" ? "LONG" : "SHORT";
  const errors = validateLevels(side, Number(sig.entry), Number(sig.stop_loss), Number(sig.take_profit));
  const valid = errors.length === 0;
  const state = SIGNAL_STATE[String(sig.status || "active")] || SIGNAL_STATE.active;
  const validated = sig.trade_outcome && sig.trade_outcome !== "PENDING";
  const mesaHref = `/sessao?${new URLSearchParams({
    asset: symbol,
    dir: side,
    entry: String(sig.entry ?? ""),
    sl: String(sig.stop_loss ?? ""),
    tp: String(sig.take_profit ?? ""),
  }).toString()}`;
  const cell = (label: string, value: string, cls = "text-slate-100") => (
    <span className="whitespace-nowrap">
      <span className="text-slate-500">{label} </span>
      <span className={`font-semibold ${cls}`}>{value}</span>
    </span>
  );
  return (
    <div className="grid grid-cols-1 items-center gap-3 rounded-lg border border-[#1e2d45] bg-[#0d1929] px-4 py-3 lg:grid-cols-[200px_1fr_auto]">
      <div>
        <div className={`text-sm font-bold ${side === "LONG" ? "text-emerald-400" : "text-red-400"}`}>
          {symbol} {side}
        </div>
        <div className="text-[11px] text-slate-400">{SETUP_NAME[sig.strategy_id] || sig.strategy_id}</div>
        <div className="text-[10px] text-slate-500">
          #{sig.id} · {sig.created_at}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs">
        {cell("PE", fmtPrice(sig.entry, symbol))}
        {cell("SL", fmtPrice(sig.stop_loss, symbol), "text-red-400")}
        {sig.tp1 != null && cell("TP1", fmtPrice(sig.tp1, symbol), "text-emerald-400")}
        {cell(sig.tp1 != null ? "TP2" : "TP", fmtPrice(sig.take_profit, symbol), "text-emerald-400")}
        {cell("R:R", Number(sig.rr || 0).toFixed(2), "text-amber-300")}
        {sig.lot_suggested != null && cell("Lote", String(sig.lot_suggested))}
        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${state.cls}`}>{validated ? "VALIDADO NO JOURNAL" : state.label}</span>
        {Number(sig.executable) === 0 && (
          <span
            className="rounded border border-red-700 px-1.5 py-0.5 text-[10px] text-red-300"
            title={sig.max_stop != null ? `Stop máximo para o teu capital: ${fmtPrice(sig.max_stop, symbol)}` : undefined}
          >
            NÃO EXECUTÁVEL
          </span>
        )}
        {!valid && (
          <span className="rounded border border-red-700 px-1.5 py-0.5 text-[10px] text-red-300" title={errors.join(" ")}>
            NÍVEIS INVÁLIDOS
          </span>
        )}
      </div>
      <div className="flex gap-2">
        {sig.trade_id ? (
          <Link href={`/journal?id=${sig.trade_id}`} className="rounded border border-[#2d4a6b] bg-[#0a1929] px-3 py-1.5 text-xs text-sky-300 hover:bg-[#13243a]">
            Abrir no Journal
          </Link>
        ) : (
          <span className="cursor-not-allowed rounded border border-[#1e2d45] px-3 py-1.5 text-xs text-slate-600" title="Sinal antigo, sem linha no journal">
            Abrir no Journal
          </span>
        )}
        {valid && sig.status !== "invalidated" && sig.status !== "reversal" ? (
          <Link href={mesaHref} className="rounded border border-[#4af0c4] bg-[#0f4c3a] px-3 py-1.5 text-xs text-[#4af0c4] hover:bg-[#13604a]">
            Carregar na Mesa
          </Link>
        ) : (
          <span className="cursor-not-allowed rounded border border-[#1e2d45] px-3 py-1.5 text-xs text-slate-600">Carregar na Mesa</span>
        )}
      </div>
    </div>
  );
}

function StrategyCard({ st, asset, diag, now }: { st: StrategyInfo; asset: AssetStatus; diag?: AssetDiag; now?: number }) {
  const badge = cardBadge(st, asset, diag);
  const hours = st.utcHours ? `${String(st.utcHours[0]).padStart(2, "0")}h–${String(st.utcHours[1]).padStart(2, "0")}h UTC` : "24h";
  const beta = st.symbol === "XAUUSD" || asset.beta || asset.mode === "beta";
  const sourceNote =
    asset.disclaimer ||
    (beta
      ? "Cotação do agregador Twelve Data (XAU/USD), não da XTB. Pode divergir do xStation no spread; a entrada é sempre manual."
      : "Velas e spread em tempo real da Kraken.");
  return (
    <div id={st.id} className="flex scroll-mt-4 flex-col rounded-lg border border-[#1e2d45] bg-[#0d1929] p-4 target:border-[#4af0c4]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-slate-100">
            {st.symbol} · {SETUP_NAME[st.id] || st.name}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
            Fonte: {asset.source || "—"}
            <span className="cursor-help rounded-full border border-slate-600 px-1 text-[9px] text-slate-400" title={sourceNote}>
              i
            </span>
          </div>
        </div>
        <span className={`shrink-0 rounded border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${badge.cls}`}>{badge.label}</span>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded bg-[#0a1220] px-2 py-2">
          <dt className="text-[10px] text-slate-500">Horário</dt>
          <dd className="text-sm font-semibold text-slate-200">{hours}</dd>
        </div>
        <div className="rounded bg-[#0a1220] px-2 py-2">
          <dt className="text-[10px] text-slate-500">Sinais hoje</dt>
          <dd className="text-sm font-semibold text-slate-200">{diag?.signalsToday ?? 0}</dd>
        </div>
        <div className="rounded bg-[#0a1220] px-2 py-2">
          <dt className="text-[10px] text-slate-500">Último sinal</dt>
          <dd className="text-sm font-semibold text-slate-200">{diag?.lastSignalAt ? hhmm(diag.lastSignalAt) : "—"}</dd>
        </div>
      </dl>

      {st.steps && st.steps.length > 0 && (
        <ol className="mt-3 flex flex-wrap gap-1 text-[10px]">
          {st.steps.map((type, i) => {
            const done = diag ? i < diag.step : false;
            const current = diag ? i === diag.step : false;
            return (
              <li
                key={`${type}-${i}`}
                className={`rounded border px-1.5 py-0.5 ${
                  done ? "border-emerald-700 text-emerald-300" : current ? "border-amber-600 text-amber-300" : "border-slate-700 text-slate-500"
                }`}
              >
                {i + 1}. {STEP_LABELS[type] || type}
              </li>
            );
          })}
        </ol>
      )}

      <details className="group mt-3 border-t border-[#1e2d45] pt-2 text-[11px] text-slate-400">
        <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-300">Diagnóstico Técnico</summary>
        <div className="mt-2 space-y-1">
          <DiagBlock diag={diag} now={now} />
          {asset.pollPlan && <div>Polling: {asset.pollPlan}</div>}
          {asset.credits && (
            <div className={asset.credits.pct != null && asset.credits.pct >= 80 ? "text-amber-400" : ""}>
              Créditos TD hoje: {asset.credits.used ?? 0}/{asset.credits.limit ?? 800}
              {asset.credits.pct != null ? ` (${asset.credits.pct}%)` : ""}
            </div>
          )}
          {asset.bars && <div>Barras: {Object.entries(asset.bars).map(([k, v]) => `${k}=${v}`).join(" · ")}</div>}
          {asset.cacheBars && Object.keys(asset.cacheBars).length > 0 && (
            <div>Cache DB: {Object.entries(asset.cacheBars).map(([k, v]) => `${k}=${v}`).join(" · ")}</div>
          )}
          {asset.lastError && <div className="text-red-400">{asset.lastError}</div>}
        </div>
      </details>
    </div>
  );
}

/** Onde está a sequência e porque é que os últimos setups não deram sinal. */
function DiagBlock({ diag, now }: { diag?: AssetDiag; now?: number }) {
  if (!diag) return null;
  const stale = !diag.lastEvalAt || (now != null && now - diag.lastEvalAt > 5 * 60_000);
  const counts = Object.entries(diag.rejects?.counts || {}).sort((a, b) => b[1] - a[1]);
  return (
    <>
      {diag.idleReason ? (
        <div className="text-amber-400">Parado: {diag.idleReason}</div>
      ) : stale ? (
        <div className="text-amber-400">Sem avaliações desde {hhmm(diag.lastEvalAt)}: sem preços a chegar.</div>
      ) : (
        <div>
          Passo {Math.min(diag.step + 1, diag.totalSteps)}/{diag.totalSteps}: à espera de{" "}
          <span className="text-slate-200">{STEP_LABELS[diag.nextStepType || ""] || diag.nextStepType || "—"}</span> · avaliado às{" "}
          {hhmm(diag.lastEvalAt)}
          {diag.waitingReason && <div className="text-slate-500">Agora: {WAIT_LABELS[diag.waitingReason] || diag.waitingReason}</div>}
        </div>
      )}
      {diag.lastArmedAt ? <div className="text-amber-400">Último setup armado: {hhmm(diag.lastArmedAt)}</div> : null}
      {diag.lastReject && (
        <div>
          Último setup descartado às {hhmm(diag.lastReject.at)}:{" "}
          <span className="text-amber-400">{REJECT_LABELS[diag.lastReject.reason] || diag.lastReject.reason}</span>
        </div>
      )}
      {counts.length > 0 && (
        <div className="text-slate-500">Descartados hoje: {counts.map(([k, v]) => `${REJECT_LABELS[k] || k} ${v}`).join(" · ")}</div>
      )}
    </>
  );
}
