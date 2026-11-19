"use client";
import { useEffect, useState } from "react";

/**
 * Cartão "Estudo" do Morning Brief: semana atual do plano, micro-tarefa do dia útil,
 * agenda do fim de semana com sessões marcáveis, plano completo, guia e exportação .ics.
 * Ao fim de semana abre expandido (é o dia de estudo); nos dias úteis fica compacto.
 */

type Session = { id: string; weekday: 0 | 6; start: string; end: string; title: string; tasks: string[] };
type Week = { week: number; title: string; goal: string; guideSections: string[]; references: string[]; weekdayDrill: string; sessions: Session[]; deliverable: string };
type Today = {
  date: string;
  start: string;
  weekNumber: number;
  week: Week;
  isWeekend: boolean;
  todaySessions: Session[];
  next: { date: string; session: Session } | null;
  weekend: { saturday: string; sunday: string };
  progress: Record<string, boolean>;
};

const DAY = (wd: number) => (wd === 6 ? "Sábado" : "Domingo");
const fmtDate = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("pt-PT", { weekday: "short", day: "2-digit", month: "short" });

export default function StudyCard() {
  const [t, setT] = useState<Today | null>(null);
  const [plan, setPlan] = useState<Week[]>([]);
  const [open, setOpen] = useState<boolean | null>(null);
  const [view, setView] = useState<"week" | "plan" | "guide">("week");
  const [guide, setGuide] = useState("");
  const [err, setErr] = useState("");
  const [editStart, setEditStart] = useState(false);

  const load = () =>
    fetch("/api/study", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error);
        setT(j.today);
        setPlan([...j.plan, ...j.consolidation]);
        setOpen((o) => (o === null ? j.today.isWeekend : o));
      })
      .catch((e) => setErr(e?.message || "Falha ao carregar o plano de estudo."));

  useEffect(() => {
    load();
  }, []);

  const toggle = async (key: string) => {
    const r = await fetch("/api/study", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "toggle", key }) }).then((x) => x.json());
    if (r.ok && t) setT({ ...t, progress: r.progress });
  };

  const changeStart = async (date: string) => {
    const r = await fetch("/api/study", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", date }) }).then((x) => x.json());
    if (r.ok) {
      setT(r.today);
      setEditStart(false);
    }
  };

  const showGuide = async () => {
    setView("guide");
    if (!guide) {
      const j = await fetch("/api/study?guide=1").then((r) => r.json()).catch(() => null);
      setGuide(j?.html || "<p>Guia indisponível.</p>");
    }
  };

  if (err) return <div style={box}><span style={{ color: "#fca5a5", fontSize: 12 }}>Estudo: {err}</span></div>;
  if (!t) return null;

  const w = t.week;
  const done = w.sessions.filter((s) => t.progress[`${t.weekNumber}:${s.id}`]).length;

  return (
    <div style={box}>
      {/* Cabeçalho sempre visível */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ color: "#4af0c4", fontSize: 12, fontWeight: 600, letterSpacing: 0.5 }}>📚 ESTUDO</span>
        <span style={{ color: "#e2e8f0", fontSize: 13 }}>
          Semana {t.weekNumber}{t.weekNumber <= 6 ? "/6" : ""} · {w.title}
        </span>
        <span style={pill}>{done}/{w.sessions.length} sessões</span>
        <button onClick={() => setOpen((o) => !o)} style={{ ...btn, marginLeft: "auto" }}>{open ? "▲ Fechar" : "▼ Abrir"}</button>
      </div>

      {/* Compacto: o que importa hoje */}
      <div style={{ fontSize: 12.5, color: "#cbd5e1", marginTop: 8 }}>
        {t.isWeekend && t.todaySessions.length ? (
          <>Hoje: {t.todaySessions.map((s) => `${s.start}–${s.end} ${s.title}`).join(" · ")}</>
        ) : (
          <>
            <span style={{ color: "#64748b" }}>Hoje (15 min): </span>{w.weekdayDrill}
            {t.next && (
              <div style={{ color: "#64748b", marginTop: 4 }}>
                Próxima sessão: <span style={{ color: "#94a3b8" }}>{fmtDate(t.next.date)} {t.next.session.start}</span> — {t.next.session.title}
              </div>
            )}
          </>
        )}
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            <button style={view === "week" ? btnOn : btn} onClick={() => setView("week")}>Esta semana</button>
            <button style={view === "plan" ? btnOn : btn} onClick={() => setView("plan")}>Plano completo</button>
            <button style={view === "guide" ? btnOn : btn} onClick={showGuide}>Guia de estudo</button>
            <a href="/api/study?ics=1" style={{ ...btn, textDecoration: "none" }} title="Importa no Google Calendar / Apple Calendar">⤓ Calendário (.ics)</a>
          </div>

          {view === "week" && (
            <div>
              <div style={{ fontSize: 12.5, color: "#94a3b8", marginBottom: 10 }}>
                <strong style={{ color: "#e2e8f0" }}>Objetivo:</strong> {w.goal}
              </div>
              {w.sessions.map((s) => {
                const key = `${t.weekNumber}:${s.id}`;
                const date = s.weekday === 6 ? t.weekend.saturday : t.weekend.sunday;
                const isToday = date === t.date;
                return (
                  <div key={s.id} style={{ border: `1px solid ${isToday ? "#0f4c3a" : "#1e2d45"}`, background: isToday ? "#0b1f1a" : "#0d1929", borderRadius: 6, padding: "10px 12px", marginBottom: 8 }}>
                    <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                      <input type="checkbox" checked={!!t.progress[key]} onChange={() => toggle(key)} />
                      <span style={{ color: "#4af0c4", fontSize: 11, minWidth: 150 }}>{DAY(s.weekday)} {fmtDate(date).split(",")[1] ?? ""} · {s.start}–{s.end}</span>
                      <span style={{ color: t.progress[key] ? "#64748b" : "#e2e8f0", fontSize: 12.5, textDecoration: t.progress[key] ? "line-through" : "none" }}>{s.title}</span>
                    </label>
                    <ul style={{ margin: "6px 0 0 24px", padding: 0, fontSize: 12, color: "#94a3b8" }}>
                      {s.tasks.map((x, i) => <li key={i} style={{ margin: "3px 0" }}>{x}</li>)}
                    </ul>
                  </div>
                );
              })}
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>
                <div><span style={{ color: "#64748b" }}>Dias úteis (15 min):</span> {w.weekdayDrill}</div>
                <div><span style={{ color: "#64748b" }}>Ler no guia:</span> {w.guideSections.join(" · ")}</div>
                <div><span style={{ color: "#64748b" }}>Material:</span> {w.references.join(" · ")}</div>
                <div><span style={{ color: "#64748b" }}>Entregável:</span> <span style={{ color: "#e2e8f0" }}>{w.deliverable}</span></div>
              </div>
            </div>
          )}

          {view === "plan" && (
            <div>
              {plan.map((p) => {
                const current = p.week === t.weekNumber || (t.weekNumber > 6 && p.week === 7 + ((t.weekNumber - 7) % 2));
                return (
                  <div key={p.week} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid #12203a" }}>
                    <span style={{ color: current ? "#4af0c4" : "#475569", fontSize: 11, minWidth: 64 }}>{p.week <= 6 ? `Semana ${p.week}` : p.week === 7 ? "Ciclo A" : "Ciclo B"}</span>
                    <div style={{ fontSize: 12 }}>
                      <div style={{ color: current ? "#e2e8f0" : "#94a3b8" }}>{p.title}</div>
                      <div style={{ color: "#64748b" }}>{p.goal}</div>
                      <div style={{ color: "#475569" }}>Entregável: {p.deliverable}</div>
                    </div>
                  </div>
                );
              })}
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 10 }}>
                Depois da semana 6 o plano alterna os ciclos de consolidação A (ouro) e B (Solana).
              </div>
            </div>
          )}

          {view === "guide" && <article className="brief-md" style={{ padding: "18px 20px" }} dangerouslySetInnerHTML={{ __html: guide || "<p>A carregar…</p>" }} />}

          <div style={{ fontSize: 11, color: "#475569", marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            Plano iniciado em {t.start}. Sessões: sábado 09:00–11:30, domingo 09:00–11:00 e 18:00–18:45. Lembrete às 08:30.
            {editStart ? (
              <input type="date" defaultValue={t.start} onChange={(e) => e.target.value && changeStart(e.target.value)} style={{ fontSize: 11, padding: "2px 6px" }} />
            ) : (
              <button style={btn} onClick={() => setEditStart(true)}>Mudar início</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const box: React.CSSProperties = { background: "#0a0e1a", border: "1px solid #1e2d45", borderRadius: 10, padding: "14px 18px", marginBottom: 16 };
const btn: React.CSSProperties = { background: "#1e293b", color: "#94a3b8", border: "1px solid #1e2d45", padding: "3px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" };
const btnOn: React.CSSProperties = { ...btn, background: "#0f4c3a", color: "#4af0c4", border: "1px solid #4af0c4" };
const pill: React.CSSProperties = { fontSize: 10, color: "#94a3b8", border: "1px solid #1e2d45", padding: "1px 8px", borderRadius: 10 };
