"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  PLAYBOOKS,
  STRATEGY_PLAYBOOKS,
  calcRR,
  initialChecks,
  playbooksForAsset,
  stepsFor,
  type SessionAsset,
  type AssetPlaybook,
} from "@/lib/playbooks";
import {
  INSTRUMENTS,
  RISK_RULES,
  positionSize,
  realizedR,
  suggestTakeProfit,
  validateLevels,
  type DailyGuard,
} from "@/lib/risk";
import { accountForSymbolIn, KIND_LABEL, usdPerAccountUnit, type Account } from "@/lib/accounts";
import AccountsPanel from "@/app/components/AccountsPanel";
import { propRiskBlock, propStatus } from "@/lib/prop-rules";

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
  return initialChecks(pb, false);
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
  account: (DailyGuard & { equity: number }) | null;
};

const readLocal = (key: string, fallback: string) => {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};
const writeLocal = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* armazenamento indisponível */
  }
};

export default function SessaoPage() {
  const [asset, setAsset] = useState<SessionAsset>("XAUUSD");
  /** Estratégia do motor cuja lista de passos a Mesa mostra. */
  const [strategyId, setStrategyId] = useState(PLAYBOOKS.XAUUSD.strategyId);
  /** Sinal do motor que abriu a Mesa ("Carregar na Mesa"): { sinal, linha pendente no journal }. */
  const [fromSignal, setFromSignal] = useState<{ id: number; tradeId: number | null } | null>(null);
  const pb = STRATEGY_PLAYBOOKS[strategyId] || PLAYBOOKS[asset];
  const steps = stepsFor(pb, !!fromSignal);
  const [checks, setChecks] = useState<Record<string, Check>>(() => emptyChecks(PLAYBOOKS.XAUUSD));
  const [direction, setDirection] = useState<"LONG" | "SHORT">("LONG");
  const [entry, setEntry] = useState("");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [riskPct, setRiskPct] = useState(String(PLAYBOOKS.XAUUSD.defaultRiskPct));
  const [equity, setEquity] = useState("");
  /** Quantos USD vale 1 unidade da moeda da conta (1 se a conta for em USD). */
  const [usdPerUnit, setUsdPerUnit] = useState("1");
  /** Contas (prop firm ou corretora) guardadas no servidor (/api/accounts) e EUR/USD automático. */
  const [accounts, setAccounts] = useState<Account[]>([]);
  /** Relógio para o dia da prop firm (reset diário); actualiza a cada minuto. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const [eurusd, setEurusd] = useState<number | null>(null);
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
  /** Passo cujo guião está aberto além do passo actual (clique no nome do passo). */
  const [openStepId, setOpenStepId] = useState<string | null>(null);

  const applyCtx = (d: SessionCtx) => {
    setCtx(d);
    setErr("");
    setLoading(false);
  };

  const sessionUrl = (eq: string, fx?: string) => {
    const q = new URLSearchParams();
    if (Number(eq) > 0) q.set("equity", eq);
    if (Number(fx) > 0) q.set("usd_per_unit", String(fx));
    const qs = q.toString();
    return qs ? `/api/session?${qs}` : "/api/session";
  };

  const load = (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    fetch(sessionUrl(equity, usdPerUnit))
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

  // Capital e câmbio da conta a que este activo está atribuído (ex.: ouro → FundingPips, SOL → Kraken).
  const acct = accountForSymbolIn(accounts, asset);
  useEffect(() => {
    if (!acct) return;
    setEquity(acct.equity > 0 ? String(acct.equity) : "");
    setUsdPerUnit(String(Number(usdPerAccountUnit(acct.currency, eurusd).toFixed(4))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, acct?.equity, acct?.currency, eurusd]);

  const saveEquity = (value: string) => {
    const n = Number(value);
    if (!acct || !(n >= 0) || value === "") return;
    fetch("/api/accounts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: acct.name, equity: n }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { accounts?: Account[] } | null) => {
        if (d?.accounts) setAccounts(d.accounts);
      })
      .catch(() => {});
  };

  useEffect(() => {
    // O capital vem das contas no servidor (efeito acima), não do browser.
    const eq = "";
    fetch("/api/accounts")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { accounts?: Account[]; eurusd?: number | null } | null) => {
        if (!d?.accounts) return;
        setEurusd(d.eurusd ?? null);
        setAccounts(d.accounts);
      })
      .catch(() => {});
    const fx = readLocal("tos_usd_per_unit", "1");
    // "Carregar na Mesa" (/signals): /sessao?asset=XAUUSD&dir=LONG&entry=…&sl=…&tp=…
    const qp = new URLSearchParams(window.location.search);
    const qAsset = qp.get("asset");
    if (qAsset === "XAUUSD" || qAsset === "SOLUSD") {
      const qSignal = Number(qp.get("signal")) || null;
      const qTrade = Number(qp.get("trade")) || null;
      const qStrategy = qp.get("strategy") || "";
      const sid = STRATEGY_PLAYBOOKS[qStrategy]?.asset === qAsset ? qStrategy : PLAYBOOKS[qAsset].strategyId;
      switchStrategy(sid, qSignal ? { id: qSignal, tradeId: qTrade } : null);
      const qDir = (qp.get("dir") || "").toUpperCase();
      if (qDir === "LONG" || qDir === "SHORT") setDirection(qDir);
      if (qp.get("entry")) setEntry(String(qp.get("entry")));
      if (qp.get("sl")) setSl(String(qp.get("sl")));
      if (qp.get("tp")) setTp(String(qp.get("tp")));
    }
    const restore = () => {
      setUsdPerUnit(fx);
    };
    fetch(sessionUrl(eq, fx))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SessionCtx>;
      })
      .then((d) => {
        restore();
        applyCtx(d);
      })
      .catch((e: unknown) => {
        restore();
        setErr(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, []);

  const switchAsset = (a: SessionAsset) => switchStrategy(playbooksForAsset(a)[0].strategyId, null);

  const switchStrategy = (sid: string, signal: { id: number; tradeId: number | null } | null) => {
    const next = STRATEGY_PLAYBOOKS[sid];
    if (!next) return;
    setAsset(next.asset);
    setStrategyId(sid);
    setFromSignal(signal);
    setChecks(initialChecks(next, !!signal));
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
  const spec = INSTRUMENTS[asset];
  const size = positionSize({ equity: nEquity, riskPct: nRisk, entry: nEntry, sl: nSl, spec, usdPerAccountUnit: Number(usdPerUnit) });
  const rrOk = rr != null && rr >= pb.minRR;
  const levelErrors = entry && sl ? validateLevels(direction, nEntry, nSl, tp ? nTp : null) : [];
  const suggestedTp = entry && sl ? suggestTakeProfit(direction, nEntry, nSl, Math.max(RISK_RULES.targetRR, pb.minRR)) : null;
  const account = ctx?.account ?? null;
  // Regras da prop firm da conta deste activo (perda diária, perda total, profit target).
  const prop = acct ? propStatus(acct, now) : null;
  const propBlock = propRiskBlock(prop, size?.ok ? size.actualRisk : null);

  const blackout = asset === "XAUUSD" ? !!ctx?.calendar?.blackoutUSD : !!ctx?.calendar?.blackoutAll;
  const day = ctx?.byAsset?.[asset];
  const mentalClosed = Number(sleepHours) < 6 || Number(stress) > 7 || grade === "D";
  const sessionClosed = !!day?.closed || mentalClosed || !!account?.blocked || !!prop?.breached || !!prop?.passed;

  const autoChecks = useMemo(() => {
    const next = { ...checks };
    for (const step of steps) {
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

  const firstBlockedIdx = steps.findIndex((_, i) => {
    if (i === 0) return false;
    return autoChecks[steps[i - 1].id] !== "yes";
  });

  const anyNo = steps.some((s, i) => {
    if (firstBlockedIdx >= 0 && i > firstBlockedIdx) return false;
    return autoChecks[s.id] === "no";
  });
  const allYes = steps.every((s) => autoChecks[s.id] === "yes");

  let verdict: Verdict = "WAIT";
  if (sessionClosed) verdict = "CLOSED";
  else if (anyNo) verdict = "REJECT";
  else if (allYes && rrOk && !day?.needPause) verdict = "AUTHORIZED";

  const pendingStep = steps.find((s) => autoChecks[s.id] !== "yes" && autoChecks[s.id] !== "no");
  const failedStep = steps.find((s) => autoChecks[s.id] === "no");
  let whyNot: string | null = null;
  if (sessionClosed) {
    if (prop?.breached || prop?.passed) whyNot = prop.reason || "Limite da prop firm atingido.";
    else if (account?.blocked) whyNot = account.reason || "Travão diário da conta atingido.";
    else if (mentalClosed) whyNot = "Sessão fechada: sono abaixo de 6 h, stress acima de 7 ou nota D.";
    else if (day?.hitMaxTrades) whyNot = "Já atingiste o máximo de trades deste activo hoje.";
    else if (day?.hitDD) whyNot = "O limite de perdas do dia neste activo foi atingido.";
    else whyNot = "A sessão deste activo está encerrada.";
  } else if (day?.needPause) {
    whyNot = `Pausa de ${pb.pauseMinutes} min depois de ${pb.pauseAfterLosses} perdas seguidas.`;
  } else if (failedStep) {
    whyNot = `Há um passo a NÃO: ${failedStep.label}`;
  } else if (pendingStep) {
    whyNot = `Ainda falta marcar SIM neste passo: ${pendingStep.label}`;
  } else if (!entry || !sl || !tp) {
    whyNot = "Preenche entrada, stop e take profit na calculadora (coluna da direita).";
  } else if (levelErrors.length) {
    whyNot = levelErrors.join(" ");
  } else if (!rrOk) {
    whyNot = `O rácio lucro/risco tem de ser pelo menos 1:${pb.minRR}.`;
  } else if (!(nEquity > 0)) {
    whyNot = "Indica o capital da conta para calcular o lote.";
  } else if (nRisk > RISK_RULES.maxRiskPct) {
    whyNot = `Risco de ${nRisk}% acima do máximo de ${RISK_RULES.maxRiskPct}% por trade.`;
  } else if (size && !size.ok) {
    whyNot = size.reason || "O lote mínimo excede o risco permitido.";
  } else if (propBlock) {
    whyNot = propBlock;
  }
  const canSave = whyNot == null;

  const setCheck = (id: string, v: Check) => {
    const step = steps.find((s) => s.id === id);
    if (step?.kind === "news" && blackout && v === "yes") return;
    setChecks((c) => ({ ...c, [id]: v }));
  };

  // Passo actual: o primeiro que ainda não está a SIM (é o que as teclas S/N marcam).
  const activeStep = steps.find((s) => autoChecks[s.id] !== "yes") ?? null;

  // Teclado: S = sim, N = não no passo actual; U = desfaz a última marcação manual.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if ((k === "s" || k === "n") && activeStep) {
        e.preventDefault();
        setCheck(activeStep.id, k === "s" ? "yes" : "no");
      } else if (k === "u") {
        const last = [...steps].reverse().find((s) => checks[s.id] === "yes" || checks[s.id] === "no");
        if (last) {
          e.preventDefault();
          setCheck(last.id, "pending");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const saveTrade = async () => {
    if (!canSave) {
      setSaveMsg(whyNot || "Ainda não podes gravar.");
      return;
    }
    setSaving(true);
    setSaveMsg("");
    const sleepQ = Math.min(10, Math.max(1, Math.round(Number(sleepHours) || 7)));
    const stressN = Math.min(10, Math.max(1, Math.round(Number(stress) || 3)));
    const stepsDone = steps
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
      pnl: outcome === "RUNNING" || pnl === "" ? null : Number(pnl),
      rr_planned: rr != null ? Number(rr.toFixed(2)) : null,
      rr_real: outcome === "RUNNING" || !exitPrice ? null : (() => {
        const r = realizedR(direction, nEntry, nSl, Number(exitPrice));
        return r != null ? Number(r.toFixed(2)) : null;
      })(),
      outcome,
      htf_bias: direction === "LONG" ? "Bullish" : "Bearish",
      confluences: `${asset} · ${pb.title}`,
      entry_reason: `Mesa de Operação — passos confirmados: ${stepsDone}`,
      shock_timeframe: asset === "XAUUSD" ? "M5" : "M1",
      management: pb.management.join(" "),
      tags: `sessao,autorizado,${(acct?.name ?? spec.broker).replace(/[\s,]+/g, "-")}${pb.status === "observacao" ? ",demo" : ""}${fromSignal ? `,signal:${fromSignal.id}` : ""}`,
      mental_state: grade,
      sleep_quality: sleepQ,
      fatigue_level: sleepQ <= 6 ? 7 : 3,
      stress_level: stressN,
      anxiety_level: stressN,
      focus_level: stressN >= 7 ? 4 : 7,
      confidence_level: grade === "A" ? 8 : grade === "B" ? 6 : 4,
      // O estado emocional e o "seguiu o plano" são respondidos no journal, nunca inferidos da nota.
      emotional_state: "",
      pre_session_notes: `Sono ${sleepHours}h · stress ${stress}/10 · nota ${grade}`,
    };
    try {
      // Vindo de um sinal, a linha "Pendente de Validação" já existe: valida-a em vez de duplicar.
      const pendingId = fromSignal?.tradeId ?? null;
      const r = await fetch("/api/trades", {
        method: pendingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pendingId ? { ...payload, id: pendingId } : payload),
      });
      const d = await r.json().catch(() => ({})) as { id?: number; error?: string };
      if (!r.ok) {
        setSaveMsg("Erro a guardar: " + (d.error || r.status));
      } else {
        setSavedId(typeof d.id === "number" ? d.id : pendingId);
        setSaveMsg(pendingId ? "Sinal validado no journal." : "Trade gravado no journal.");
        setFromSignal(null);
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
    AUTHORIZED: { label: "AUTORIZADO", color: C.green, bg: "#052e16" },
    WAIT: { label: "ESPERAR", color: C.amber, bg: "#451a03" },
    REJECT: { label: "REJEITAR", color: C.red, bg: "#3b1a1a" },
    CLOSED: { label: "SESSÃO FECHADA", color: C.red, bg: "#3b1a1a" },
  }[verdict];

  const lbl: React.CSSProperties = { fontSize: 9, color: C.muted, letterSpacing: 1, marginBottom: 3 };
  const cell: React.CSSProperties = { display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 14px", borderLeft: `1px solid ${C.border}` };
  const dp = asset === "XAUUSD" ? 2 : 4;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Cabeçalho: activo + estratégia */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: C.accent, marginRight: 6 }}>Mesa</div>
        {(["XAUUSD", "SOLUSD"] as SessionAsset[]).map((a) => (
          <button
            key={a}
            onClick={() => switchAsset(a)}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              fontSize: 12,
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
        <span style={{ width: 1, height: 22, background: C.border, margin: "0 4px" }} />
        {playbooksForAsset(asset).map((p) => (
          <button
            key={p.strategyId}
            onClick={() => switchStrategy(p.strategyId, null)}
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              fontSize: 12,
              cursor: "pointer",
              border: `1px solid ${strategyId === p.strategyId ? C.accent : C.border}`,
              background: strategyId === p.strategyId ? "#0f4c3a" : C.card,
              color: strategyId === p.strategyId ? C.accent : C.secondary,
            }}
          >
            {p.title}
          </button>
        ))}
        <button onClick={() => load(true)} title="Actualizar preço, calendário e limites" style={{ marginLeft: "auto", background: C.elevated, color: C.secondary, border: `1px solid ${C.border}`, padding: "6px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>
          ↻ Actualizar
        </button>
      </div>

      {fromSignal && (
        <div style={{ fontSize: 11, color: C.green }}>
          Carregado do sinal #{fromSignal.id}: os passos do motor já vêm a SIM. Falta confirmar os manuais.
        </div>
      )}
      {pb.status === "observacao" && (
        <div style={{ background: "#2e1064", border: `1px solid ${C.purple}55`, color: "#ddd6fe", padding: "8px 12px", borderRadius: 8, fontSize: 12, lineHeight: 1.5 }}>{pb.statusNote}</div>
      )}
      {err && (
        <div style={{ background: "#3b1a1a", border: `1px solid ${C.red}55`, color: "#fca5a5", padding: "8px 12px", borderRadius: 8, fontSize: 12 }}>
          Falha a carregar o contexto: {err}. Os passos manuais continuam utilizáveis.
        </div>
      )}

      {/* Faixa de estado: tudo o que decide se podes operar, numa linha */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", background: C.card, border: `1px solid ${sessionClosed ? C.red + "66" : C.border}`, borderRadius: 8, padding: "10px 0", rowGap: 10 }}>
        <div style={{ ...cell, borderLeft: "none" }}>
          <div style={lbl}>{asset}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0" }}>{loading ? "…" : fmtPrice(price, asset)}</div>
        </div>
        <div style={cell} title={upcoming.slice(0, 5).map((e) => `${e.country} ${e.title}${e.minutesUntil != null ? ` · ${Math.round(e.minutesUntil)} min` : ""}`).join("\n")}>
          <div style={lbl}>NOTÍCIAS</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: blackout ? C.red : C.green }}>{blackout ? "BLOQUEIO 30 min" : "Livre"}</div>
          <div style={{ fontSize: 9, color: C.muted }}>
            {upcoming[0] ? `${upcoming[0].country} ${upcoming[0].title.slice(0, 22)}${upcoming[0].minutesUntil != null ? ` · ${Math.round(upcoming[0].minutesUntil)}m` : ""}` : "nada forte hoje"}
          </div>
        </div>
        <div style={cell}>
          <div style={lbl}>HOJE ({asset.slice(0, 3)})</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: day?.closed ? C.red : "#e2e8f0" }}>
            {day?.count ?? 0}/{pb.maxTrades} trades · {day?.consecutiveLosses ?? 0}/{pb.pauseAfterLosses} perdas
          </div>
          <div style={{ fontSize: 9, color: Number(day?.pnl || 0) >= 0 ? C.green : C.red }}>
            P&amp;L {Number(day?.pnl || 0).toFixed(2)}
            {account ? ` · conta ${account.dayLossPct.toFixed(2)}%/${RISK_RULES.maxDailyLossPct}%` : ""}
          </div>
        </div>
        {prop && (
          <div style={cell}>
            <div style={lbl}>{prop.account.toUpperCase()}{prop.phase ? ` · ${prop.phase.toUpperCase()}` : ""}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: prop.breached ? C.red : "#e2e8f0" }}>
              dia <span style={{ color: prop.dailyRemaining != null && prop.dailyLimit && prop.dailyRemaining < prop.dailyLimit * 0.5 ? C.amber : C.green }}>{prop.dailyRemaining?.toFixed(0) ?? "—"}</span>
              {" · "}total {prop.totalRemaining?.toFixed(0) ?? "—"}
            </div>
            <div style={{ fontSize: 9, color: prop.passed ? C.green : C.muted }}>
              target {prop.profit.toFixed(2)}/{prop.target?.toFixed(0) ?? "—"} ({(prop.progressPct ?? 0).toFixed(1)}%)
            </div>
          </div>
        )}
        <div style={cell}>
          <div style={lbl}>ESTADO</div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input aria-label="Horas de sono" title="Horas de sono" type="number" step="0.5" value={sleepHours} onChange={(e) => setSleepHours(e.target.value)} style={{ width: 46, padding: "2px 4px", fontSize: 11 }} />
            <span style={{ fontSize: 9, color: C.muted }}>h</span>
            <input aria-label="Stress 1 a 10" title="Stress 1–10" type="number" min="1" max="10" value={stress} onChange={(e) => setStress(e.target.value)} style={{ width: 40, padding: "2px 4px", fontSize: 11 }} />
            <span style={{ fontSize: 9, color: C.muted }}>/10</span>
            <select aria-label="Nota mental" title="Nota mental" value={grade} onChange={(e) => setGrade(e.target.value)} style={{ padding: "2px 4px", fontSize: 11 }}>
              {["A", "B", "C", "D"].map((g) => <option key={g}>{g}</option>)}
            </select>
          </div>
          {mentalClosed && <div style={{ fontSize: 9, color: C.red }}>sono &lt; 6h, stress &gt; 7 ou nota D</div>}
        </div>
        <div style={{ ...cell, marginLeft: "auto", paddingRight: 12 }}>
          <div style={{ background: verdictUI.bg, color: verdictUI.color, border: `1px solid ${verdictUI.color}66`, borderRadius: 6, padding: "6px 12px", fontWeight: 800, fontSize: 13, letterSpacing: 1, textAlign: "center" }}>
            {verdictUI.label}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(320px, 1fr)", gap: 12, alignItems: "start" }}>
        {/* Checklist: uma linha por passo; só o passo actual mostra o guião */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1.5 }}>PASSOS · {pb.timeframes}</div>
            <div style={{ fontSize: 9, color: C.muted }}>
              teclado: <b style={{ color: C.green }}>S</b> sim · <b style={{ color: C.red }}>N</b> não · <b style={{ color: C.secondary }}>U</b> desfazer
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {steps.map((step, i) => {
              const locked = i > 0 && autoChecks[steps[i - 1].id] !== "yes";
              const val = autoChecks[step.id];
              const isActive = activeStep?.id === step.id;
              const expanded = isActive || openStepId === step.id;
              const newsLockedYes = step.kind === "news" && blackout;
              const fromEngine = !!fromSignal && !!step.engineStep && val === "yes";
              return (
                <div
                  key={step.id}
                  style={{
                    opacity: locked ? 0.45 : 1,
                    border: `1px solid ${isActive ? C.accent + "88" : val === "yes" ? C.green + "44" : val === "no" ? C.red + "55" : C.border}`,
                    background: val === "yes" ? "#052e1622" : val === "no" ? "#3b1a1a33" : isActive ? "#0f4c3a22" : C.elevated,
                    borderRadius: 6,
                    padding: "6px 10px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{
                      width: 20, height: 20, borderRadius: "50%", flexShrink: 0, fontSize: 10, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      border: `1px solid ${val === "yes" ? C.green : val === "no" ? C.red : C.accent}`,
                      color: val === "yes" ? C.green : val === "no" ? C.red : C.accent,
                    }}>{val === "yes" ? "✓" : val === "no" ? "✕" : i + 1}</span>
                    <button
                      onClick={() => setOpenStepId((o) => (o === step.id ? null : step.id))}
                      style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", color: "#e2e8f0", fontSize: 12.5, fontWeight: isActive ? 600 : 500 }}
                    >
                      {step.label}
                      {fromEngine && <span style={{ color: C.green, fontSize: 10, fontWeight: 400 }}> · motor ✓</span>}
                      {step.kind === "rr" && rr != null && <span style={{ color: rrOk ? C.green : C.red, fontSize: 10, fontWeight: 400 }}> · 1:{rr.toFixed(2)}</span>}
                      {newsLockedYes && <span style={{ color: C.red, fontSize: 10, fontWeight: 400 }}> · notícia em ≤30 min</span>}
                    </button>
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      {(["yes", "no"] as Check[]).map((opt) => (
                        <button
                          key={opt}
                          disabled={locked || (opt === "yes" && newsLockedYes)}
                          onClick={() => setCheck(step.id, val === opt ? "pending" : opt)}
                          title={opt === "yes" ? "Sim (S)" : "Não (N)"}
                          style={{
                            width: 30, padding: "3px 0", borderRadius: 4, fontSize: 11, fontWeight: 700,
                            cursor: locked ? "not-allowed" : "pointer",
                            border: `1px solid ${opt === "yes" ? C.green : C.red}`,
                            background: val === opt ? (opt === "yes" ? "#14532d" : "#7f1d1d") : "transparent",
                            color: opt === "yes" ? C.green : C.red,
                          }}
                        >
                          {opt === "yes" ? "S" : "N"}
                        </button>
                      ))}
                    </div>
                  </div>
                  {expanded && !fromEngine && (
                    <div style={{ margin: "6px 0 2px 30px", fontSize: 11.5, lineHeight: 1.5 }}>
                      <div style={{ color: C.accent, fontSize: 10 }}>Onde: {step.chart}</div>
                      <div style={{ color: C.secondary, marginTop: 3 }}>{step.do}</div>
                      <div style={{ color: C.green, marginTop: 3 }}><b>SIM se:</b> {step.yesIf}</div>
                      <div style={{ color: "#fca5a5", marginTop: 2 }}><b>NÃO se:</b> {step.noIf}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 10, color: C.muted }}>
              {pb.sessionWindow} · R:R ≥ {pb.minRR} · máx. {pb.maxTrades} trades · DD {pb.maxDailyDD}%
            </div>
            <button
              onClick={() => { setChecks(emptyChecks(pb)); setSaveMsg(""); setSavedId(null); }}
              style={{ background: "transparent", color: C.muted, border: `1px solid ${C.border}`, padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
            >
              Limpar passos
            </button>
          </div>
          <details style={{ marginTop: 10, fontSize: 11 }}>
            <summary style={{ cursor: "pointer", color: C.secondary }}>Gestão depois de entrares e quando sair</summary>
            <div style={{ marginTop: 6 }}>
              {pb.management.map((m) => <div key={m} style={{ color: C.secondary, lineHeight: 1.6 }}>• {m}</div>)}
              <div style={{ fontSize: 9, color: C.red, letterSpacing: 1.5, margin: "8px 0 4px" }}>SAI / NÃO ENTRES SE</div>
              {pb.invalidation.map((m) => <div key={m} style={{ color: "#fca5a5", lineHeight: 1.6 }}>• {m}</div>)}
            </div>
          </details>
        </div>

        {/* Ticket fixo: números da ordem e um só botão de registo */}
        <div style={{ position: "sticky", top: 0, background: C.card, border: `1px solid ${canSave ? C.green + "66" : C.border}`, borderRadius: 8, padding: 14 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {(["LONG", "SHORT"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDirection(d)}
                style={{
                  flex: 1, padding: "7px 0", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer",
                  border: `1px solid ${direction === d ? (d === "LONG" ? C.green : C.red) : C.border}`,
                  background: direction === d ? (d === "LONG" ? "#14532d" : "#7f1d1d") : C.elevated,
                  color: direction === d ? (d === "LONG" ? C.green : "#fca5a5") : C.secondary,
                }}
              >
                {d === "LONG" ? "▲ LONG" : "▼ SHORT"}
              </button>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <div>
              <div style={lbl}>ENTRADA</div>
              <input type="number" step="any" value={entry} onChange={(e) => setEntry(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <div style={lbl}>STOP LOSS</div>
              <input type="number" step="any" value={sl} onChange={(e) => setSl(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <div style={lbl}>TAKE PROFIT</div>
              <input type="number" step="any" value={tp} onChange={(e) => setTp(e.target.value)} style={{ width: "100%" }} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: acct?.currency === "EUR" ? "0.7fr 1.3fr 0.8fr" : "0.7fr 1.3fr", gap: 8, marginTop: 8 }}>
            <div>
              <div style={lbl}>RISCO %</div>
              <input type="number" step="0.1" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <div style={lbl} title={acct ? `${acct.name} · ${KIND_LABEL[acct.kind]}` : ""}>CAPITAL {acct ? `${acct.name.toUpperCase()} · ${acct.currency}` : "(sem conta)"}</div>
              <input type="number" step="any" value={equity} placeholder="capital da conta" onChange={(e) => setEquity(e.target.value)} onBlur={(e) => { saveEquity(e.target.value); load(false); }} style={{ width: "100%" }} />
            </div>
            {acct?.currency === "EUR" && (
              <div>
                <div style={lbl}>USD/EUR{eurusd ? " (BCE)" : ""}</div>
                <input type="number" step="0.0001" value={usdPerUnit} onChange={(e) => { setUsdPerUnit(e.target.value); writeLocal("tos_usd_per_unit", e.target.value); }} style={{ width: "100%" }} />
              </div>
            )}
          </div>
          <button
            onClick={() => suggestedTp != null && setTp(suggestedTp.toFixed(dp))}
            disabled={suggestedTp == null}
            style={{ marginTop: 8, width: "100%", background: "transparent", color: suggestedTp == null ? C.muted : C.accent, border: `1px dashed ${C.border}`, padding: "5px 8px", borderRadius: 6, fontSize: 11, cursor: suggestedTp == null ? "not-allowed" : "pointer" }}
          >
            TP a {Math.max(RISK_RULES.targetRR, pb.minRR)}R{suggestedTp != null ? ` → ${fmtPrice(suggestedTp, asset)}` : ""}
          </button>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
            <div style={{ background: C.elevated, borderRadius: 6, padding: 8, border: `1px solid ${rrOk ? C.green + "44" : C.border}` }}>
              <div style={lbl}>R:R</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: rr == null ? C.muted : rrOk ? C.green : C.red }}>{rr == null ? "—" : `1:${rr.toFixed(2)}`}</div>
              <div style={{ fontSize: 9, color: C.muted }}>mín. {pb.minRR}</div>
            </div>
            <div style={{ background: C.elevated, borderRadius: 6, padding: 8, border: `1px solid ${size && !size.ok ? C.red + "66" : C.border}` }}>
              <div style={lbl}>LOTE ({spec.lotLabel})</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: size == null ? C.muted : size.ok ? "#e2e8f0" : C.red }}>
                {size == null ? "—" : size.ok ? size.lots.toLocaleString("pt-PT", { maximumFractionDigits: 2 }) : "BLOQ."}
              </div>
              <div style={{ fontSize: 9, color: C.muted }}>
                {size == null ? `${nRisk}% de ${nEquity || 0}` : size.ok ? `arrisca ${size.actualRisk.toFixed(2)}` : `mín. ${size.minLotRiskPct.toFixed(1)}%`}
              </div>
            </div>
            <div style={{ background: C.elevated, borderRadius: 6, padding: 8, border: `1px solid ${propBlock ? C.red + "66" : C.border}` }}>
              <div style={lbl}>RISCO MÁX.</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: propBlock ? C.red : C.secondary }}>{prop?.maxRiskMoney != null ? prop.maxRiskMoney.toFixed(0) : "—"}</div>
              <div style={{ fontSize: 9, color: C.muted }}>{prop ? `folga ${prop.account}` : "sem regras"}</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: outcome === "RUNNING" ? "1fr" : "1.2fr 1fr 1fr", gap: 8, marginTop: 10 }}>
            <div>
              <div style={lbl}>RESULTADO</div>
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
                  <div style={lbl}>SAÍDA</div>
                  <input type="number" step="any" value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} style={{ width: "100%" }} />
                </div>
                <div>
                  <div style={lbl}>P&amp;L</div>
                  <input type="number" step="any" value={pnl} onChange={(e) => setPnl(e.target.value)} style={{ width: "100%" }} />
                </div>
              </>
            )}
          </div>

          <div style={{ fontSize: 11.5, color: canSave ? C.green : C.amber, marginTop: 12, lineHeight: 1.45, minHeight: 34 }}>
            {canSave ? "Tudo verde. Põe a ordem na plataforma e regista." : (whyNot || "Completa os passos e o ticket.")}
          </div>
          <button
            onClick={saveTrade}
            disabled={saving || !canSave}
            style={{
              marginTop: 8,
              width: "100%",
              background: canSave ? "#14532d" : "#1e293b",
              color: canSave ? C.green : C.secondary,
              border: `2px solid ${canSave ? C.green : C.border}`,
              padding: "12px 16px",
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 800,
              cursor: saving ? "wait" : canSave ? "pointer" : "not-allowed",
            }}
          >
            {saving ? "A registar…" : fromSignal?.tradeId ? "Registar (valida o sinal)" : "Registar"}
          </button>
          {(saveMsg || savedId) && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: savedId ? C.green : "#fca5a5", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <span>{saveMsg}{savedId ? ` (#${savedId})` : ""}</span>
              {savedId && <Link href="/journal" style={{ color: C.accent }}>Abrir no journal →</Link>}
            </div>
          )}
          <AccountsPanel accounts={accounts} asset={asset} onChange={setAccounts} />
        </div>
      </div>
    </div>
  );
}
