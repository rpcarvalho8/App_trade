"use client";
import { useEffect, useState } from "react";
import { validateLevels } from "@/lib/risk";

const C = {
  accent: "#4af0c4",
  green: "#4ade80",
  red: "#f87171",
  amber: "#fbbf24",
  muted: "#475569",
  secondary: "#94a3b8",
  border: "#1e2d45",
  card: "#0d1929",
};

type AssetStatus = {
  status?: string;
  source?: string;
  beta?: boolean;
  mode?: string;
  label?: string;
  message?: string;
  disclaimer?: string;
  ready?: boolean;
  bars?: Record<string, number>;
  cacheBars?: Record<string, number>;
  lastError?: string;
  pollPlan?: string;
  credits?: {
    day?: string;
    used?: number;
    limit?: number;
    remaining?: number;
    pct?: number;
    byTf?: Record<string, number>;
  };
};

type AssetDiag = {
  lastEvalAt: number | null;
  idleReason: string | null;
  step: number;
  totalSteps: number;
  nextStepType: string | null;
  lastReject: { reason: string; at: number } | null;
  rejects: { day: string; counts: Record<string, number> };
  lastSignalAt: number | null;
};

const STEP_LABELS: Record<string, string> = {
  calendar_clean: "calendário sem notícias fortes",
  bias_h4: "bias H4 claro",
  liquidity_sweep: "sweep de liquidez",
  mss_cisd: "MSS / CISD",
  ob_or_fvg: "OB ou FVG no M5",
  choch_volume: "CHoCH com volume no M1",
  fvg_golden_ratio: "FVG na zona 0,618–0,786",
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
};

const hhmm = (ts: number | null | undefined) =>
  ts ? new Date(ts).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }) : "—";

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
  const xau: AssetStatus = data?.assets?.XAUUSD || {};
  const sol: AssetStatus = data?.assets?.SOLUSD || {};
  const signals: any[] = data?.signals || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2 }}>TRADING OS</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: C.accent }}>Motor de Sinais</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            Só alertas — sem execução automática. Estado:{" "}
            <span style={{ color: status === "ready" ? C.green : status === "error" ? C.red : C.amber }}>
              {status}
            </span>
          </div>
        </div>
        <button className="btn-ghost" onClick={load} style={{ fontSize: 11 }}>
          Atualizar
        </button>
      </div>

      {err && (
        <div style={{ background: "#3b1a1a", border: `1px solid ${C.red}55`, color: "#fca5a5", padding: "8px 12px", borderRadius: 6, fontSize: 12 }}>
          Falha a carregar: {err}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <AssetCard
          title="XAUUSD — London Structure"
          asset={xau}
          diag={data?.runner?.diag?.XAUUSD}
          now={data?.now}
          forceBeta
        />
        <AssetCard title="SOLUSD — SMC 3-Step" asset={sol} diag={data?.runner?.diag?.SOLUSD} now={data?.now} />
      </div>

      <div>
        <div style={{ fontSize: 11, color: C.muted, letterSpacing: 1, marginBottom: 10 }}>
          SINAIS RECENTES ({signals.length})
        </div>
        {signals.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 12, padding: 16, background: C.card, borderRadius: 8, border: `1px solid ${C.border}` }}>
            Ainda sem sinais emitidos. Em warming_up o XAUUSD não avalia confluences.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {signals.map((sig) => (
              <div
                key={sig.id}
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "12px 14px",
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: sig.direction === "long" ? C.green : C.red }}>
                  {String(sig.symbol)} {String(sig.direction).toUpperCase()}
                  {sig.symbol === "XAUUSD" && (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 9,
                        color: C.amber,
                        border: `1px solid ${C.amber}66`,
                        padding: "1px 6px",
                        borderRadius: 4,
                        letterSpacing: 0.5,
                      }}
                    >
                      BETA
                    </span>
                  )}
                </div>
                <SignalLevels sig={sig} />
                <div style={{ fontSize: 10, color: C.muted }}>{sig.created_at}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const fmtPrice = (v: unknown) => {
  const n = Number(v);
  return v == null || v === "" || !Number.isFinite(n) || n <= 0 ? "—" : n.toFixed(2);
};

/** Entrada, SL e TP de cada sinal — o que é preciso para pôr a ordem no MT5. */
function SignalLevels({ sig }: { sig: Record<string, unknown> }) {
  const side = String(sig.direction).toLowerCase() === "long" ? "LONG" : "SHORT";
  const entry = Number(sig.entry);
  const sl = Number(sig.stop_loss);
  const tp = Number(sig.take_profit);
  // Sinais antigos podem ter níveis em falta ou do lado errado: não servem para operar.
  const errors = validateLevels(side, entry, sl, tp);
  const risk = Math.abs(entry - sl);
  const cell = (label: string, value: string, color: string) => (
    <span style={{ whiteSpace: "nowrap" }}>
      <span style={{ color: C.muted }}>{label} </span>
      <span style={{ color, fontWeight: 600 }}>{value}</span>
    </span>
  );
  return (
    <div style={{ fontSize: 11, color: C.secondary, display: "flex", flexWrap: "wrap", gap: "4px 16px", alignItems: "center" }}>
      {cell("Entrada", fmtPrice(sig.entry), "#e2e8f0")}
      {cell("SL", fmtPrice(sig.stop_loss), C.red)}
      {cell("TP", fmtPrice(sig.take_profit), C.green)}
      {cell("R:R", Number(sig.rr || 0).toFixed(2), C.secondary)}
      {Number.isFinite(risk) && risk > 0 && cell("Risco", `${risk.toFixed(2)} USD/unid.`, C.muted)}
      {errors.length > 0 && (
        <span title={errors.join(" ")} style={{ color: C.red, fontSize: 10, border: `1px solid ${C.red}55`, padding: "1px 6px", borderRadius: 4 }}>
          INVÁLIDO — não operar
        </span>
      )}
      <span style={{ color: C.muted, fontSize: 10 }}>{String(sig.strategy_id)}</span>
    </div>
  );
}

/** Onde está a sequência e porque é que os últimos setups não deram sinal. */
function DiagBlock({ diag, now }: { diag?: AssetDiag; now?: number }) {
  if (!diag) return null;
  const stale = !diag.lastEvalAt || (now != null && now - diag.lastEvalAt > 5 * 60_000);
  const counts = Object.entries(diag.rejects?.counts || {}).sort((a, b) => b[1] - a[1]);
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}`, fontSize: 11, lineHeight: 1.6 }}>
      {diag.idleReason ? (
        <div style={{ color: C.amber }}>Parado: {diag.idleReason}</div>
      ) : stale ? (
        <div style={{ color: C.amber }}>Sem avaliações desde {hhmm(diag.lastEvalAt)}: sem preços a chegar.</div>
      ) : (
        <div style={{ color: C.secondary }}>
          Passo {Math.min(diag.step + 1, diag.totalSteps)}/{diag.totalSteps}: à espera de{" "}
          <span style={{ color: "#e2e8f0" }}>{STEP_LABELS[diag.nextStepType || ""] || diag.nextStepType || "—"}</span>
          <span style={{ color: C.muted }}> · avaliado às {hhmm(diag.lastEvalAt)}</span>
        </div>
      )}
      <div style={{ color: C.muted }}>Último sinal: {diag.lastSignalAt ? hhmm(diag.lastSignalAt) : "nenhum desde o arranque"}</div>
      {diag.lastReject && (
        <div style={{ color: C.muted }}>
          Último setup descartado às {hhmm(diag.lastReject.at)}:{" "}
          <span style={{ color: C.amber }}>{REJECT_LABELS[diag.lastReject.reason] || diag.lastReject.reason}</span>
        </div>
      )}
      {counts.length > 0 && (
        <div style={{ color: C.muted, fontSize: 10 }}>
          Descartados hoje: {counts.map(([k, v]) => `${REJECT_LABELS[k] || k} ${v}`).join(" · ")}
        </div>
      )}
    </div>
  );
}

function AssetCard({
  title,
  asset,
  diag,
  now,
  forceBeta,
}: {
  title: string;
  asset: AssetStatus;
  diag?: AssetDiag;
  now?: number;
  forceBeta?: boolean;
}) {
  const beta = forceBeta || asset.beta || asset.mode === "beta";
  const st = asset.status || "—";
  const stColor = st === "ready" ? C.green : st === "error" ? C.red : C.amber;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{title}</div>
        {beta && (
          <span
            title={
              asset.disclaimer ||
              "Cotação de agregador de mercado (Twelve Data), não da corretora — possível divergência de spread"
            }
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: 1,
              color: C.amber,
              background: "#2a1f08",
              border: `1px solid ${C.amber}66`,
              padding: "3px 8px",
              borderRadius: 4,
            }}
          >
            BETA / OBSERVAÇÃO
          </span>
        )}
      </div>
      {beta && (
        <div
          style={{
            fontSize: 10,
            color: C.amber,
            background: "#1a1508",
            border: `1px solid ${C.amber}33`,
            borderRadius: 6,
            padding: "8px 10px",
            marginBottom: 10,
            lineHeight: 1.5,
          }}
        >
          {asset.disclaimer ||
            "O preço/OHLC vem do agregador Twelve Data (XAU/USD), não diretamente da corretora XTB. Pode haver divergência de spread face ao xStation — a entrada continua manual."}
        </div>
      )}
      <div style={{ fontSize: 11, color: C.secondary, lineHeight: 1.6 }}>
        <div>
          Estado: <span style={{ color: stColor }}>{st}</span>
          {asset.label ? ` · ${asset.label}` : ""}
        </div>
        <div>Fonte: {asset.source || "—"}</div>
        {asset.message && <div style={{ color: C.muted, marginTop: 4 }}>{asset.message}</div>}
        {asset.pollPlan && (
          <div style={{ color: C.muted, marginTop: 4, fontSize: 10 }}>Poll: {asset.pollPlan}</div>
        )}
        {asset.credits && (
          <div style={{ color: asset.credits.pct != null && asset.credits.pct >= 80 ? C.amber : C.muted, marginTop: 4, fontSize: 10 }}>
            Créditos TD hoje: {asset.credits.used ?? 0}/{asset.credits.limit ?? 800}
            {asset.credits.pct != null ? ` (${asset.credits.pct}%)` : ""}
            {asset.credits.byTf
              ? ` · ${Object.entries(asset.credits.byTf)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(" ")}`
              : ""}
          </div>
        )}
        {asset.lastError && (
          <div style={{ color: C.red, marginTop: 6, fontSize: 10 }}>{asset.lastError}</div>
        )}
        {asset.bars && (
          <div style={{ marginTop: 8, fontSize: 10, color: C.muted }}>
            Barras:{" "}
            {Object.entries(asset.bars)
              .map(([k, v]) => `${k}=${v}`)
              .join(" · ")}
          </div>
        )}
        {asset.cacheBars && Object.keys(asset.cacheBars).length > 0 && (
          <div style={{ marginTop: 4, fontSize: 10, color: C.muted }}>
            Cache DB:{" "}
            {Object.entries(asset.cacheBars)
              .map(([k, v]) => `${k}=${v}`)
              .join(" · ")}
          </div>
        )}
      </div>
      <DiagBlock diag={diag} now={now} />
    </div>
  );
}
