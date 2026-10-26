"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { RISK_RULES, type DailyGuard } from "@/lib/risk";

type Account = (DailyGuard & { equity: number }) | null;

/**
 * Barra do topo: só o estado de risco de hoje (P&L do dia, perda vs limite,
 * perdas seguidas). O histórico acumulado fica na Performance, não no ecrã de operar.
 */
export default function DayRiskBar() {
  const [account, setAccount] = useState<Account>(null);
  const [hasEquity, setHasEquity] = useState(true);

  useEffect(() => {
    let eq = "";
    try {
      eq = window.localStorage.getItem("tos_equity") || "";
    } catch {
      /* armazenamento indisponível */
    }
    const withEquity = Number(eq) > 0;
    const load = () => {
      fetch(withEquity ? `/api/session?equity=${encodeURIComponent(eq)}` : "/api/session")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { account?: Account } | null) => {
          setHasEquity(withEquity);
          setAccount(d?.account ?? null);
        })
        .catch(() => {});
    };
    load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, []);

  if (!hasEquity) {
    return (
      <Link href="/sessao" style={{ fontSize: 11, color: "#fbbf24", textDecoration: "none" }}>
        Define o capital da conta na Mesa para activar o travão diário
      </Link>
    );
  }
  if (!account) return null;

  const blocked = account.blocked;
  const pnlColor = account.dayPnl >= 0 ? "#4ade80" : "#f87171";
  return (
    <div style={{ display: "flex", gap: 18, fontSize: 11, color: "#64748b", alignItems: "center" }}>
      <span>
        Hoje <span style={{ color: pnlColor, fontWeight: 600 }}>{account.dayPnl.toFixed(2)}</span>
      </span>
      <span>
        Perda{" "}
        <span style={{ color: account.dayLossPct > 0 ? "#fbbf24" : "#94a3b8", fontWeight: 600 }}>
          {account.dayLossPct.toFixed(2)}% / {RISK_RULES.maxDailyLossPct}%
        </span>
      </span>
      <span>
        Perdas seguidas{" "}
        <span style={{ color: "#94a3b8", fontWeight: 600 }}>
          {account.consecutiveLosses} / {RISK_RULES.maxConsecutiveLosses}
        </span>
      </span>
      <span
        title={account.reason || ""}
        style={{
          padding: "3px 10px",
          borderRadius: 4,
          fontWeight: 700,
          letterSpacing: 1,
          color: blocked ? "#f87171" : "#4ade80",
          border: `1px solid ${blocked ? "#f87171" : "#4ade80"}55`,
          background: blocked ? "#3b1a1a" : "#052e16",
        }}
      >
        {blocked ? "DIA FECHADO" : "PODE OPERAR"}
      </span>
    </div>
  );
}
