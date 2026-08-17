"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  PLAYBOOKS,
  calcRR,
  sizeForEquity,
  type SessionAsset,
  type AssetPlaybook,
} from "@/lib/playbooks";

const C = {
  accent: "#4af0c4",
  green: "#4ade80",
  red: "#f87171",
  amber: "#fbbf24",
  blue: "#60a5fa",
  purple: "#c084fc",
  muted: "#475569",
  secondary: "#94a3b8",
  border: "#1e2d45",
  card: "#0d1929",
  elevated: "#111827",
};

type Check = "pending" | "yes" | "no";
type Verdict = "AUTHORIZED" | "WAIT" | "REJECT" | "CLOSED";

function fmtPrice(v: number | null | undefined, asset: SessionAsset) {
  if (v == null || !Number.isFinite(v)) return "—";
  return asset === "XAUUSD"
    ? v.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : v.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function emptyChecks(pb: AssetPlaybook): Record<string, Check> {
  return Object.fromEntries(pb.steps.map((s) => [s.id, "pending"])) as Record<string, Check>;
}

type SessionCtx = {
  date: string;
  prices: Record<string, number | null>;
  calendar: {
    upcomingHigh: Array<{ title: string; country: string; minutesUntil: number | null }>;
    blackoutAll: boolean;
    blackoutUSD: boolean;
  };
  byAsset: Record<SessionAsset, {
    count: number;
    pnl: number;
    lossRisk: number;
    consecutiveLosses: number;
    hitMaxTrades: boolean;
    hitDD: boolean;
    needPause: boolean;
    closed: boolean;
  }>;
};

export default function SessaoPage() {
  const [asset, setAsset] = useState<SessionAsset>("XAUUSD");
  const pb = PLAYBOOKS[asset];
  const [checks, setChecks] = useState<Record<string, Check>>(() => emptyChecks(PLAYBOOKS.XAUUSD));
  const [direction, setDirection] = useState<"LONG" | "SHORT">("LONG");
  const [entry, setEntry] = useState("");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [riskPct, setRiskPct] = useState(String(PLAYBOOKS.XAUUSD.defaultRiskPct));
  const [equity, setEquity] = useState("10000");
  const [sleepHours, setSleepHours] = useState("7");
  const [stress, setStress] = useState("3");
  const [grade, setGrade] = useState("B");
  const [outcome, setOutcome] = useState<"RUNNING" | "WIN" | "LOSS" | "BE">("RUNNING");
  const [exitPrice, setExitPrice] = useState("");
  const [pnl, setPnl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [savedId, setSavedId] = useState<number | null>(null);
  const [ctx, setCtx] = useState<SessionCtx | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const applyCtx = (d: SessionCtx) => {
    setCtx(d);
    setErr("");
    setLoading(false);
  };

  const load = (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    fetch("/api/session")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SessionCtx>;
      })
      .then(applyCtx)
      .catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  };

  useEffect(() => {
    fetch("/api/session")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SessionCtx>;
      })
      .then((d) => {
        applyCtx(d);
        const eq = window.localStorage.getItem("tos_equity");
        if (eq) setEquity(eq);
      })
      .catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, []);

  const switchAsset = (a: SessionAsset) => {
    const next = PLAYBOOKS[a];
    setAsset(a);
    setChecks(emptyChecks(next));
    setRiskPct(String(next.defaultRiskPct));
    setEntry("");
    setSl("");
    setTp("");
    setOutcome("RUNNING");
    setExitPrice("");
    setPnl("");
    setSaveMsg("");
    setSavedId(null);
  };

  const nEntry = Number(entry);
  const nSl = Number(sl);
  const nTp = Number(tp);
  const nRisk = Number(riskPct);
  const nEquity = Number(equity);
  const rr = calcRR(direction, nEntry, nSl, nTp);
  const size = sizeForEquity(nEquity, nRisk, nEntry, nSl);
  const rrOk = rr != null && rr >= pb.minRR;

  const blackout = asset === "XAUUSD" ? !!ctx?.calendar?.blackoutUSD : !!ctx?.calendar?.blackoutAll;
  const day = ctx?.byAsset?.[asset];
  const mentalClosed = Number(sleepHours) < 6 || Number(stress) > 7 || grade === "D";
  const sessionClosed = !!day?.closed || mentalClosed;

  const autoChecks = useMemo(() => {
    const next = { ...checks };
    for (const step of pb.steps) {
      if (step.kind === "news") {
        if (blackout) next[step.id] = "no";
      }
      if (step.kind === "rr") {
        if (rrOk) next[step.id] = "yes";
        else if (rr != null && rr < pb.minRR) next[step.id] = "no";
      }
    }
    return next;
  }, [checks, pb, blackout, rr, rrOk]);

  const firstBlockedIdx = pb.steps.findIndex((_, i) => {
    if (i === 0) return false;
    return autoChecks[pb.steps[i - 1].id] !== "yes";
  });

  const anyNo = pb.steps.some((s, i) => {
    if (firstBlockedIdx >= 0 && i > firstBlockedIdx) return false;
    return autoChecks[s.id] === "no";
  });
  const allYes = pb.steps.every((s) => autoChecks[s.id] === "yes");

  let verdict: Verdict = "WAIT";
  if (sessionClosed) verdict = "CLOSED";
  else if (anyNo) verdict = "REJECT";
  else if (allYes && rrOk && !day?.needPause) verdict = "AUTHORIZED";

  const setCheck = (id: string, v: Check) => {
    const step = pb.steps.find((s) => s.id === id);
    if (step?.kind === "news" && blackout && v === "yes") return;
    setChecks((c) => ({ ...c, [id]: v }));
  };

  const saveTrade = async () => {
    if (verdict !== "AUTHORIZED") return;
    if (!entry || !sl || !tp) {
      setSaveMsg("Preenche entrada, stop e take profit na calculadora.");
      return;
    }
    setSaving(true);
    setSaveMsg("");
    const sleepQ = Math.min(10, Math.max(1, Math.round(Number(sleepHours) || 7)));
    const stressN = Math.min(10, Math.max(1, Math.round(Number(stress) || 3)));
    const stepsDone = pb.steps
      .filter((s) => autoChecks[s.id] === "yes")
      .map((s, i) => `${i + 1}. ${s.label}`)
      .join(" | ");
    const payload = {
      date: ctx?.date || new Date().toISOString().slice(0, 10),
      pair: asset,
      direction,
      setup: pb.setupName,
      session: pb.defaultSession,
      entry: nEntry,
      stop_loss: nSl,
      take_profit: nTp,
      exit_price: outcome === "RUNNING" || !exitPrice ? null : Number(exitPrice),
      risk_percent: nRisk || pb.defaultRiskPct,
      pnl: outcome === "RUNNING" ? 0 : Number(pnl || 0),
      rr_planned: rr != null ? Number(rr.toFixed(2)) : null,
      rr_real: outcome === "RUNNING" ? null : (rr != null ? Number(rr.toFixed(2)) : null),
      outcome,
      htf_bias: direction === "LONG" ? "Bullish" : "Bearish",
      confluences: `${asset} · ${pb.title}`,
      entry_reason: `Mesa de Operação — passos confirmados: ${stepsDone}`,
      shock_timeframe: asset === "XAUUSD" ? "M5" : "M1",
      management: pb.management.join(" "),
      tags: "sessao,autorizado",
      mental_state: grade,
      followed_plan: 1,
      sleep_quality: sleepQ,
      fatigue_level: sleepQ <= 6 ? 7 : 3,
      stress_level: stressN,
      anxiety_level: stressN,
      focus_level: stressN >= 7 ? 4 : 7,
      confidence_level: grade === "A" ? 8 : grade === "B" ? 6 : 4,
      emotional_state: grade === "A" || grade === "B" ? "Calmo e focado" : "Normal",
      pre_session_notes: `Sono ${sleepHours}h · stress ${stress}/10 · nota ${grade}`,
    };
    try {
      const r = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({})) as { id?: number; error?: string };
      if (!r.ok) {
        setSaveMsg("Erro a guardar: " + (d.error || r.status));
      } else {
        setSavedId(typeof d.id === "number" ? d.id : null);
        setSaveMsg("Trade gravado no journal.");
        setChecks(emptyChecks(pb));
        setOutcome("RUNNING");
        setExitPrice("");
        setPnl("");
        load(false);
      }
    } catch (e: unknown) {
      setSaveMsg("Erro de rede: " + (e instanceof Error ? e.message : String(e)));
    }
    setSaving(false);
  };

  const upcoming = ctx?.calendar?.upcomingHigh || [];
  const price = ctx?.prices?.[asset];

  const verdictUI = {
    AUTHORIZED: { label: "AUTORIZADO A ENTRAR", color: C.green, bg: "#052e16", hint: "Todos os passos estão verdes. Entra na corretora e carrega em Guardar no journal — o registo é criado já com estes dados." },
    WAIT: { label: "ESPERAR", color: C.amber, bg: "#451a03", hint: "Lê o que fazer em cada passo. Só marcas SIM quando for verdade no gráfico — não antecipes." },
    REJECT: { label: "REJEITAR", color: C.red, bg: "#3b1a1a", hint: "Um passo falhou. Não há trade. Esperas o próximo setup deste activo." },
    CLOSED: { label: "SESSÃO FECHADA", color: C.red, bg: "#3b1a1a", hint: day?.hitMaxTrades ? "Já fizeste o máximo de trades deste activo hoje." : day?.hitDD ? "O limite de perdas do dia neste activo foi atingido." : mentalClosed ? "Sono, stress ou nota mental fora das regras." : "A sessão deste activo está encerrada." },
  }[verdict];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: 2 }}>TRADING OS</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: C.accent }}>Mesa de Operação</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Um activo, um guião. Cada passo diz o que fazer no gráfico e quando marcar SIM ou NÃO.</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {(["XAUUSD", "SOLUSD"] as SessionAsset[]).map((a) => (
            <button
              key={a}
              onClick={() => switchAsset(a)}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                border: `1px solid ${asset === a ? (a === "XAUUSD" ? C.amber : C.purple) : C.border}`,
                background: asset === a ? (a === "XAUUSD" ? "#3b2a05" : "#2e1064") : C.card,
                color: asset === a ? (a === "XAUUSD" ? C.amber : C.purple) : C.secondary,
              }}
            >
              {a}
            </button>
          ))}
          <button onClick={() => load(true)} style={{ background: C.elevated, color: C.secondary, border: `1px solid ${C.border}`, padding: "8px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>
            Atualizar
          </button>
        </div>
      </div>

      {err && (
        <div style={{ background: "#3b1a1a", border: `1px solid ${C.red}55`, color: "#fca5a5", padding: "10px 14px", borderRadius: 8, fontSize: 12 }}>
          Falha a carregar contexto de sessão: {err}. Os gates manuais continuam utilizáveis.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr", gap: 12 }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1.5, marginBottom: 8 }}>GUIÃO DE HOJE</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0" }}>{pb.title}</div>
          <div style={{ fontSize: 11, color: C.secondary, marginTop: 4, lineHeight: 1.5 }}>{pb.tagline}</div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 10 }}>{pb.sessionWindow}</div>
          <div style={{ fontSize: 10, color: C.accent, marginTop: 4 }}>{pb.timeframes}</div>
          <div style={{ display: "flex", gap: 14, marginTop: 12, fontSize: 11 }}>
            <span style={{ color: C.secondary }}>R:R ≥ <b style={{ color: C.amber }}>{pb.minRR}</b></span>
            <span style={{ color: C.secondary }}>Max trades <b style={{ color: "#e2e8f0" }}>{pb.maxTrades}</b></span>
            <span style={{ color: C.secondary }}>DD <b style={{ color: C.red }}>{pb.maxDailyDD}%</b></span>
          </div>
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1.5, marginBottom: 8 }}>CONTEXTO</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0" }}>{loading ? "…" : fmtPrice(price, asset)}</div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{asset} spot</div>
          {asset === "SOLUSD" && ctx?.prices?.BTCUSD != null && (
            <div style={{ fontSize: 10, color: C.secondary, marginTop: 6 }}>BTC {fmtPrice(ctx.prices.BTCUSD, "XAUUSD")}</div>
          )}
          <div style={{ marginTop: 10, fontSize: 11, color: blackout ? C.red : C.green }}>
            {blackout ? "BLOQUEIO — notícia forte nos próximos 30 min" : "Calendário: sem notícia forte nos próximos 30 min"}
          </div>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            {upcoming.slice(0, 3).map((e, i) => (
              <div key={i} style={{ fontSize: 10, color: C.secondary }}>
                <span style={{ color: C.amber }}>{e.country}</span> {e.title}
                {e.minutesUntil != null && (
                  <span style={{ color: C.muted }}> · {Math.round(e.minutesUntil)} min</span>
                )}
              </div>
            ))}
            {upcoming.length === 0 && !loading && (
              <div style={{ fontSize: 10, color: C.muted }}>Sem notícias fortes restantes hoje.</div>
            )}
          </div>
        </div>

        <div style={{ background: sessionClosed ? "#3b1a1a" : C.card, border: `1px solid ${sessionClosed ? C.red + "66" : C.border}`, borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1.5, marginBottom: 8 }}>LIMITE DO DIA</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
            <div>
              <div style={{ fontSize: 9, color: C.muted }}>TRADES</div>
              <div style={{ color: day?.hitMaxTrades ? C.red : "#e2e8f0", fontWeight: 700 }}>{day?.count ?? 0}/{pb.maxTrades}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: C.muted }}>PERDAS SEGUIDAS</div>
              <div style={{ color: day?.needPause ? C.red : "#e2e8f0", fontWeight: 700 }}>{day?.consecutiveLosses ?? 0}/{pb.pauseAfterLosses}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: C.muted }}>PERDAS DO DIA (risco)</div>
              <div style={{ color: day?.hitDD ? C.red : "#e2e8f0", fontWeight: 700 }}>{Number(day?.lossRisk || 0).toFixed(1)}% / {pb.maxDailyDD}%</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: C.muted }}>P&amp;L DIA</div>
              <div style={{ color: Number(day?.pnl || 0) >= 0 ? C.green : C.red, fontWeight: 700 }}>${Number(day?.pnl || 0).toFixed(0)}</div>
            </div>
          </div>
          {day?.needPause && !day?.closed && (
            <div style={{ fontSize: 10, color: C.amber, marginTop: 10 }}>Pausa de {pb.pauseMinutes} min depois de {pb.pauseAfterLosses} perdas seguidas.</div>
          )}
        </div>
      </div>

      <div style={{ background: verdictUI.bg, border: `1px solid ${verdictUI.color}55`, borderRadius: 10, padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: verdictUI.color, letterSpacing: 1 }}>{verdictUI.label}</div>
          <div style={{ fontSize: 12, color: C.secondary, marginTop: 4 }}>{verdictUI.hint}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setChecks(emptyChecks(pb))}
            style={{ background: "transparent", color: C.muted, border: `1px solid ${C.border}`, padding: "8px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer" }}
          >
            Reset checklist
          </button>
          {verdict === "AUTHORIZED" ? (
            <button
              onClick={saveTrade}
              disabled={saving}
              style={{ background: "#14532d", color: C.green, border: `1px solid ${C.green}`, padding: "8px 16px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: saving ? "wait" : "pointer" }}
            >
              {saving ? "A guardar…" : "Guardar no journal"}
            </button>
          ) : (
            <span style={{ background: C.elevated, color: C.muted, border: `1px solid ${C.border}`, padding: "8px 16px", borderRadius: 6, fontSize: 12 }}>
              Journal bloqueado até autorização
            </span>
          )}
        </div>
      </div>

      {(saveMsg || savedId) && (
        <div style={{
          background: savedId ? "#052e16" : "#3b1a1a",
          border: `1px solid ${savedId ? C.green + "55" : C.red + "55"}`,
          color: savedId ? C.green : "#fca5a5",
          padding: "10px 14px",
          borderRadius: 8,
          fontSize: 12,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}>
          <span>{saveMsg}{savedId ? ` (#${savedId})` : ""}</span>
          {savedId && (
            <Link href="/journal" style={{ color: C.accent, fontSize: 12 }}>
              Abrir journal (capturas e revisão) →
            </Link>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr", gap: 16 }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1.5, marginBottom: 14 }}>LISTA DE PASSOS — SÓ AVANÇAS DEPOIS DE MARCAR SIM NO ANTERIOR</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {pb.steps.map((step, i) => {
              const locked = i > 0 && autoChecks[pb.steps[i - 1].id] !== "yes";
              const val = autoChecks[step.id];
              const newsLockedYes = step.kind === "news" && blackout;
              return (
                <div
                  key={step.id}
                  style={{
                    opacity: locked ? 0.4 : 1,
                    border: `1px solid ${val === "yes" ? C.green + "55" : val === "no" ? C.red + "55" : C.border}`,
                    background: val === "yes" ? "#052e1622" : val === "no" ? "#3b1a1a22" : C.elevated,
                    borderRadius: 8,
                    padding: 12,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                    <div style={{ display: "flex", gap: 10, minWidth: 0 }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                        border: `1px solid ${val === "yes" ? C.green : val === "no" ? C.red : C.accent}`,
                        color: val === "yes" ? C.green : val === "no" ? C.red : C.accent,
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700,
                      }}>{i + 1}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", lineHeight: 1.35 }}>{step.label}</div>
                        <div style={{ fontSize: 10, color: C.accent, marginTop: 6 }}>Onde: {step.chart}</div>
                        <div style={{ fontSize: 12, color: C.secondary, marginTop: 6, lineHeight: 1.55 }}>
                          <span style={{ color: "#e2e8f0", fontWeight: 600 }}>O que fazer. </span>{step.do}
                        </div>
                        <div style={{ fontSize: 11, color: C.green, marginTop: 8, lineHeight: 1.5 }}>
                          <span style={{ fontWeight: 700 }}>Marca SIM se: </span>{step.yesIf}
                        </div>
                        <div style={{ fontSize: 11, color: "#fca5a5", marginTop: 4, lineHeight: 1.5 }}>
                          <span style={{ fontWeight: 700 }}>Marca NÃO se: </span>{step.noIf}
                        </div>
                        {newsLockedYes && <div style={{ fontSize: 11, color: C.red, marginTop: 8 }}>Bloqueado: há uma notícia de alto impacto nos próximos 30 minutos.</div>}
                        {step.kind === "rr" && rr != null && (
                          <div style={{ fontSize: 11, color: rrOk ? C.green : C.red, marginTop: 8 }}>
                            Resultado da calculadora: 1:{rr.toFixed(2)} {rrOk ? "(atinge o mínimo)" : `(abaixo do mínimo ${pb.minRR})`}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      {(["yes", "no"] as Check[]).map((opt) => (
                        <button
                          key={opt}
                          disabled={locked || (opt === "yes" && newsLockedYes)}
                          onClick={() => setCheck(step.id, val === opt ? "pending" : opt)}
                          style={{
                            padding: "5px 10px",
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: locked ? "not-allowed" : "pointer",
                            border: `1px solid ${opt === "yes" ? C.green : C.red}`,
                            background: val === opt ? (opt === "yes" ? "#14532d" : "#7f1d1d") : "transparent",
                            color: opt === "yes" ? C.green : C.red,
                          }}
                        >
                          {opt === "yes" ? "SIM" : "NÃO"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1.5, marginBottom: 12 }}>CALCULADORA R:R / SIZE</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>DIRECÇÃO</div>
                <select value={direction} onChange={(e) => setDirection(e.target.value as "LONG" | "SHORT")} style={{ width: "100%" }}>
                  <option value="LONG">LONG</option>
                  <option value="SHORT">SHORT</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>RISCO %</div>
                <input type="number" step="0.1" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} style={{ width: "100%" }} />
              </div>
              <div>
                <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>ENTRADA</div>
                <input type="number" step="any" value={entry} onChange={(e) => setEntry(e.target.value)} style={{ width: "100%" }} />
              </div>
              <div>
                <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>STOP LOSS</div>
                <input type="number" step="any" value={sl} onChange={(e) => setSl(e.target.value)} style={{ width: "100%" }} />
              </div>
              <div>
                <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>TAKE PROFIT</div>
                <input type="number" step="any" value={tp} onChange={(e) => setTp(e.target.value)} style={{ width: "100%" }} />
              </div>
              <div>
                <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>CAPITAL ($)</div>
                <input type="number" step="100" value={equity} onChange={(e) => {
                  setEquity(e.target.value);
                  window.localStorage.setItem("tos_equity", e.target.value);
                }} style={{ width: "100%" }} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
              <div style={{ background: C.elevated, borderRadius: 6, padding: 10, border: `1px solid ${rrOk ? C.green + "44" : C.border}` }}>
                <div style={{ fontSize: 9, color: C.muted }}>R:R</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: rr == null ? C.muted : rrOk ? C.green : C.red }}>
                  {rr == null ? "—" : `1:${rr.toFixed(2)}`}
                </div>
                <div style={{ fontSize: 9, color: C.muted }}>mínimo {pb.minRR}</div>
              </div>
              <div style={{ background: C.elevated, borderRadius: 6, padding: 10, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 9, color: C.muted }}>SIZE (unidades)</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>
                  {size == null ? "—" : size.toLocaleString("pt-PT", { maximumFractionDigits: 4 })}
                </div>
                <div style={{ fontSize: 9, color: C.muted }}>{nRisk}% de ${nEquity || 0}</div>
              </div>
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1.5, marginBottom: 8 }}>RESULTADO AO GRAVAR</div>
              <div style={{ display: "grid", gridTemplateColumns: outcome === "RUNNING" ? "1fr" : "1fr 1fr 1fr", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>ESTADO</div>
                  <select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)} style={{ width: "100%" }}>
                    <option value="RUNNING">Ainda em curso</option>
                    <option value="WIN">Ganho</option>
                    <option value="LOSS">Perda</option>
                    <option value="BE">Break-even</option>
                  </select>
                </div>
                {outcome !== "RUNNING" && (
                  <>
                    <div>
                      <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>SAÍDA</div>
                      <input type="number" step="any" value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} style={{ width: "100%" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>P&amp;L ($)</div>
                      <input type="number" step="any" value={pnl} onChange={(e) => setPnl(e.target.value)} style={{ width: "100%" }} />
                    </div>
                  </>
                )}
              </div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
                Grava-se {asset}, {pb.setupName}, {direction}, entrada/stop/alvo, rácio e «seguiu o plano». Capturas de ecrã podes acrescentar depois no journal.
              </div>
            </div>
          </div>

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1.5, marginBottom: 12 }}>ESTADO PARA OPERAR</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div>
                <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>SONO (h)</div>
                <input type="number" step="0.5" value={sleepHours} onChange={(e) => setSleepHours(e.target.value)} style={{ width: "100%" }} />
              </div>
              <div>
                <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>STRESS 1–10</div>
                <input type="number" min="1" max="10" value={stress} onChange={(e) => setStress(e.target.value)} style={{ width: "100%" }} />
              </div>
              <div>
                <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>GRADE</div>
                <select value={grade} onChange={(e) => setGrade(e.target.value)} style={{ width: "100%" }}>
                  {["A", "B", "C", "D"].map((g) => <option key={g}>{g}</option>)}
                </select>
              </div>
            </div>
            {mentalClosed && (
              <div style={{ fontSize: 11, color: C.red, marginTop: 10 }}>Sessão fechada: menos de 6 horas de sono, stress acima de 7, ou nota D.</div>
            )}
          </div>

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1.5, marginBottom: 8 }}>GESTÃO (depois de entrares)</div>
            {pb.management.map((m) => (
              <div key={m} style={{ fontSize: 11, color: C.secondary, lineHeight: 1.6 }}>• {m}</div>
            ))}
            <div style={{ fontSize: 9, color: C.red, letterSpacing: 1.5, margin: "12px 0 6px" }}>SAI / NÃO ENTRES SE</div>
            {pb.invalidation.map((m) => (
              <div key={m} style={{ fontSize: 11, color: "#fca5a5", lineHeight: 1.6 }}>• {m}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
