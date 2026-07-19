"use client";
import { useState, useEffect } from "react";

const C = { accent:"#4af0c4",green:"#4ade80",red:"#f87171",amber:"#fbbf24",blue:"#60a5fa",purple:"#c084fc",muted:"#475569",secondary:"#94a3b8",border:"#1e2d45",card:"#0d1929",elevated:"#111827" };

const IMG_LABELS: Record<string,string> = {
  wyckoff_reaccumulation: "Wyckoff — Exemplos Re-Acumulação",
  wyckoff_redistribution: "Wyckoff — Exemplos Re-Distribuição",
  elliott_corrections: "Elliott — Correções Simples (Zigue-Zague)",
  elliott_complex: "Elliott — Correções Complexas (Flat)",
  elliott_triangles: "Elliott — Correções Complexas (Triângulos)",
  smc_liquidity_sweep: "SMC — Liquidity Inflection Areas (Passo 1)",
  smc_choch: "SMC — Change of Character + FVG (Passo 2)",
  smc_fvg_golden_ratio: "SMC — FVG na Golden Ratio 0.618 (Passo 3)",
};

const CATEGORIES = ["Wyckoff+Elliott","Elliott+Wyckoff","ICT","SMC","Price Action","Custom"];

const SETUP_COLORS: Record<string,string> = {
  "Wyckoff+Elliott": "#4af0c4",
  "Elliott+Wyckoff": "#c084fc",
  "ICT": "#60a5fa",
  "SMC": "#fbbf24",
  "Price Action": "#4ade80",
  "Custom": "#94a3b8",
};

function ImgModal({ src, label, onClose }: { src: string; label: string; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:1000,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"zoom-out" }}>
      <div style={{ fontSize:9,color:C.muted,letterSpacing:2,marginBottom:12 }}>{label.toUpperCase()} — CLICA PARA FECHAR</div>
      <img src={src} alt={label} style={{ maxWidth:"90vw",maxHeight:"85vh",objectFit:"contain",borderRadius:8,border:`1px solid ${C.border}` }} onClick={e=>e.stopPropagation()} />
    </div>
  );
}

function StepBadge({ n }: { n: number }) {
  const cols = ["#4af0c4","#c084fc","#60a5fa","#fbbf24","#4ade80"];
  const col = cols[(n-1) % cols.length];
  return (
    <div style={{ width:24,height:24,borderRadius:"50%",background:col+"22",border:`1px solid ${col}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:col,fontWeight:700,flexShrink:0 }}>{n}</div>
  );
}

export default function SetupsPage() {
  const [setups, setSetups] = useState<any[]>([]);
  const [perfMap, setPerfMap] = useState<any>({});
  const [selected, setSelected] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [modal, setModal] = useState<{src:string;label:string}|null>(null);
  const [form, setForm] = useState<any>({ name:"",category:"Custom",description:"",steps:"",timeframes:"",markets:"",confluence:"",invalidation:"",image_refs:"[]" });
  const [activeTab, setActiveTab] = useState<"main"|"ict"|"all">("main");

  const load = () => {
    fetch("/api/setups").then(r=>r.json()).then(setSetups).catch(()=>{});
    fetch("/api/stats").then(r=>r.json()).then(s=>{
      const m: any={};
      (s.bySetup||[]).forEach((x:any)=>{m[x.setup]=x;});
      setPerfMap(m);
    }).catch(()=>{});
  };
  useEffect(()=>{load();},[]);

  const set = (k:string) => (e:any) => setForm((f:any)=>({...f,[k]:e.target.value}));

  const save = async () => {
    if (!form.name) return;
    const method = editing ? "PUT" : "POST";
    await fetch(`/api/setups${editing?`?id=${editing.id}`:""}`, {
      method, headers:{"Content-Type":"application/json"},
      body: JSON.stringify(editing?{...form,id:editing.id}:form),
    });
    setForm({name:"",category:"Custom",description:"",steps:"",timeframes:"",markets:"",confluence:"",invalidation:"",image_refs:"[]"});
    setShowForm(false); setEditing(null); load();
  };

  const startEdit = (s:any) => {
    setForm({name:s.name,category:s.category||"Custom",description:s.description||"",steps:typeof s.steps==="string"?s.steps:"",timeframes:s.timeframes||"",markets:s.markets||"",confluence:s.confluence||"",invalidation:s.invalidation||"",image_refs:s.image_refs||"[]"});
    setEditing(s); setShowForm(true); setSelected(null);
  };

  const parseSteps = (raw: any): string[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return String(raw).split("\n").filter(Boolean); }
  };

  const parseImgRefs = (raw: any): string[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
  };

  const mainSetups = setups.filter(s => ["Wyckoff+Elliott","Elliott+Wyckoff"].includes(s.category));
  const ictSetups = setups.filter(s => ["ICT","SMC"].includes(s.category));
  const allOther = setups.filter(s => !["Wyckoff+Elliott","Elliott+Wyckoff","ICT","SMC"].includes(s.category));

  const displaySetups = activeTab === "main" ? mainSetups : activeTab === "ict" ? ictSetups : setups;

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:20 }}>
      {modal && <ImgModal src={modal.src} label={modal.label} onClose={()=>setModal(null)} />}

      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
        <div>
          <div style={{ fontSize:9,color:C.muted,letterSpacing:2 }}>TRADING OS</div>
          <div style={{ fontSize:22,fontWeight:600,color:C.accent }}>Setups & Estratégias</div>
          <div style={{ fontSize:11,color:C.muted,marginTop:2 }}>Metodologia completa: Wyckoff + Elliott + ICT</div>
        </div>
        <button onClick={()=>{setShowForm(f=>!f);setEditing(null);}} style={{ background:"#0f4c3a",color:C.accent,border:`1px solid ${C.accent}`,padding:"7px 16px",borderRadius:4,fontSize:12 }}>
          {showForm&&!editing?"✕ Fechar":"+ Novo Setup"}
        </button>
      </div>

      {/* MAIN SETUPS HERO */}
      {(activeTab==="main"||activeTab==="all") && mainSetups.length > 0 && (
        <div style={{ background:"#070b14",border:`1px solid #2d4a6b`,borderRadius:12,padding:20 }}>
          <div style={{ fontSize:9,color:"#38bdf8",letterSpacing:2,marginBottom:16 }}>⭐ SETUPS PRINCIPAIS</div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }}>
            {mainSetups.map(s => {
              const p = perfMap[s.name];
              const wr = p?.total>0 ? Math.round((p.wins/p.total)*100) : null;
              const col = SETUP_COLORS[s.category]||C.accent;
              const steps = parseSteps(s.steps);
              const imgs = parseImgRefs(s.image_refs);
              const isOpen = selected?.id === s.id;
              return (
                <div key={s.id} style={{ background:C.card,border:`2px solid ${col}33`,borderRadius:10,overflow:"hidden",cursor:"pointer" }} onClick={()=>setSelected(isOpen?null:s)}>
                  <div style={{ background:col+"11",padding:"14px 16px",borderBottom:`1px solid ${col}22` }}>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
                      <div>
                        <div style={{ fontSize:15,fontWeight:700,color:"#e2e8f0",marginBottom:4 }}>{s.name}</div>
                        <span style={{ fontSize:9,padding:"2px 10px",borderRadius:10,background:col+"22",color:col,fontWeight:600 }}>{s.category}</span>
                      </div>
                      {wr!==null && (
                        <div style={{ textAlign:"right" }}>
                          <div style={{ fontSize:20,fontWeight:700,color:wr>=60?C.green:wr>=45?C.amber:C.red }}>{wr}%</div>
                          <div style={{ fontSize:9,color:C.muted }}>win rate</div>
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize:11,color:C.secondary,marginTop:10,lineHeight:1.6 }}>{s.description}</div>
                  </div>

                  {/* Steps always visible */}
                  <div style={{ padding:16 }}>
                    <div style={{ fontSize:9,color:C.muted,letterSpacing:1.5,marginBottom:10 }}>PROCESSO DE ENTRADA</div>
                    {steps.map((step,i) => (
                      <div key={i} style={{ display:"flex",gap:10,alignItems:"flex-start",marginBottom:8 }}>
                        <StepBadge n={i+1} />
                        <div style={{ fontSize:11,color:C.secondary,lineHeight:1.5,paddingTop:4 }}>{step.replace(/^\d+\.\s*/,"")}</div>
                      </div>
                    ))}

                    {/* Performance */}
                    {p && (
                      <div style={{ display:"flex",gap:16,marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}` }}>
                        <div><div style={{ fontSize:9,color:C.muted }}>TRADES</div><div style={{ fontSize:13,color:C.secondary,fontWeight:500 }}>{p.total}</div></div>
                        <div><div style={{ fontSize:9,color:C.muted }}>P&L</div><div style={{ fontSize:13,fontWeight:600,color:Number(p.pnl)>=0?C.green:C.red }}>${Number(p.pnl).toFixed(0)}</div></div>
                        <div><div style={{ fontSize:9,color:C.muted }}>RR MED</div><div style={{ fontSize:13,color:C.amber }}>1:{Number(p.avg_rr||0).toFixed(1)}</div></div>
                        <div style={{ marginLeft:"auto" }}>
                          <button onClick={e=>{e.stopPropagation();startEdit(s);}} style={{ background:"transparent",color:C.muted,border:`1px solid ${C.border}`,padding:"3px 10px",borderRadius:4,fontSize:10 }}>Editar</button>
                        </div>
                      </div>
                    )}

                    {/* Reference Images */}
                    {imgs.length > 0 && (
                      <div style={{ marginTop:14 }}>
                        <div style={{ fontSize:9,color:C.muted,letterSpacing:1.5,marginBottom:8 }}>REFERÊNCIAS VISUAIS — CLICA PARA AMPLIAR</div>
                        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:8 }}>
                          {imgs.map((ref:string)=>(
                            <div key={ref}
                              onClick={e=>{e.stopPropagation();setModal({src:ref.startsWith("smc_")?`/smc/${ref}.png`:`/methodology/${ref}.png`,label:IMG_LABELS[ref]||ref});}}
                              style={{ background:C.elevated,borderRadius:6,overflow:"hidden",cursor:"zoom-in",border:`1px solid ${C.border}` }}>
                              <img src={ref.startsWith("smc_")?`/smc/${ref}.png`:`/methodology/${ref}.png`} alt={IMG_LABELS[ref]||ref}
                                style={{ width:"100%",height:80,objectFit:"cover",objectPosition:"top" }}
                                onError={e=>{(e.target as HTMLImageElement).style.display="none";}} />
                              <div style={{ padding:"4px 6px",fontSize:8,color:C.muted,lineHeight:1.3 }}>{IMG_LABELS[ref]||ref}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Confluence + Invalidation when expanded */}
                    {isOpen && (
                      <div style={{ marginTop:14,paddingTop:12,borderTop:`1px solid ${C.border}` }}>
                        {s.confluence && (
                          <div style={{ marginBottom:10 }}>
                            <div style={{ fontSize:9,color:C.accent,letterSpacing:1.5,marginBottom:4 }}>CONFLUÊNCIAS OBRIGATÓRIAS</div>
                            <div style={{ fontSize:11,color:C.secondary,lineHeight:1.6 }}>{s.confluence}</div>
                          </div>
                        )}
                        {s.invalidation && (
                          <div>
                            <div style={{ fontSize:9,color:C.red,letterSpacing:1.5,marginBottom:4 }}>INVALIDAÇÃO — NÃO ENTRAR SE:</div>
                            <div style={{ fontSize:11,color:"#fca5a5",lineHeight:1.6 }}>{s.invalidation}</div>
                          </div>
                        )}
                        {s.timeframes && (
                          <div style={{ marginTop:10,fontSize:10,color:C.muted }}>
                            <span style={{ color:C.accent }}>Timeframes: </span>{s.timeframes}
                            <span style={{ color:C.accent,marginLeft:16 }}>Mercados: </span>{s.markets}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Reference Images Gallery */}
      <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16 }}>
        <div style={{ fontSize:9,color:C.muted,letterSpacing:2,marginBottom:12 }}>📚 BIBLIOTECA VISUAL — METODOLOGIA (clica para ampliar)</div>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10 }}>
          {Object.entries(IMG_LABELS).filter(([key])=>!key.startsWith("smc_")).map(([key,label])=>(
            <div key={key}
              onClick={()=>setModal({src:`/methodology/${key}.png`,label})}
              style={{ background:C.elevated,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",cursor:"zoom-in",transition:"border-color 0.15s" }}
              onMouseEnter={e=>(e.currentTarget.style.borderColor="#2d4a6b")}
              onMouseLeave={e=>(e.currentTarget.style.borderColor=C.border)}>
              <img src={`/methodology/${key}.png`} alt={label}
                style={{ width:"100%",height:90,objectFit:"cover",objectPosition:"top" }} />
              <div style={{ padding:"6px 8px",fontSize:9,color:C.secondary,lineHeight:1.4 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs for other setups */}
      <div style={{ display:"flex",gap:4,borderBottom:`1px solid ${C.border}`,paddingBottom:0 }}>
        {[["main","Setups Principais"],["ict","ICT / SMC"],["all","Todos"]].map(([id,label])=>(
          <button key={id} onClick={()=>setActiveTab(id as any)} style={{
            padding:"6px 16px",fontSize:11,borderRadius:"4px 4px 0 0",cursor:"pointer",
            background:activeTab===id?C.elevated:"transparent",
            color:activeTab===id?"#e2e8f0":C.muted,
            border:`1px solid ${activeTab===id?C.border:"transparent"}`,
            borderBottom:activeTab===id?"none":"1px solid "+C.border,
          }}>{label}</button>
        ))}
      </div>

      {/* ICT/SMC Setups Grid */}
      {activeTab !== "main" && (
        <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:14 }}>
          {(activeTab==="ict"?ictSetups:[...ictSetups,...allOther]).map(s=>{
            const p=perfMap[s.name];
            const wr=p?.total>0?Math.round((p.wins/p.total)*100):null;
            const col=SETUP_COLORS[s.category]||C.muted;
            const steps=parseSteps(s.steps);
            const isOpen=selected?.id===s.id;
            return (
              <div key={s.id} onClick={()=>setSelected(isOpen?null:s)}
                style={{ background:C.card,border:`1px solid ${isOpen?"#2d4a6b":C.border}`,borderRadius:8,cursor:"pointer" }}>
                <div style={{ padding:14 }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8 }}>
                    <div>
                      <div style={{ fontSize:13,fontWeight:600,color:"#e2e8f0",marginBottom:3 }}>{s.name}</div>
                      <span style={{ fontSize:9,padding:"1px 8px",borderRadius:10,background:col+"22",color:col }}>{s.category}</span>
                    </div>
                    {wr!==null&&<span style={{ fontSize:12,fontWeight:600,color:wr>=60?C.green:wr>=45?C.amber:C.red }}>{wr}%</span>}
                  </div>
                  <div style={{ fontSize:11,color:C.secondary,lineHeight:1.5,marginBottom:10 }}>{s.description}</div>
                  <div style={{ fontSize:10,color:C.muted }}>
                    <span style={{ color:C.accent }}>TF:</span> {s.timeframes||"—"} &nbsp;
                    <span style={{ color:C.accent }}>Markets:</span> {s.markets||"—"}
                  </div>
                  {p&&(
                    <div style={{ display:"flex",gap:14,marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`,fontSize:11 }}>
                      <span style={{ color:C.muted }}>{p.total} trades</span>
                      <span style={{ color:Number(p.pnl)>=0?C.green:C.red,fontWeight:600 }}>${Number(p.pnl).toFixed(0)}</span>
                      <span style={{ color:C.amber }}>1:{Number(p.avg_rr||0).toFixed(1)} RR</span>
                      <button onClick={e=>{e.stopPropagation();startEdit(s);}} style={{ marginLeft:"auto",background:"transparent",color:C.muted,border:`1px solid ${C.border}`,padding:"2px 8px",borderRadius:4,fontSize:10 }}>Editar</button>
                    </div>
                  )}
                </div>
                {isOpen&&(
                  <div style={{ borderTop:`1px solid ${C.border}`,padding:14,background:"#060a12" }}>
                    {steps.length>0&&(
                      <div style={{ marginBottom:12 }}>
                        <div style={{ fontSize:9,color:C.muted,letterSpacing:1.5,marginBottom:8 }}>PASSOS DE ENTRADA</div>
                        {steps.map((step,i)=>(
                          <div key={i} style={{ display:"flex",gap:8,marginBottom:6,fontSize:11,color:C.secondary }}>
                            <span style={{ color:col,fontWeight:600,minWidth:16 }}>{i+1}.</span>
                            <span>{step.replace(/^\d+\.\s*/,"")}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {s.confluence&&<div style={{ marginBottom:8 }}><div style={{ fontSize:9,color:C.accent,letterSpacing:1.5,marginBottom:4 }}>CONFLUÊNCIAS</div><div style={{ fontSize:11,color:C.secondary }}>{s.confluence}</div></div>}
                    {s.invalidation&&<div><div style={{ fontSize:9,color:C.red,letterSpacing:1.5,marginBottom:4 }}>INVALIDAÇÃO</div><div style={{ fontSize:11,color:"#fca5a5" }}>{s.invalidation}</div></div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:20 }}>
          <div style={{ fontSize:9,color:C.muted,letterSpacing:2,marginBottom:14 }}>{editing?"EDITAR SETUP":"NOVO SETUP"}</div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12,marginBottom:12 }}>
            {[["name","Nome"],["category","Categoria (dropdown)"],["timeframes","Timeframes"],["markets","Mercados"]].map(([k,l])=>(
              <div key={k}>
                <div style={{ fontSize:9,color:C.muted,letterSpacing:1.5,marginBottom:4 }}>{l.toUpperCase()}</div>
                {k==="category"
                  ?<select value={form.category} onChange={set("category")} style={{ width:"100%" }}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select>
                  :<input value={form[k]} onChange={set(k)} style={{ width:"100%" }} />
                }
              </div>
            ))}
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12 }}>
            <div><div style={{ fontSize:9,color:C.muted,letterSpacing:1.5,marginBottom:4 }}>DESCRIÇÃO</div><textarea value={form.description} onChange={set("description")} rows={3} style={{ width:"100%",resize:"vertical" }}/></div>
            <div><div style={{ fontSize:9,color:C.muted,letterSpacing:1.5,marginBottom:4 }}>CONFLUÊNCIAS</div><textarea value={form.confluence} onChange={set("confluence")} rows={3} style={{ width:"100%",resize:"vertical" }}/></div>
          </div>
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:9,color:C.muted,letterSpacing:1.5,marginBottom:4 }}>PASSOS (JSON array ou um por linha)</div>
            <textarea value={form.steps} onChange={set("steps")} rows={6} placeholder={'["1. Passo um","2. Passo dois"]'} style={{ width:"100%",resize:"vertical" }}/>
          </div>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:9,color:C.muted,letterSpacing:1.5,marginBottom:4 }}>INVALIDAÇÃO</div>
            <textarea value={form.invalidation} onChange={set("invalidation")} rows={2} style={{ width:"100%",resize:"vertical" }}/>
          </div>
          <div style={{ display:"flex",gap:10,justifyContent:"flex-end" }}>
            <button onClick={()=>{setShowForm(false);setEditing(null);}} style={{ background:"transparent",color:C.muted,border:`1px solid ${C.border}`,padding:"6px 14px",borderRadius:4,fontSize:12 }}>Cancelar</button>
            <button onClick={save} style={{ background:"#0f4c3a",color:C.accent,border:`1px solid ${C.accent}`,padding:"6px 16px",borderRadius:4,fontSize:12 }}>✓ Guardar</button>
          </div>
        </div>
      )}
    </div>
  );
}
