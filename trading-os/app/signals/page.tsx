"use client";
import { useEffect, useState } from "react";

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
};

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
          forceBeta
        />
        <AssetCard title="SOLUSD — SMC 3-Step" asset={sol} />
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
                <div style={{ fontSize: 11, color: C.secondary }}>
                  {sig.strategy_id} · R:R {Number(sig.rr || 0).toFixed(2)} · entry {sig.entry ?? "—"}
                </div>
                <div style={{ fontSize: 10, color: C.muted }}>{sig.created_at}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AssetCard({
  title,
  asset,
  forceBeta,
}: {
  title: string;
  asset: AssetStatus;
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
    </div>
  );
}
