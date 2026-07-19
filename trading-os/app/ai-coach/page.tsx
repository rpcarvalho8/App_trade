"use client";
import { useState, useEffect, useCallback } from "react";

const C = { accent:"#4af0c4",green:"#4ade80",red:"#f87171",amber:"#fbbf24",blue:"#60a5fa",purple:"#c084fc",muted:"#475569",secondary:"#94a3b8",border:"#1e2d45",card:"#0d1929",elevated:"#111827" };

type ReportMeta = {
  week_start: string; week_end: string; created_at: string;
  overall_score: number|null; grade: string|null; pnl: number|null; trades: number|null; win_rate: number|null;
};

function Ring({ score, color }: { score: number; color: string }) {
  const r=32,cx=40,cy=40,circ=2*Math.PI*r,fill=(Math.max(0,Math.min(10,score))/10)*circ;
  return (
    <div style={{ position:"relative",width:80,height:80 }}>
      <svg width={80} height={80}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e2d45" strokeWidth={6}/>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={6} strokeDasharray={`${fill} ${circ}`} strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}/>
      </svg>
      <div style={{ position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center" }}>
        <div style={{ fontSize:20,fontWeight:700,color }}>{score}</div>
        <div style={{ fontSize:8,color:C.muted }}>/ 10</div>
      </div>
    </div>
  );
}

const fmtWeek = (s:string,e:string) => {
  try {
    const d = (x:string)=>new Date(x+"T00:00:00").toLocaleDateString("pt-PT",{day:"2-digit",month:"short"});
    return `${d(s)} – ${d(e)}`;
  } catch { return `${s} – ${e}`; }
};

export default function AICoachPage() {
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [prevWeek, setPrevWeek] = useState<{week_start:string;week_end:string}|null>(null);
  const [prevGenerated, setPrevGenerated] = useState(true);
  const [selected, setSelected] = useState<string|null>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [err, setErr] = useState("");

  const loadList = useCallback(async () => {
    const d = await fetch("/api/ai-analysis").then(r=>r.json()).catch(()=>null);
    if (d?.reports) {
      setReports(d.reports);
      setPrevWeek(d.previous_week);
      setPrevGenerated(d.previous_week_generated);
      return d.reports as ReportMeta[];
    }
    return [];
  }, []);

  const loadWeek = useCallback(async (week:string) => {
    setSelected(week);
    setAnalysis(null);
    const d = await fetch(`/api/ai-analysis?week=${week}`).then(r=>r.json()).catch(()=>null);
    setAnalysis(d);
  }, []);

  useEffect(()=>{ (async()=>{
    const list = await loadList();
    if (list.length) await loadWeek(list[0].week_start);
    setFetching(false);
  })(); },[loadList, loadWeek]);

  const generate = async (week_start?:string, week_end?:string) => {
    setLoading(true); setErr("");
    try {
      const res = await fetch("/api/ai-analysis",{
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify(week_start?{ week_start, week_end }:{}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const list = await loadList();
      const target = data.week_start || week_start || (list[0]?.week_start);
      if (target) await loadWeek(target);
    } catch(e:any){ setErr(e.message || "Erro ao gerar análise."); }
    setLoading(false);
  };

  const sevColor = (s:string) => s==="high"?C.red:s==="medium"?C.amber:C.muted;
  const pnlColor = (v:number|null|undefined) => v==null?C.muted:v>=0?C.green:C.red;

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:20 }}>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
        <div>
          <div style={{ fontSize:9,color:C.muted,letterSpacing:2 }}>TRADING OS</div>
          <div style={{ fontSize:22,fontWeight:600,color:C.accent }}>AI Coach — Relatórios Semanais</div>
          <div style={{ fontSize:11,color:C.muted,marginTop:2 }}>Análise técnica + psicológica + gráficos — powered by Google Gemini · todos os domingos às 09:00</div>
        </div>
        <div style={{ display:"flex",flexDirection:"column",gap:6,alignItems:"flex-end" }}>
          <button onClick={()=>generate()} disabled={loading} style={{ background:loading?"#0f3028":"#0f4c3a",color:loading?"#2d8a6e":C.accent,border:`1px solid ${loading?"#2d8a6e":C.accent}`,padding:"8px 18px",borderRadius:4,fontSize:12,cursor:loading?"default":"pointer" }}>
            {loading?"⬡ A analisar semana + screenshots...":"⬡ Gerar relatório da semana anterior"}
          </button>
          {prevWeek&&!prevGenerated&&!loading&&(
            <div style={{ fontSize:9,color:C.amber }}>⚠ Falta o relatório de {fmtWeek(prevWeek.week_start,prevWeek.week_end)}</div>
          )}
        </div>
      </div>

      {err&&<div style={{ background:"#3b0f0f",border:"1px solid #7f1d1d",borderRadius:8,padding:14,color:C.red,fontSize:12 }}>⚠ {err}<div style={{ marginTop:6,fontSize:10,color:"#f87171aa" }}>Verifica <code>GEMINI_API_KEY</code> no .env.local (obtém grátis em aistudio.google.com/apikey).</div></div>}

      <div style={{ display:"grid",gridTemplateColumns:"220px 1fr",gap:18,alignItems:"flex-start" }}>
        {/* Sidebar: weeks */}
        <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:10,position:"sticky",top:10 }}>
          <div style={{ fontSize:9,color:C.muted,letterSpacing:2,padding:"4px 6px 10px" }}>SEMANAS</div>
          {fetching&&<div style={{ color:C.muted,fontSize:11,padding:6 }}>A carregar...</div>}
          {!fetching&&reports.length===0&&<div style={{ color:C.muted,fontSize:11,padding:6,lineHeight:1.5 }}>Ainda sem relatórios. Clica em “Gerar relatório da semana anterior”.</div>}
          <div style={{ display:"flex",flexDirection:"column",gap:4 }}>
            {reports.map(r=>{
              const active = r.week_start===selected;
              return (
                <button key={r.week_start} onClick={()=>loadWeek(r.week_start)} style={{ textAlign:"left",background:active?"#0a1a2e":"transparent",border:`1px solid ${active?"#1e4d6b":"transparent"}`,borderRadius:6,padding:"8px 10px",cursor:"pointer" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                    <span style={{ fontSize:11,color:active?C.accent:"#e2e8f0" }}>{fmtWeek(r.week_start,r.week_end)}</span>
                    {r.grade&&<span style={{ fontSize:9,color:C.muted }}>{r.grade}</span>}
                  </div>
                  <div style={{ display:"flex",gap:8,marginTop:3,fontSize:9,color:C.muted }}>
                    <span>{r.trades??0} trades</span>
                    <span style={{ color:pnlColor(r.pnl) }}>{r.pnl!=null?(r.pnl>=0?"+":"")+r.pnl:"—"}</span>
                    {r.win_rate!=null&&<span>{r.win_rate}% WR</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Report body */}
        <div style={{ display:"flex",flexDirection:"column",gap:16,minWidth:0 }}>
          {loading&&(
            <div style={{ background:C.card,border:"1px solid #1e4d6b",borderRadius:8,padding:40,textAlign:"center" }}>
              <div style={{ fontSize:24,color:C.accent,marginBottom:12 }}>⬡</div>
              <div style={{ color:"#e2e8f0",fontSize:13,marginBottom:6 }}>A analisar trades, psicologia e screenshots...</div>
              <div style={{ color:C.muted,fontSize:11 }}>O Gemini está a ler os gráficos e a cruzar técnica + estado mental.</div>
            </div>
          )}

          {!loading&&!fetching&&reports.length===0&&(
            <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:40,textAlign:"center" }}>
              <div style={{ fontSize:32,marginBottom:12 }}>⬡</div>
              <div style={{ color:"#e2e8f0",fontSize:14,marginBottom:6 }}>Nenhum relatório semanal ainda</div>
              <div style={{ color:C.muted,fontSize:11,marginBottom:16 }}>Gera o primeiro relatório da semana anterior. O AI Coach lê os teus gráficos e a componente psicológica de cada trade.</div>
            </div>
          )}

          {analysis&&!loading&&(
            <>
              {/* Header + regenerate */}
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                <div style={{ fontSize:14,color:"#e2e8f0",fontWeight:600 }}>Semana {fmtWeek(analysis.week_start,analysis.week_end)} {analysis.grade&&analysis.grade!=="-"&&<span style={{ fontSize:11,color:C.muted }}>· nota {analysis.grade}</span>}</div>
                <button onClick={()=>generate(analysis.week_start,analysis.week_end)} disabled={loading} style={{ background:"transparent",color:C.secondary,border:`1px solid ${C.border}`,padding:"5px 12px",borderRadius:4,fontSize:10,cursor:"pointer" }}>↻ Regenerar</button>
              </div>

              {/* Stats bar */}
              {analysis.week_stats&&(
                <div style={{ display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8 }}>
                  {[
                    {l:"TRADES",v:analysis.week_stats.trades,c:"#e2e8f0"},
                    {l:"WIN RATE",v:analysis.week_stats.win_rate+"%",c:C.blue},
                    {l:"PNL",v:(analysis.week_stats.pnl>=0?"+":"")+analysis.week_stats.pnl,c:pnlColor(analysis.week_stats.pnl)},
                    {l:"AVG RR",v:analysis.week_stats.avg_rr,c:C.accent},
                    {l:"VIOLAÇÕES",v:analysis.week_stats.violations,c:analysis.week_stats.violations>0?C.red:C.green},
                    {l:"SONO/STRESS",v:`${analysis.week_stats.avg_sleep}/${analysis.week_stats.avg_stress}`,c:C.purple},
                  ].map(x=>(
                    <div key={x.l} style={{ background:C.elevated,borderRadius:6,padding:"10px 8px",textAlign:"center" }}>
                      <div style={{ fontSize:8,color:C.muted,letterSpacing:1,marginBottom:4 }}>{x.l}</div>
                      <div style={{ fontSize:15,fontWeight:600,color:x.c }}>{x.v}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Scores + summary */}
              <div style={{ background:C.card,border:"1px solid #1e4d6b",borderRadius:8,padding:20 }}>
                <div style={{ display:"flex",gap:24,alignItems:"center",flexWrap:"wrap" }}>
                  <div style={{ display:"flex",gap:16 }}>
                    {[{s:analysis.overall_score,l:"GERAL",c:C.accent},{s:analysis.technical_score,l:"TÉCNICO",c:C.blue},{s:analysis.psychological_score,l:"PSICOLÓGICO",c:C.purple}].map(x=>(
                      <div key={x.l} style={{ textAlign:"center" }}>
                        <Ring score={x.s||0} color={x.c}/>
                        <div style={{ fontSize:9,color:C.muted,marginTop:4 }}>{x.l}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ flex:1,minWidth:240 }}>
                    <div style={{ fontSize:9,color:"#38bdf8",letterSpacing:2,marginBottom:6 }}>RESUMO DA SEMANA</div>
                    <div style={{ fontSize:13,color:"#e2e8f0",lineHeight:1.7 }}>{analysis.summary}</div>
                  </div>
                </div>
              </div>

              {/* O QUE FAZER / O QUE NÃO FAZER */}
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }}>
                <div style={{ background:C.card,border:"1px solid #14532d",borderRadius:8,padding:16 }}>
                  <div style={{ fontSize:9,color:C.green,letterSpacing:2,marginBottom:12 }}>✓ O QUE FAZER PRÓXIMA SEMANA</div>
                  {(analysis.do_next_week||[]).map((x:string,i:number)=>(
                    <div key={i} style={{ display:"flex",gap:8,padding:"6px 0",borderBottom:"1px solid #1e2d45",fontSize:12 }}>
                      <span style={{ color:C.green }}>✓</span><span style={{ color:C.secondary,lineHeight:1.5 }}>{x}</span>
                    </div>
                  ))}
                </div>
                <div style={{ background:C.card,border:"1px solid #7f1d1d",borderRadius:8,padding:16 }}>
                  <div style={{ fontSize:9,color:C.red,letterSpacing:2,marginBottom:12 }}>✕ O QUE NÃO FAZER</div>
                  {(analysis.dont_next_week||[]).map((x:string,i:number)=>(
                    <div key={i} style={{ display:"flex",gap:8,padding:"6px 0",borderBottom:"1px solid #1e2d45",fontSize:12 }}>
                      <span style={{ color:C.red }}>✕</span><span style={{ color:C.secondary,lineHeight:1.5 }}>{x}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Detailed report */}
              {analysis.detailed_report&&(
                <div style={{ background:"#070b14",border:"1px solid #1e4d6b",borderRadius:8,padding:18 }}>
                  <div style={{ fontSize:9,color:"#38bdf8",letterSpacing:2,marginBottom:12 }}>📄 RELATÓRIO DETALHADO</div>
                  <div style={{ fontSize:12.5,color:"#cbd5e1",lineHeight:1.85,whiteSpace:"pre-wrap" }}>{analysis.detailed_report}</div>
                </div>
              )}

              {/* Screenshot analysis */}
              {(analysis.screenshot_analysis||[]).length>0&&(
                <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16 }}>
                  <div style={{ fontSize:9,color:C.blue,letterSpacing:2,marginBottom:12 }}>🖼 ANÁLISE DOS GRÁFICOS</div>
                  <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
                    {analysis.screenshot_analysis.map((s:any,i:number)=>(
                      <div key={i} style={{ background:C.elevated,borderRadius:6,padding:12,borderLeft:`3px solid ${C.blue}` }}>
                        <div style={{ fontSize:11,color:C.blue,fontWeight:600,marginBottom:4 }}>{s.trade_ref}</div>
                        <div style={{ fontSize:11.5,color:C.secondary,lineHeight:1.6 }}>{s.observation}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Psychological profile */}
              {analysis.psychological_profile&&Object.keys(analysis.psychological_profile).length>0&&(
                <div style={{ background:C.card,border:"1px solid #4a1a6b",borderRadius:8,padding:16 }}>
                  <div style={{ fontSize:9,color:C.purple,letterSpacing:2,marginBottom:14 }}>🧠 PERFIL PSICOLÓGICO</div>
                  <div style={{ display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14 }}>
                    {[
                      {label:"PADRÃO DOMINANTE",value:analysis.psychological_profile.dominant_pattern,color:"#e2e8f0"},
                      {label:"IMPACTO DO SONO",value:analysis.psychological_profile.sleep_impact,color:C.blue},
                      {label:"IMPACTO STRESS/ANSIEDADE",value:analysis.psychological_profile.stress_impact,color:C.amber},
                      {label:"MELHORES CONDIÇÕES",value:analysis.psychological_profile.best_mental_conditions,color:C.green},
                      {label:"PIORES CONDIÇÕES",value:analysis.psychological_profile.worst_mental_conditions,color:C.red},
                    ].filter(x=>x.value).map(x=>(
                      <div key={x.label} style={{ background:C.elevated,borderRadius:6,padding:12 }}>
                        <div style={{ fontSize:9,color:C.muted,letterSpacing:1,marginBottom:6 }}>{x.label}</div>
                        <div style={{ fontSize:11,color:x.color,lineHeight:1.6 }}>{x.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Technical insights */}
              {analysis.technical_insights&&Object.keys(analysis.technical_insights).length>0&&(
                <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16 }}>
                  <div style={{ fontSize:9,color:C.blue,letterSpacing:2,marginBottom:14 }}>📈 LEITURA TÉCNICA</div>
                  <div style={{ display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14 }}>
                    {[
                      {label:"MELHOR SETUP",value:analysis.technical_insights.best_setup,color:C.green},
                      {label:"PIOR SETUP",value:analysis.technical_insights.worst_setup,color:C.red},
                      {label:"QUALIDADE DAS ENTRADAS",value:analysis.technical_insights.entry_quality,color:"#e2e8f0"},
                      {label:"ESTADO MENTAL × EXECUÇÃO",value:analysis.technical_insights.setup_psychology_link,color:C.purple},
                    ].filter(x=>x.value).map(x=>(
                      <div key={x.label} style={{ background:C.elevated,borderRadius:6,padding:12 }}>
                        <div style={{ fontSize:9,color:C.muted,letterSpacing:1,marginBottom:6 }}>{x.label}</div>
                        <div style={{ fontSize:11,color:x.color,lineHeight:1.6 }}>{x.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Strengths + Weaknesses */}
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }}>
                <div style={{ background:C.card,border:"1px solid #14532d",borderRadius:8,padding:16 }}>
                  <div style={{ fontSize:9,color:C.green,letterSpacing:2,marginBottom:14 }}>▲ PONTOS FORTES</div>
                  {(analysis.strengths||[]).map((s:any,i:number)=>(
                    <div key={i} style={{ display:"flex",gap:10,padding:"8px 0",borderBottom:"1px solid #1e2d45" }}>
                      <span style={{ color:C.green,fontSize:14 }}>▲</span>
                      <div><div style={{ fontSize:12,color:"#e2e8f0",fontWeight:500,marginBottom:3 }}>{s.title}</div><div style={{ fontSize:11,color:C.secondary,lineHeight:1.5 }}>{s.detail}</div></div>
                    </div>
                  ))}
                </div>
                <div style={{ background:C.card,border:"1px solid #7f1d1d",borderRadius:8,padding:16 }}>
                  <div style={{ fontSize:9,color:C.red,letterSpacing:2,marginBottom:14 }}>▼ ÁREAS A MELHORAR</div>
                  {(analysis.weaknesses||[]).map((w:any,i:number)=>(
                    <div key={i} style={{ display:"flex",gap:10,padding:"8px 0",borderBottom:"1px solid #1e2d45" }}>
                      <span style={{ color:sevColor(w.severity),fontSize:14 }}>▼</span>
                      <div style={{ flex:1 }}>
                        <div style={{ display:"flex",justifyContent:"space-between",marginBottom:3 }}>
                          <span style={{ fontSize:12,color:"#e2e8f0",fontWeight:500 }}>{w.title}</span>
                          <span style={{ fontSize:9,padding:"1px 7px",borderRadius:10,background:sevColor(w.severity)+"22",color:sevColor(w.severity) }}>{w.severity}</span>
                        </div>
                        <div style={{ fontSize:11,color:C.secondary,lineHeight:1.5 }}>{w.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Patterns */}
              {(analysis.patterns||[]).length>0&&(
                <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16 }}>
                  <div style={{ fontSize:9,color:C.amber,letterSpacing:2,marginBottom:14 }}>◈ PADRÕES DETECTADOS</div>
                  <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:12 }}>
                    {analysis.patterns.map((p:any,i:number)=>(
                      <div key={i} style={{ background:C.elevated,borderRadius:6,padding:14,borderLeft:`3px solid ${C.amber}` }}>
                        <div style={{ fontSize:12,color:"#e2e8f0",fontWeight:500,marginBottom:4 }}>{p.pattern}</div>
                        {p.trigger&&<div style={{ fontSize:10,color:C.muted,marginBottom:4 }}>Trigger: {p.trigger}</div>}
                        {p.impact&&<div style={{ fontSize:11,color:C.red,marginBottom:6 }}>Impacto: {p.impact}</div>}
                        {p.action&&<div style={{ fontSize:11,color:C.accent }}>→ {p.action}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Study plan */}
              {(analysis.study_plan||[]).length>0&&(
                <div style={{ background:C.card,border:"1px solid #1e4d6b",borderRadius:8,padding:16 }}>
                  <div style={{ fontSize:9,color:C.blue,letterSpacing:2,marginBottom:14 }}>📚 PLANO DE ESTUDO</div>
                  <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
                    {analysis.study_plan.map((item:any,i:number)=>(
                      <div key={i} style={{ display:"flex",gap:16,alignItems:"flex-start",padding:"10px 14px",background:C.elevated,borderRadius:6 }}>
                        <div style={{ width:28,height:28,borderRadius:"50%",background:"#1e3a5f",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:C.blue,fontWeight:600,flexShrink:0 }}>{item.priority||i+1}</div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:13,color:"#e2e8f0",fontWeight:500,marginBottom:4 }}>{item.topic}</div>
                          {item.reason&&<div style={{ fontSize:11,color:C.secondary,marginBottom:4 }}>{item.reason}</div>}
                          {item.resource&&<div style={{ fontSize:11,color:C.blue }}>→ {item.resource}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Next week focus */}
              {analysis.next_week_focus&&(
                <div style={{ background:"#0a1a2e",border:`1px solid ${C.accent}44`,borderRadius:8,padding:16 }}>
                  <div style={{ fontSize:9,color:C.accent,letterSpacing:2,marginBottom:8 }}>🎯 FOCO DA PRÓXIMA SEMANA</div>
                  <div style={{ fontSize:13,color:"#e2e8f0",lineHeight:1.7 }}>{analysis.next_week_focus}</div>
                </div>
              )}

              {analysis.generated_at&&<div style={{ fontSize:9,color:C.muted,textAlign:"right" }}>Gerado em {new Date(analysis.generated_at).toLocaleString("pt-PT")}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
