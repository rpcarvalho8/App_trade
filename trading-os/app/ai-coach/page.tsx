"use client";
import { useState, useEffect } from "react";

const C = { accent:"#4af0c4",green:"#4ade80",red:"#f87171",amber:"#fbbf24",blue:"#60a5fa",purple:"#c084fc",muted:"#475569",secondary:"#94a3b8",border:"#1e2d45",card:"#0d1929",elevated:"#111827" };

function Ring({ score, color }: { score: number; color: string }) {
  const r=36,cx=44,cy=44,circ=2*Math.PI*r,fill=(score/10)*circ;
  return (
    <div style={{ position:"relative",width:88,height:88 }}>
      <svg width={88} height={88}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e2d45" strokeWidth={6}/>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={6} strokeDasharray={`${fill} ${circ}`} strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}/>
      </svg>
      <div style={{ position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center" }}>
        <div style={{ fontSize:22,fontWeight:700,color }}>{score}</div>
        <div style={{ fontSize:8,color:C.muted }}>/ 10</div>
      </div>
    </div>
  );
}

export default function AICoachPage() {
  const [analysis, setAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [err, setErr] = useState("");

  useEffect(()=>{
    fetch("/api/ai-analysis").then(r=>r.json()).then(d=>{setAnalysis(d);setFetching(false);}).catch(()=>setFetching(false));
  },[]);

  const run = async () => {
    setLoading(true); setErr("");
    try {
      const res = await fetch("/api/ai-analysis",{method:"POST"});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAnalysis(await res.json());
    } catch(e:any){ setErr("Erro ao gerar análise. Verifica ANTHROPIC_API_KEY no .env.local"); }
    setLoading(false);
  };

  const sevColor = (s:string) => s==="high"?C.red:s==="medium"?C.amber:C.muted;

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:20 }}>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
        <div>
          <div style={{ fontSize:9,color:C.muted,letterSpacing:2 }}>TRADING OS</div>
          <div style={{ fontSize:22,fontWeight:600,color:C.accent }}>AI Coach</div>
          <div style={{ fontSize:11,color:C.muted,marginTop:2 }}>Análise completa: técnica + psicológica — powered by Claude Opus</div>
        </div>
        <div style={{ display:"flex",flexDirection:"column",gap:6,alignItems:"flex-end" }}>
          <button onClick={run} disabled={loading} style={{ background:loading?"#0f3028":"#0f4c3a",color:loading?"#2d8a6e":C.accent,border:`1px solid ${loading?"#2d8a6e":C.accent}`,padding:"8px 18px",borderRadius:4,fontSize:12 }}>
            {loading?"⬡ A analisar trades + psicologia...":"⬡ Gerar Análise Completa"}
          </button>
          {analysis&&<div style={{ fontSize:9,color:C.muted }}>Última análise disponível</div>}
        </div>
      </div>

      {err&&<div style={{ background:"#3b0f0f",border:"1px solid #7f1d1d",borderRadius:8,padding:14,color:C.red,fontSize:12 }}>⚠ {err}<div style={{ marginTop:6,fontSize:10,color:"#f87171aa" }}>Adiciona ao .env.local: <code>ANTHROPIC_API_KEY=sk-ant-...</code></div></div>}

      {fetching&&<div style={{ color:C.muted,fontSize:12 }}>A carregar análise anterior...</div>}

      {!fetching&&!analysis&&!loading&&(
        <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:40,textAlign:"center" }}>
          <div style={{ fontSize:32,marginBottom:12 }}>⬡</div>
          <div style={{ color:"#e2e8f0",fontSize:14,marginBottom:6 }}>Nenhuma análise ainda</div>
          <div style={{ color:C.muted,fontSize:11,marginBottom:16 }}>Regista trades e logs mentais, depois clica em "Gerar Análise Completa".</div>
          <div style={{ fontSize:10,color:C.muted }}>O AI Coach analisa padrões técnicos (Elliott, Wyckoff, chocks) E psicológicos (sono, stress, FOMO, revenge).</div>
        </div>
      )}

      {loading&&(
        <div style={{ background:C.card,border:"1px solid #1e4d6b",borderRadius:8,padding:40,textAlign:"center" }}>
          <div style={{ fontSize:24,color:C.accent,marginBottom:12 }}>⬡</div>
          <div style={{ color:"#e2e8f0",fontSize:13,marginBottom:6 }}>A analisar trades, psicologia e padrões...</div>
          <div style={{ color:C.muted,fontSize:11 }}>O Claude Opus está a processar técnica + estado mental + correlações.</div>
        </div>
      )}

      {analysis&&!loading&&(
        <>
          {/* Scores */}
          <div style={{ background:C.card,border:"1px solid #1e4d6b",borderRadius:8,padding:20 }}>
            <div style={{ display:"flex",gap:24,alignItems:"center" }}>
              <div style={{ display:"flex",gap:20 }}>
                <div style={{ textAlign:"center" }}>
                  <Ring score={analysis.overall_score||0} color={C.accent}/>
                  <div style={{ fontSize:9,color:C.muted,marginTop:4 }}>GERAL</div>
                </div>
                <div style={{ textAlign:"center" }}>
                  <Ring score={analysis.technical_score||0} color={C.blue}/>
                  <div style={{ fontSize:9,color:C.muted,marginTop:4 }}>TÉCNICO</div>
                </div>
                <div style={{ textAlign:"center" }}>
                  <Ring score={analysis.psychological_score||0} color={C.purple}/>
                  <div style={{ fontSize:9,color:C.muted,marginTop:4 }}>PSICOLÓGICO</div>
                </div>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:9,color:"#38bdf8",letterSpacing:2,marginBottom:6 }}>RESUMO</div>
                <div style={{ fontSize:13,color:"#e2e8f0",lineHeight:1.7,marginBottom:14 }}>{analysis.summary}</div>
                <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10 }}>
                  {[
                    {label:"MELHOR SETUP",value:analysis.technical_insights?.best_setup,color:C.green},
                    {label:"FOCO PRÓX. SEMANA",value:analysis.next_week_focus,color:C.accent},
                    {label:"EVITAR",value:analysis.avoid_this_week,color:C.red},
                  ].map(x=>(
                    <div key={x.label} style={{ background:"#0a1a2e",borderRadius:6,padding:10 }}>
                      <div style={{ fontSize:9,color:C.muted,letterSpacing:1,marginBottom:4 }}>{x.label}</div>
                      <div style={{ fontSize:11,color:x.color,lineHeight:1.4 }}>{x.value||"—"}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Psychological Profile */}
          {analysis.psychological_profile&&(
            <div style={{ background:C.card,border:"1px solid #4a1a6b",borderRadius:8,padding:16 }}>
              <div style={{ fontSize:9,color:C.purple,letterSpacing:2,marginBottom:14 }}>🧠 PERFIL PSICOLÓGICO</div>
              <div style={{ display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14 }}>
                {[
                  {label:"PADRÃO DOMINANTE",value:analysis.psychological_profile.dominant_pattern,color:"#e2e8f0"},
                  {label:"IMPACTO DO SONO",value:analysis.psychological_profile.sleep_impact,color:C.blue},
                  {label:"IMPACTO DO STRESS/ANSIEDADE",value:analysis.psychological_profile.stress_impact,color:C.amber},
                  {label:"MELHORES CONDIÇÕES",value:analysis.psychological_profile.best_mental_conditions,color:C.green},
                ].map(x=>(
                  <div key={x.label} style={{ background:C.elevated,borderRadius:6,padding:12 }}>
                    <div style={{ fontSize:9,color:C.muted,letterSpacing:1,marginBottom:6 }}>{x.label}</div>
                    <div style={{ fontSize:11,color:x.color,lineHeight:1.6 }}>{x.value||"—"}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sizing + Pre-session rules */}
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }}>
            {analysis.sizing_rules&&(
              <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16 }}>
                <div style={{ fontSize:9,color:C.amber,letterSpacing:2,marginBottom:12 }}>💰 REGRAS DE SIZING PERSONALIZADAS</div>
                <div style={{ fontSize:12,color:"#e2e8f0",lineHeight:1.7 }}>{analysis.sizing_rules}</div>
              </div>
            )}
            {analysis.pre_session_rules&&(
              <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16 }}>
                <div style={{ fontSize:9,color:C.green,letterSpacing:2,marginBottom:12 }}>✓ REGRAS PRÉ-SESSÃO PERSONALIZADAS</div>
                {(analysis.pre_session_rules||[]).map((r:string,i:number)=>(
                  <div key={i} style={{ display:"flex",gap:8,padding:"5px 0",borderBottom:"1px solid #1e2d45",fontSize:11 }}>
                    <span style={{ color:C.green,fontWeight:600 }}>{i+1}.</span>
                    <span style={{ color:C.secondary }}>{r}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Strengths + Weaknesses */}
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }}>
            <div style={{ background:C.card,border:"1px solid #14532d",borderRadius:8,padding:16 }}>
              <div style={{ fontSize:9,color:C.green,letterSpacing:2,marginBottom:14 }}>✓ PONTOS FORTES</div>
              {(analysis.strengths||[]).map((s:any,i:number)=>(
                <div key={i} style={{ display:"flex",gap:10,padding:"8px 0",borderBottom:"1px solid #1e2d45" }}>
                  <span style={{ color:C.green,fontSize:14 }}>▲</span>
                  <div><div style={{ fontSize:12,color:"#e2e8f0",fontWeight:500,marginBottom:3 }}>{s.title}</div><div style={{ fontSize:11,color:C.secondary,lineHeight:1.5 }}>{s.detail}</div></div>
                </div>
              ))}
            </div>
            <div style={{ background:C.card,border:"1px solid #7f1d1d",borderRadius:8,padding:16 }}>
              <div style={{ fontSize:9,color:C.red,letterSpacing:2,marginBottom:14 }}>⚠ ÁREAS A MELHORAR</div>
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
          <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16 }}>
            <div style={{ fontSize:9,color:C.amber,letterSpacing:2,marginBottom:14 }}>◈ PADRÕES DETECTADOS (técnicos + psicológicos)</div>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:12 }}>
              {(analysis.patterns||[]).map((p:any,i:number)=>(
                <div key={i} style={{ background:C.elevated,borderRadius:6,padding:14,borderLeft:`3px solid ${C.amber}` }}>
                  <div style={{ fontSize:12,color:"#e2e8f0",fontWeight:500,marginBottom:4 }}>{p.pattern}</div>
                  {p.trigger&&<div style={{ fontSize:10,color:C.muted,marginBottom:4 }}>Trigger: {p.trigger}</div>}
                  <div style={{ fontSize:11,color:C.red,marginBottom:6 }}>Impacto: {p.impact}</div>
                  <div style={{ fontSize:11,color:C.accent }}>→ {p.action}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Decision Framework */}
          {analysis.decision_framework&&(
            <div style={{ background:"#070b14",border:"1px solid #1e4d6b",borderRadius:8,padding:16 }}>
              <div style={{ fontSize:9,color:"#38bdf8",letterSpacing:2,marginBottom:10 }}>🎯 FRAMEWORK DE DECISÃO PERSONALIZADO</div>
              <div style={{ fontSize:12,color:"#e2e8f0",lineHeight:1.8 }}>{analysis.decision_framework}</div>
            </div>
          )}

          {/* Study Plan */}
          <div style={{ background:C.card,border:"1px solid #1e4d6b",borderRadius:8,padding:16 }}>
            <div style={{ fontSize:9,color:C.blue,letterSpacing:2,marginBottom:14 }}>📚 PLANO DE ESTUDO PERSONALIZADO</div>
            <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
              {(analysis.study_plan||[]).map((item:any)=>(
                <div key={item.priority} style={{ display:"flex",gap:16,alignItems:"flex-start",padding:"10px 14px",background:C.elevated,borderRadius:6 }}>
                  <div style={{ width:28,height:28,borderRadius:"50%",background:"#1e3a5f",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:C.blue,fontWeight:600,flexShrink:0 }}>{item.priority}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13,color:"#e2e8f0",fontWeight:500,marginBottom:4 }}>{item.topic}</div>
                    <div style={{ fontSize:11,color:C.secondary,marginBottom:4 }}>{item.reason}</div>
                    <div style={{ fontSize:11,color:C.blue }}>→ {item.resource}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
