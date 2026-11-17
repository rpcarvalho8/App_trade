"use client";

import { useState } from "react";
import { KIND_LABEL, type Account, type AccountCurrency, type AccountKind } from "@/lib/accounts";

const C = {
  card: "#0d1929",
  elevated: "#111827",
  border: "#1e2d45",
  muted: "#475569",
  secondary: "#94a3b8",
  accent: "#4af0c4",
  red: "#f87171",
  amber: "#fbbf24",
};

type Resp = { accounts?: Account[]; error?: string };

async function call(method: "PUT" | "DELETE", body: Record<string, unknown>): Promise<Resp> {
  const url = method === "DELETE" ? `/api/accounts?name=${encodeURIComponent(String(body.name))}` : "/api/accounts";
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "PUT" ? JSON.stringify(body) : undefined,
  });
  const d = (await r.json().catch(() => ({}))) as Resp;
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

/**
 * Conta do activo na Mesa + gestão das contas (prop firm ou corretora).
 * Mudar o activo de conta (ex.: SOL da Kraken para uma prop firm) é escolher outra conta no selector.
 */
export default function AccountsPanel({
  accounts,
  asset,
  onChange,
  alwaysOpen = false,
}: {
  accounts: Account[];
  /** Activo da Mesa (mostra o selector da conta). Sem activo: só a lista de contas. */
  asset?: string;
  onChange: (accounts: Account[]) => void;
  /** Página Contas: lista sempre aberta, sem o botão de abrir/fechar. */
  alwaysOpen?: boolean;
}) {
  const [openState, setOpen] = useState(false);
  const open = alwaysOpen || openState;
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState<{ name: string; kind: AccountKind; currency: AccountCurrency }>({
    name: "",
    kind: "prop",
    currency: "USD",
  });
  const current = asset ? accounts.find((a) => a.symbols.includes(asset)) ?? null : null;

  const run = (method: "PUT" | "DELETE", body: Record<string, unknown>) => {
    setErr("");
    call(method, body)
      .then((d) => d.accounts && onChange(d.accounts))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  };

  const assign = (name: string) => {
    const target = accounts.find((a) => a.name === name);
    if (!target || !asset) return;
    run("PUT", { name, symbols: [...target.symbols, asset] });
  };

  const sel = { background: C.elevated, color: C.secondary, border: `1px solid ${C.border}`, borderRadius: 4, padding: "4px 6px", fontSize: 11 };

  return (
    <div style={{ marginTop: 10, background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 11 }}>
      {(asset || !alwaysOpen) && (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {asset && (<>
        <span style={{ fontSize: 9, color: C.muted, letterSpacing: 1 }}>CONTA DO {asset}</span>
        <select value={current?.name ?? ""} onChange={(e) => assign(e.target.value)} style={sel}>
          {!current && <option value="">— sem conta —</option>}
          {accounts.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name} · {KIND_LABEL[a.kind]} · {a.currency}
            </option>
          ))}
        </select>
        </>)}
        {!alwaysOpen && (
        <button
          onClick={() => setOpen((o) => !o)}
          style={{ marginLeft: "auto", background: "transparent", color: C.accent, border: "none", cursor: "pointer", fontSize: 11 }}
        >
          {open ? "Fechar contas ▴" : "Gerir contas ▾"}
        </button>
        )}
      </div>
      )}

      {open && (
        <div style={{ marginTop: asset || !alwaysOpen ? 10 : 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {accounts.map((a) => (
            <div key={a.name}>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.7fr 1fr 1.2fr auto", gap: 6, alignItems: "center" }}>
              <span style={{ color: "#e2e8f0", fontWeight: 500 }}>{a.name}</span>
              <select value={a.kind} onChange={(e) => run("PUT", { name: a.name, kind: e.target.value })} style={sel}>
                <option value="prop">Prop firm</option>
                <option value="broker">Corretora</option>
              </select>
              <select value={a.currency} onChange={(e) => run("PUT", { name: a.name, currency: e.target.value })} style={sel}>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
              <input
                key={`${a.name}-${a.equity}`}
                type="number"
                step="1"
                defaultValue={a.equity || ""}
                placeholder="capital"
                onBlur={(e) => e.target.value !== String(a.equity || "") && run("PUT", { name: a.name, equity: Number(e.target.value) || 0 })}
                style={{ ...sel, width: "100%" }}
              />
              <span style={{ color: C.secondary }}>{a.symbols.length ? a.symbols.join(", ") : <span style={{ color: C.muted }}>sem activos</span>}</span>
              <button
                onClick={() => run("DELETE", { name: a.name })}
                disabled={a.symbols.length > 0}
                title={a.symbols.length ? "Passa os activos para outra conta antes de apagar" : "Apagar conta"}
                style={{ background: "transparent", border: "none", color: a.symbols.length ? C.muted : C.red, cursor: a.symbols.length ? "not-allowed" : "pointer" }}
              >
                ✕
              </button>
            </div>
            {a.kind === "prop" && <RulesRow account={a} onSave={(rules) => run("PUT", { name: a.name, rules })} />}
            </div>
          ))}
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.7fr auto", gap: 6, marginTop: 4 }}>
            <input value={draft.name} placeholder="Nova conta (ex.: FTMO)" onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={{ ...sel, width: "100%" }} />
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as AccountKind })} style={sel}>
              <option value="prop">Prop firm</option>
              <option value="broker">Corretora</option>
            </select>
            <select value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value as AccountCurrency })} style={sel}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
            <button
              disabled={!draft.name.trim()}
              onClick={() => {
                run("PUT", { ...draft, name: draft.name.trim(), symbols: [] });
                setDraft({ name: "", kind: "prop", currency: "USD" });
              }}
              style={{ background: C.accent, color: "#0a1220", border: "none", borderRadius: 4, padding: "4px 10px", fontSize: 11, cursor: "pointer", opacity: draft.name.trim() ? 1 : 0.5 }}
            >
              Adicionar
            </button>
          </div>
          <div style={{ fontSize: 9, color: C.muted }}>
            Cada activo pertence a uma só conta. Para passar a SOL para uma prop firm, cria a conta e escolhe-a na Mesa com SOLUSD activo (selector «Conta do SOLUSD»).
          </div>
        </div>
      )}
      {err && <div style={{ color: C.red, marginTop: 6 }}>{err}</div>}
    </div>
  );
}

/** Regras da prop firm (gravam ao sair de cada campo). Valores em % excepto tamanho, início do dia e hora. */
function RulesRow({ account: a, onSave }: { account: Account; onSave: (rules: Record<string, unknown>) => void }) {
  const field = (key: keyof Account, label: string, step = "any", width = 70) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 9, color: C.muted }}>
      {label}
      <input
        key={`${a.name}-${key}-${String(a[key] ?? "")}`}
        type="number"
        step={step}
        defaultValue={a[key] == null ? "" : String(a[key])}
        onBlur={(e) => {
          const v = e.target.value;
          if (v === String(a[key] ?? "")) return;
          onSave({ [key]: v === "" ? null : Number(v) });
        }}
        style={{ background: C.card, color: C.secondary, border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 5px", fontSize: 11, width }}
      />
    </label>
  );
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", margin: "4px 0 8px 12px", paddingLeft: 8, borderLeft: `2px solid ${C.border}` }}>
      {field("start_balance", "TAMANHO", "1", 80)}
      {field("daily_dd_pct", "DIÁRIO %", "0.1", 60)}
      {field("max_dd_pct", "TOTAL %", "0.1", 60)}
      <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 9, color: C.muted }}>
        TIPO TOTAL
        <select
          value={a.max_dd_type ?? "static"}
          onChange={(e) => onSave({ max_dd_type: e.target.value })}
          style={{ background: C.card, color: C.secondary, border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 5px", fontSize: 11 }}
        >
          <option value="static">Estático</option>
          <option value="trailing">Trailing</option>
        </select>
      </label>
      {field("profit_target_pct", "TARGET %", "0.1", 60)}
      {field("day_start_equity", "INÍCIO DO DIA", "0.01", 90)}
      {field("reset_hour_utc", "RESET (H UTC)", "1", 60)}
      <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 9, color: C.muted }}>
        FASE
        <input
          key={`${a.name}-phase-${a.phase ?? ""}`}
          defaultValue={a.phase ?? ""}
          onBlur={(e) => e.target.value !== (a.phase ?? "") && onSave({ phase: e.target.value })}
          style={{ background: C.card, color: C.secondary, border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 5px", fontSize: 11, width: 80 }}
        />
      </label>
    </div>
  );
}
