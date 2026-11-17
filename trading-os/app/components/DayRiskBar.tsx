"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { RISK_RULES, type DailyGuard } from "@/lib/risk";
import type { PropStatus } from "@/lib/prop-rules";

type Account = (DailyGuard & { equity: number }) | null;

/**
 * Barra do topo: só o estado de risco de hoje (P&L do dia, perda vs limite,
 * perdas seguidas). O histórico acumulado fica na Performance, não no ecrã de operar.
 */
export default function DayRiskBar() {
  const [account, setAccount] = useState<Account>(null);
  const [hasEquity, setHasEquity] = useState(true);
  const [prop, setProp] = useState<PropStatus[]>([]);

  useEffect(() => {
    // O capital vem das contas guardadas no servidor (prop firms e corretoras), não do browser.
    const load = () => {
      fetch("/api/session")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { account?: Account; prop?: PropStatus[] } | null) => {
          setHasEquity(!!d?.account && d.account.equity > 0);
          setAccount(d?.account ?? null);
          setProp(d?.prop ?? []);
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

  const propBreach = prop.find((p) => p.breached);
  const blocked = account.blocked || !!propBreach;
  const reason = account.blocked ? account.reason : propBreach?.reason;
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
      {prop.map((p) => {
        const dayPct = p.dailyLimit ? Math.max(0, p.dailyLimit - (p.dailyRemaining ?? 0)) / p.dailyLimit : 0;
        const tight = p.maxRiskMoney != null && p.dailyLimit ? p.maxRiskMoney < p.dailyLimit * 0.3 : false;
        return (
          <span
            key={p.account}
            title={[
              p.dailyFloor != null ? `Perda diária: faltam ${p.dailyRemaining} (mínimo de hoje ${p.dailyFloor})` : "",
              p.totalFloor != null ? `Perda total: faltam ${p.totalRemaining} (mínimo ${p.totalFloor})` : "",
              p.target != null ? `Profit target: ${p.profit} de ${p.target}` : "",
            ].filter(Boolean).join("\n")}
            style={{ display: "inline-flex", gap: 8, alignItems: "center" }}
          >
            <span style={{ color: "#94a3b8" }}>{p.account}</span>
            {p.dailyRemaining != null && (
              <span>
                dia <span style={{ color: p.breached || tight ? "#f87171" : dayPct > 0.5 ? "#fbbf24" : "#4ade80", fontWeight: 600 }}>{p.dailyRemaining.toFixed(0)}</span>
              </span>
            )}
            {p.totalRemaining != null && (
              <span>
                total <span style={{ color: "#94a3b8", fontWeight: 600 }}>{p.totalRemaining.toFixed(0)}</span>
              </span>
            )}
            {p.progressPct != null && (
              <span>
                target <span style={{ color: p.passed ? "#4ade80" : "#94a3b8", fontWeight: 600 }}>{p.progressPct.toFixed(1)}%</span>
              </span>
            )}
          </span>
        );
      })}
      <span
        title={reason || ""}
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
