"use client";
import { useEffect, useState } from "react";
import AccountsPanel from "@/app/components/AccountsPanel";
import { KIND_LABEL, type Account } from "@/lib/accounts";
import { propStatus } from "@/lib/prop-rules";

const C = { accent: "#4af0c4", green: "#4ade80", red: "#f87171", amber: "#fbbf24", muted: "#475569", secondary: "#94a3b8", border: "#1e2d45", card: "#0d1929" };

/** Contas (prop firm ou corretora), activos atribuídos e regras de cada prop firm. */
export default function ContasPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [now] = useState(() => Date.now());
  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { accounts?: Account[] } | null) => d?.accounts && setAccounts(d.accounts))
      .catch(() => {});
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1000 }}>
      <div>
        <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2 }}>CONFIGURAR</div>
        <div style={{ fontSize: 22, fontWeight: 600, color: C.accent }}>Contas e regras</div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
          Cada activo opera numa conta. Nas prop firms, as regras (perda diária, perda total, target) travam a Mesa.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {accounts.map((a) => {
          const st = propStatus(a, now);
          return (
            <div key={a.name} style={{ background: C.card, border: `1px solid ${st?.breached ? C.red : C.border}`, borderRadius: 8, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 14 }}>{a.name}</span>
                <span style={{ color: C.muted, fontSize: 10 }}>
                  {KIND_LABEL[a.kind]}
                  {a.phase ? ` · ${a.phase}` : ""} · {a.currency}
                </span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0", marginTop: 6 }}>{a.equity ? a.equity.toFixed(2) : "—"}</div>
              <div style={{ fontSize: 10, color: C.muted }}>{a.symbols.length ? a.symbols.join(", ") : "sem activos"}</div>
              {st && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 10, fontSize: 11 }}>
                  <div>
                    <div style={{ fontSize: 9, color: C.muted }}>DIA · FALTAM</div>
                    <div style={{ color: st.dailyRemaining != null && st.dailyRemaining <= 0 ? C.red : C.green, fontWeight: 600 }}>{st.dailyRemaining?.toFixed(2) ?? "—"}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: C.muted }}>TOTAL · FALTAM</div>
                    <div style={{ color: C.secondary, fontWeight: 600 }}>{st.totalRemaining?.toFixed(2) ?? "—"}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: C.muted }}>TARGET</div>
                    <div style={{ color: st.passed ? C.green : C.secondary, fontWeight: 600 }}>{st.progressPct != null ? `${st.progressPct.toFixed(1)}%` : "—"}</div>
                  </div>
                </div>
              )}
              {st?.reason && <div style={{ fontSize: 10, color: st.breached ? C.red : C.green, marginTop: 8 }}>{st.reason}</div>}
            </div>
          );
        })}
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1.5, marginBottom: 8 }}>EDITAR CONTAS E REGRAS</div>
        <AccountsPanel accounts={accounts} onChange={setAccounts} alwaysOpen />
        <div style={{ fontSize: 10, color: C.muted, marginTop: 10, lineHeight: 1.6 }}>
          O capital actualiza-se sozinho com o P&amp;L líquido das trades fechadas no journal. «Início do dia» é o equity com que a prop firm começou o dia
          (no dashboard da FundingPips, «Todays Starting Equity»); se não o preencheres, a app usa o capital no primeiro registo do dia.
        </div>
      </div>
    </div>
  );
}
