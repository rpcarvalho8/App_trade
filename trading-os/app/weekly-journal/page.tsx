"use client";
import { useState, useEffect } from "react";

const C = { accent:"#4af0c4",green:"#4ade80",red:"#f87171",amber:"#fbbf24",blue:"#60a5fa",purple:"#c084fc",muted:"#475569",secondary:"#94a3b8",border:"#1e2d45",card:"#0d1929",elevated:"#111827" };

function getWeekBounds(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d.setDate(diff));
  const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
  return { start: mon.toISOString().slice(0,10), end: fri.toISOString().slice(0,10) };
}

function weekLabel(start: string) {
  const d = new Date(start + "T12:00:00");
  return d.toLocaleDateString("pt-PT", { day:"2-digit", month:"short", year:"numeric" });
}

const GRADES = ["A+","A","B","C","D","F"];
const GRADE_COLORS: Record<string,string> = {"A+":C.green,"A":C.green,"B":C.accent,"C":C.amber,"D":C.red,"F":"#7f1d1d"};

function Field({ label, children }: any) {
  return (
    <div style={{ display:"flex",flexDirection:"column",gap:5 }}>
      <div style={{ fontSize:9,color:C.muted,letterSpacing:1.5,textTransform:"uppercase" }}>{label}</div>
      {children}
    </div>
  );
}

export default function WeeklyJournalPage() {
  const weeks = [getWeekBounds(new Date())];
  // Add previous 8 weeks
  for (let i=1; i<=8; i++) {
    const d = new Date(); d.setDate(d.getDate() - i*7);
    weeks.push(getWeekBounds(d));
  }

  const [selectedWeek, setSelectedWeek] = useState(weeks[0].start);
  const [journalData, setJournalData] = useState<any>(null);
  const [weekTrades, setWeekTrades] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pastJournals, setPastJournals] = useState<any[]>([]);
  const [form, setForm] = useState({
    overall_grade:"B", best_trade:"", worst_trade:"",
    technical_review:"", psychological_review:"", rule_compliance:"",
    setups_analysis:"", goals_met:"", goals_next_week:"",
    mindset_notes:"", lessons:""
  });

  const set = (k:string) => (e:any) => setForm(f=>({...f,[k]:e.target.value}));

  const load = async (wStart: string) => {
    const wb = weeks.find(w=>w.start===wStart)||weeks[0];
    const res = await fetch(`/api/weekly-journals?week=${wStart}`);
    const data = await res.json();
    if (data?.journal) {
      setJournalData(data.journal);
      setWeekTrades(data.trades||[]);
      setForm({
        overall_grade: data.journal.overall_grade||"B",
        best_trade: data.journal.best_trade||"",
        worst_trade: data.journal.worst_trade||"",
        technical_review: data.journal.technical_review||"",
        psychological_review: data.journal.psychological_review||"",
        rule_compliance: data.journal.rule_compliance||"",
        setups_analysis: data.journal.setups_analysis||"",
        goals_met: data.journal.goals_met||"",
        goals_next_week: data.journal.goals_next_week||"",
        mindset_notes: data.journal.mindset_notes||"",
        lessons: data.journal.lessons||"",
      });
    } else {
      setJournalData(null);
      // Load trades for this week even if no journal yet
      const tr = await fetch(`/api/trades?limit=200`).then(r=>r.json());
      setWeekTrades(tr.filter((t:any)=>t.date>=wStart&&t.date<=wb.end));
      setForm({overall_grade:"B",best_trade:"",worst_trade:"",technical_review:"",psychological_review:"",rule_compliance:"",setups_analysis:"",goals_met:"",goals_next_week:"",mindset_notes:"",lessons:""});
    }
    const past = await fetch("/api/weekly-journals").then(r=>r.json());
    setPastJournals(past||[]);
  };

  useEffect(()=>{ load(selectedWeek); },[selectedWeek]);

  const save = async () => {
    setSaving(true);
    const wb = weeks.find(w=>w.start===selectedWeek)||weeks[0];
    await fetch("/api/weekly-journals",{
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({...form, week_start:selectedWeek, week_end:wb.end})
    });
    setSaving(false); setSaved(true);
    setTimeout(()=>setSaved(false),3000);
    load(selectedWeek);
  };

  const wb = weeks.find(w=>w.start===selectedWeek)||weeks[0];
  const pnl = weekTrades.filter(t=>t.outcome!=="RUNNING").reduce((s,t)=>s+Number(t.pnl||0),0);
  const wins = weekTrades.filter(t=>t.outcome==="WIN").length;
  const losses = weekTrades.filter(t=>t.outcome==="LOSS").length;
  const violations = weekTrades.filter(t=>!t.followed_plan).length;
  const avgSleep = weekTrades.length ? weekTrades.reduce((s,t)=>s+Number(t.sleep_quality||5),0)/weekTrades.length : 0;
  const avgFocus = weekTrades.length ? weekTrades.reduce((s,t)=>s+Number(t.focus_level||5),0)/weekTrades.length : 0;

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:20 }}>
      {/* Header */}
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
        <div>
          <div style={{ fontSize:9,color:C.muted,letterSpacing:2 }}>TRADING OS</div>
          <div style={{ fontSize:22,fontWeight:600,color:C.accent }}>Journal Semanal</div>
          <div style={{ fontSize:11,color:C.muted,marginTop:2 }}>Revisão de fim de semana — análise técnica + psicológica da semana</div>
        </div>
        <div style={{ display:"flex",gap:10,alignItems:"center" }}>
          <select value={selectedWeek} onChange={e=>setSelectedWeek(e.target.value)} style={{ width:200 }}>
            {weeks.map(w=>(
              <option key={w.start} value={w.start}>
                {w.start===weeks[0].start?"Esta semana: ":""}{weekLabel(w.start)} – {new Date(w.end+"T12:00:00").toLocaleDateString("pt-PT",{day:"2-digit",month:"short"})}
              </option>
            ))}
          </select>
          <button onClick={save} disabled={saving} style={{ background:"#0f4c3a",color:C.accent,border:`1px solid ${C.accent}`,padding:"7px 16px",borderRadius:4,fontSize:12 }}>
            {saving?"A guardar...":saved?"✓ Guardado!":"Guardar Journal"}
          </button>
        </div>
      </div>

      {/* Week Stats Auto-calculated */}
      <div style={{ background:"#070b14",border:"1px solid #1e4d6b",borderRadius:10,padding:16 }}>
        <div style={{ fontSize:9,color:"#38bdf8",letterSpacing:2,marginBottom:14 }}>
          ESTATÍSTICAS DA SEMANA — {weekLabel(selectedWeek)} a {new Date(wb.end+"T12:00:00").toLocaleDateString("pt-PT",{day:"2-digit",month:"short"})}
          <span style={{ color:C.muted,marginLeft:8 }}>(calculado automaticamente dos trades registados)</span>
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:10 }}>
          {[
            {label:"TRADES",value:weekTrades.filter(t=>t.outcome!=="RUNNING").length,color:C.secondary},
            {label:"WINS",value:wins,color:C.green},
            {label:"LOSSES",value:losses,color:C.red},
            {label:"WIN RATE",value:weekTrades.filter(t=>t.outcome!=="RUNNING").length>0?Math.round(wins/(wins+losses)*100)+"%":"—",color:C.accent},
            {label:"NET P&L",value:`$${pnl.toFixed(0)}`,color:pnl>=0?C.green:C.red},
            {label:"VIOLATIONS",value:violations,color:violations>0?C.amber:C.green},
            {label:"SONO MED",value:avgSleep>0?avgSleep.toFixed(1)+"":"—",color:avgSleep>=7?C.green:avgSleep>=5?C.amber:C.red},
          ].map(m=>(
            <div key={m.label} style={{ background:C.elevated,borderRadius:6,padding:"10px 12px",textAlign:"center" }}>
              <div style={{ fontSize:9,color:C.muted,letterSpacing:1,marginBottom:4 }}>{m.label}</div>
              <div style={{ fontSize:18,fontWeight:600,color:m.color }}>{m.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Week Trades Table */}
      {weekTrades.length>0 && (
        <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden" }}>
          <div style={{ padding:"12px 16px",borderBottom:`1px solid ${C.border}`,fontSize:9,color:C.muted,letterSpacing:2 }}>TRADES DESTA SEMANA</div>
          <div style={{ overflowX:"auto" }}>
            <table>
              <thead><tr><th>DATA</th><th>PAR</th><th>DIR</th><th>SETUP</th><th>P&L</th><th>RESULTADO</th><th>MENTAL</th><th>😴</th><th>PLANO</th></tr></thead>
              <tbody>
                {weekTrades.map(t=>(
                  <tr key={t.id}>
                    <td style={{ color:C.muted }}>{t.date}</td>
                    <td style={{ color:"#e2e8f0",fontWeight:500 }}>{t.pair}</td>
                    <td><span style={{ fontSize:9,padding:"1px 6px",borderRadius:10,background:t.direction==="LONG"?"#1e3a5f":"#3b1a1a",color:t.direction==="LONG"?"#7dd3fc":"#fca5a5" }}>{t.direction}</span></td>
                    <td>{t.setup}</td>
                    <td style={{ color:Number(t.pnl)>=0?C.green:C.red,fontWeight:600 }}>{Number(t.pnl)>=0?"+":""}${Number(t.pnl).toFixed(0)}</td>
                    <td><span style={{ fontSize:9,padding:"1px 6px",borderRadius:10,background:t.outcome==="WIN"?"#14532d":t.outcome==="LOSS"?"#7f1d1d":"#1e293b",color:t.outcome==="WIN"?C.green:t.outcome==="LOSS"?C.red:C.secondary }}>{t.outcome}</span></td>
                    <td style={{ color:{A:C.green,B:C.accent,C:C.amber,D:C.red}[t.mental_state as string]||C.muted }}>{t.mental_state}</td>
                    <td style={{ color:Number(t.sleep_quality)>=7?C.green:Number(t.sleep_quality)>=5?C.amber:C.red }}>{t.sleep_quality||"—"}</td>
                    <td style={{ color:t.followed_plan?C.green:C.red }}>{t.followed_plan?"✓":"✗"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Journal Form */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }}>
        <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
          <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16 }}>
            <div style={{ fontSize:9,color:C.muted,letterSpacing:2,marginBottom:14 }}>AVALIAÇÃO GERAL DA SEMANA</div>
            <Field label="Nota Geral (A+ a F)">
              <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
                {GRADES.map(g=>(
                  <button key={g} onClick={()=>setForm(f=>({...f,overall_grade:g}))} style={{
                    padding:"6px 16px",borderRadius:6,fontSize:14,fontWeight:700,cursor:"pointer",
                    background:form.overall_grade===g?GRADE_COLORS[g]+"33":"transparent",
                    color:form.overall_grade===g?GRADE_COLORS[g]:C.muted,
                    border:`2px solid ${form.overall_grade===g?GRADE_COLORS[g]:C.border}`,
                  }}>{g}</button>
                ))}
              </div>
            </Field>
          </div>

          <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16 }}>
            <div style={{ fontSize:9,color:C.muted,letterSpacing:2,marginBottom:14 }}>ANÁLISE TÉCNICA</div>
            <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
              <Field label="Revisão técnica geral — O que funcionou e o que falhou?">
                <textarea value={form.technical_review} onChange={set("technical_review")} rows={3} placeholder="Execução dos setups, qualidade das entradas, leitura de Elliott e Wyckoff..." style={{ width:"100%",resize:"vertical" }}/>
              </Field>
              <Field label="Análise de setups — Como performou cada setup?">
                <textarea value={form.setups_analysis} onChange={set("setups_analysis")} rows={3} placeholder="W-E Macro Flow: X trades, Y wins. E-W Impulse Rider: ..." style={{ width:"100%",resize:"vertical" }}/>
              </Field>
              <Field label="Melhor trade da semana">
                <textarea value={form.best_trade} onChange={set("best_trade")} rows={2} placeholder="Par, setup, o que fiz bem..." style={{ width:"100%",resize:"vertical" }}/>
              </Field>
              <Field label="Pior trade / maior erro da semana">
                <textarea value={form.worst_trade} onChange={set("worst_trade")} rows={2} placeholder="Par, o que correu mal, porquê..." style={{ width:"100%",resize:"vertical" }}/>
              </Field>
            </div>
          </div>
        </div>

        <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
          <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16 }}>
            <div style={{ fontSize:9,color:C.purple,letterSpacing:2,marginBottom:14 }}>ANÁLISE PSICOLÓGICA</div>
            <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
              <Field label="Revisão psicológica — como me senti durante a semana?">
                <textarea value={form.psychological_review} onChange={set("psychological_review")} rows={3} placeholder="Stress, ansiedade, FOMO, revenge trading, overconfidence... momentos difíceis." style={{ width:"100%",resize:"vertical" }}/>
              </Field>
              <Field label="Cumprimento de regras — onde falhei e porquê?">
                <textarea value={form.rule_compliance} onChange={set("rule_compliance")} rows={2} placeholder="Regras cumpridas: X/Y. Violações: qual regra, quando, porquê..." style={{ width:"100%",resize:"vertical" }}/>
              </Field>
              <Field label="Estado mental geral da semana">
                <textarea value={form.mindset_notes} onChange={set("mindset_notes")} rows={2} placeholder="Como foi o equilíbrio vida-trading? Sono, stress externo, disciplina geral..." style={{ width:"100%",resize:"vertical" }}/>
              </Field>
            </div>
          </div>

          <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16 }}>
            <div style={{ fontSize:9,color:C.green,letterSpacing:2,marginBottom:14 }}>OBJETIVOS & LIÇÕES</div>
            <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
              <Field label="Objetivos da semana passada — foram atingidos?">
                <textarea value={form.goals_met} onChange={set("goals_met")} rows={2} placeholder="Meta 1: sim/não/parcial. Meta 2: ..." style={{ width:"100%",resize:"vertical" }}/>
              </Field>
              <Field label="Objetivos para a próxima semana (máx. 3)">
                <textarea value={form.goals_next_week} onChange={set("goals_next_week")} rows={3} placeholder="1. ...\n2. ...\n3. ..." style={{ width:"100%",resize:"vertical" }}/>
              </Field>
              <Field label="Principal lição da semana">
                <textarea value={form.lessons} onChange={set("lessons")} rows={2} placeholder="Uma coisa concreta que vou mudar ou aplicar na próxima semana..." style={{ width:"100%",resize:"vertical" }}/>
              </Field>
            </div>
          </div>
        </div>
      </div>

      {/* Past Journals */}
      {pastJournals.length>0 && (
        <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16 }}>
          <div style={{ fontSize:9,color:C.muted,letterSpacing:2,marginBottom:12 }}>HISTÓRICO DE JOURNALS SEMANAIS</div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:10 }}>
            {pastJournals.slice(0,12).map((j:any)=>{
              const col = GRADE_COLORS[j.overall_grade]||C.muted;
              return (
                <div key={j.id} onClick={()=>setSelectedWeek(j.week_start)}
                  style={{ background:C.elevated,borderRadius:6,padding:12,cursor:"pointer",border:`1px solid ${selectedWeek===j.week_start?col:C.border}` }}>
                  <div style={{ fontSize:11,color:C.secondary,marginBottom:6 }}>{weekLabel(j.week_start)}</div>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                    <div style={{ fontSize:20,fontWeight:700,color:col }}>{j.overall_grade}</div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:12,color:Number(j.pnl_total)>=0?C.green:C.red,fontWeight:600 }}>${Number(j.pnl_total||0).toFixed(0)}</div>
                      <div style={{ fontSize:9,color:C.muted }}>{j.trades_count} trades</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
