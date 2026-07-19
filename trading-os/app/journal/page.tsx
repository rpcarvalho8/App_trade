"use client";
import { useState, useEffect, useRef } from "react";

const C = { accent:"#4af0c4",green:"#4ade80",red:"#f87171",amber:"#fbbf24",blue:"#60a5fa",purple:"#c084fc",muted:"#475569",secondary:"#94a3b8",border:"#1e2d45",card:"#0d1929",elevated:"#111827" };

const PAIRS = ["EUR/USD","GBP/USD","USD/JPY","GBP/JPY","USD/CHF","AUD/USD","NZD/USD","EUR/GBP","EUR/JPY", "USD/CAD","NAS100","US500","GER40","GOLD","BTC/USD","ETH/USD", "SOL/USD", "XRP/USD","Outro"];
const SESSIONS = ["London","NY","Asia","London+NY","Pre-Market","Overnight"];
const WYCKOFF_PHASES = ["","Acumulação Fase A","Acumulação Fase B","Acumulação Fase C (Spring)","Acumulação Fase D","Acumulação Fase E","Distribuição Fase A","Distribuição Fase B","Distribuição Fase C (UTAD)","Distribuição Fase D","Distribuição Fase E","Re-Acumulação","Re-Distribuição"];
const WYCKOFF_EVENTS = ["","Spring","Test de Spring","UTAD","Test de UTAD","SOS (Sign of Strength)","SOW (Sign of Weakness)","LPS (Last Point of Support)","LPSY (Last Point of Supply)","BUEC","BU (BackUp)","JAC","SC (Selling Climax)","BC (Buying Climax)","AR (Auto Rally)","ST (Secondary Test)","UA (Upthrust Action)","mSOW (minor SOW)"];
const ELLIOTT_WAVES = ["","Onda 1 (impulso)","Onda 2 (correção)","Onda 3 (impulso — mais forte)","Onda 4 (correção)","Onda 5 (impulso — exaustão)","Onda A (correção)","Onda B (correção — armadilha)","Onda C (correção — forte)","Zigue-Zague simples ABC (5-3-5)","Flat regular (3-3-5)","Flat irregular (3-3-5, B>topo)","Flat interrompida (C=61.8% A)","Triângulo ascendente (3-3-3-3-3)","Triângulo descendente (3-3-3-3-3)","Triângulo simétrico (3-3-3-3-3)","ABCD padrão","Extensão Onda 3 (161.8%)","Extensão Onda 5"];
const SHOCK_TYPES = ["","Spring (quebra suporte + recuperação)","UTAD (quebra resistência + reversão)","Ordinary Shakeout","Ordinary Upthrust","Minor Spring","Minor UTAD","Liquidity Sweep BSL","Liquidity Sweep SSL","Terminal Shakeout"];
const EMOTIONAL_STATES = ["Calmo e focado","Normal","Ligeiramente ansioso","Ansioso","Nervoso","Com medo","Confiante (bom)","Overconfident","Frustrado","Stressado","Cansado","Entusiasmado (bom)","Imóvel/bloqueado","Revenge mindset"];

// ─── Reference Panel Content ───────────────────────────────────────────────
const WYCKOFF_REF = {
  title: "Wyckoff — Guia Rápido",
  color: "#4af0c4",
  sections: [
    {
      label: "FASES (Acumulação)",
      items: [
        { name:"Fase A", desc:"Para a tendência descendente. Eventos: PS, SC, AR, ST. Preço muda de tendência para lateralização." },
        { name:"Fase B", desc:"Construção da causa. Testes nos extremos. UA (testa resistência), ST as SOW (testa suporte). Volume diminui gradualmente." },
        { name:"Fase C", desc:"TESTE CHAVE. Spring (quebra suporte + recuperação rápida). Confirma que oferta está esgotada. Melhor entrada." },
        { name:"Fase D", desc:"Tendência ascendente dentro do range. SOS quebra resistência. LPS são retrações. BUEC = retorno ao Creek." },
        { name:"Fase E", desc:"Tendência fora do range. Sucessão de SOS e LPS. Estruturas de re-acumulação ao longo do caminho." },
      ]
    },
    {
      label: "FASES (Distribuição)",
      items: [
        { name:"Fase A", desc:"Para tendência ascendente. Eventos: PSY, BC, AR, ST. Começa lateralização." },
        { name:"Fase B", desc:"Construção da causa distributiva. UT testa resistência. mSOW testa suporte. Volume alto e constante." },
        { name:"Fase C", desc:"UTAD = Upthrust After Distribution. Quebra resistência + reversão. Confirma distribuição. Melhor short." },
        { name:"Fase D", desc:"Tendência descendente dentro do range. MSOW quebra suporte (ICE). LPSY são recuperações fracas." },
        { name:"Fase E", desc:"Tendência descendente fora do range. Estruturas de re-distribuição ao longo do caminho." },
      ]
    },
    {
      label: "EVENTOS CHAVE",
      items: [
        { name:"Spring / UTAD", desc:"O evento mais poderoso. Armadilha de liquidez. Spring = falsa quebra de suporte. UTAD = falsa quebra de resistência." },
        { name:"SOS / SOW", desc:"Sign of Strength / Weakness. Movimento que quebra o range com volume. Confirma a direção." },
        { name:"LPS / LPSY", desc:"Último suporte/resistência antes do impulso. Excelente entrada após SOS/SOW confirmado." },
        { name:"BUEC", desc:"BackUp to Edge of Creek. Retorno ao nível quebrado para confirmar. Alta probabilidade de continuação." },
        { name:"Creek / ICE", desc:"Creek = linha de resistência em acumulação. ICE = linha de suporte em distribuição." },
      ]
    },
    {
      label: "IMAGENS DE REFERÊNCIA",
      images: [
        { src:"/methodology/wyckoff_reaccumulation.png", label:"Re-Acumulação — exemplos reais" },
        { src:"/methodology/wyckoff_redistribution.png", label:"Re-Distribuição — exemplos reais" },
      ]
    }
  ]
};

const ELLIOTT_REF = {
  title: "Elliott Wave — Guia Rápido",
  color: "#c084fc",
  sections: [
    {
      label: "ONDAS DE IMPULSO (1-2-3-4-5)",
      items: [
        { name:"Onda 1", desc:"Primeiro impulso. Muitas vezes fraco, confundido com correção. Breakout inicial." },
        { name:"Onda 2", desc:"Correção da 1. Nunca ultrapassa o início da 1. Geralmente retrocede 61.8% da onda 1." },
        { name:"Onda 3", desc:"A mais longa e forte. Mínimo 161.8% da onda 1. Volume máximo. Tendência clara." },
        { name:"Onda 4", desc:"Correção da 3. Não sobrepõe o topo da onda 1. Geralmente retrocede 38.2% da onda 3." },
        { name:"Onda 5", desc:"Último impulso. Frequentemente com divergência. Volume menor que onda 3. Exaustão final." },
      ]
    },
    {
      label: "ONDAS CORRETIVAS (A-B-C)",
      items: [
        { name:"Onda A", desc:"Primeiro movimento corretivo. 5 subondas em Zigue-Zague, 3 em Flat." },
        { name:"Onda B", desc:"Recuperação/armadilha dentro da correção. Pode ultrapassar o topo anterior (flat irregular)." },
        { name:"Onda C", desc:"Finaliza a correção. Frequentemente igual à A (100%) ou 161.8% da A. 5 subondas." },
      ]
    },
    {
      label: "TIPOS DE CORREÇÃO",
      items: [
        { name:"Zigue-Zague (5-3-5)", desc:"Correção simples. Onda C = 100% ou 161.8% da A. Rápida e profunda. Retrocede 50-61.8% do impulso." },
        { name:"Flat Regular (3-3-5)", desc:"B chega ao topo de A. C desce até ao fim de A. Todas trabalham em 3-3-5." },
        { name:"Flat Irregular (3-3-5)", desc:"B ultrapassa o topo de A. C vai mais baixo (161.8% de A). Aparência de novo máximo — armadilha." },
        { name:"Flat Interrompida (3-3-5)", desc:"C = 61.8% de A. Não chega ao fim de A. Mercado muito forte — sinal de força." },
        { name:"Triângulo (3-3-3-3-3)", desc:"5 ondas (a-b-c-d-e) em convergência. Sempre antes da última onda do movimento. Breakout explosivo." },
      ]
    },
    {
      label: "FIBONACCI CHAVE",
      items: [
        { name:"Retrocessos", desc:"23.6% / 38.2% / 50% / 61.8% / 78.6%. Onda 2 → 61.8%. Onda 4 → 38.2%. Onda B → 50-61.8%." },
        { name:"Extensões", desc:"127.2% / 161.8% / 200% / 261.8%. Onda 3 → 161.8% min. Onda C → 100-161.8% de A." },
        { name:"Regra da Alternância", desc:"Se onda 2 é simples (ZZ), onda 4 será complexa (flat/triangle) e vice-versa." },
      ]
    },
    {
      label: "IMAGENS DE REFERÊNCIA",
      images: [
        { src:"/methodology/elliott_corrections.png", label:"Correções Simples — Zigue-Zague" },
        { src:"/methodology/elliott_complex.png", label:"Correções Complexas — Flat" },
        { src:"/methodology/elliott_triangles.png", label:"Correções Complexas — Triângulos" },
      ]
    }
  ]
};

const SMC_REF = {
  title: "SMC / ICT — Guia Rápido",
  color: "#60a5fa",
  sections: [
    {
      label: "ESTRUTURA DE MERCADO",
      items: [
        { name:"BOS (Break of Structure)", desc:"Quebra de estrutura na direção da tendência. Confirma continuação. HTF > LTF." },
        { name:"MSS (Market Structure Shift)", desc:"Mudança de estrutura — inversão de tendência. HH→LL ou LL→HH. Ponto de entrada." },
        { name:"ChoCH (Change of Character)", desc:"Primeira quebra contra a tendência. Alerta para possível MSS. Não confirma sozinho." },
        { name:"Highs & Lows", desc:"HH/HL = uptrend. LH/LL = downtrend. Equal Highs/Lows = liquidez acumulada." },
      ]
    },
    {
      label: "ZONAS CHAVE",
      items: [
        { name:"Order Block (OB)", desc:"Última vela de corpo oposto antes de um movimento impulsivo. Zona onde instituições entraram. Preço retorna para testar." },
        { name:"FVG (Fair Value Gap)", desc:"Gap de 3 velas — desequilíbrio de preço. Preço tende a preencher. Zona de alta probabilidade." },
        { name:"Breaker Block", desc:"OB que foi violado e inverte função (suporte → resistência ou vice-versa)." },
        { name:"Mitigation Block", desc:"Zona onde ordens pendentes foram parcialmente preenchidas. Preço retorna para completar." },
        { name:"Liquidity (BSL/SSL)", desc:"Buy-Side Liquidity = stops acima de highs. Sell-Side = stops abaixo de lows. Instituições caçam esses níveis." },
      ]
    },
    {
      label: "CONCEITOS DE ENTRADA",
      items: [
        { name:"Liquidity Sweep", desc:"Movimento que vai buscar liquidez (stops) acima/abaixo de um nível e reverte. Spring/UTAD do Wyckoff." },
        { name:"CISD (Change in State of Delivery)", desc:"Mudança de velas de bearish para bullish (ou vice-versa) após sweep. Confirma reversão." },
        { name:"Silver Bullet (10h-11h NY)", desc:"Setup ICT das 10h-11h NY: FVG formado entre 9h30-10h, retorno ao FVG, entrada precisa." },
        { name:"Premium / Discount", desc:"Premium = acima do 50% do range (vender). Discount = abaixo do 50% (comprar). Equilibrium = 50%." },
        { name:"Optimal Trade Entry (OTE)", desc:"Zona 62%-79% de retrocesso de Fibonacci após BOS. Confluência com OB/FVG = entrada ideal." },
      ]
    },
    {
      label: "SESSÕES E TIMING",
      items: [
        { name:"Asian Session", desc:"Range estreito. Define os níveis de liquidez que serão caçados em Londres/NY." },
        { name:"London Open (7h-10h GMT)", desc:"Maior movimento do dia. Frequentemente inverte o range asiático. Sweeps de liquidez." },
        { name:"NY Open (13h-16h GMT)", desc:"Confirma ou inverte o movimento de Londres. Maior volume do dia." },
        { name:"Killzones", desc:"London: 7h-10h. NY: 13h-16h. London Close: 15h-17h. Fora das killzones: evitar entradas." },
      ]
    }
  ]
};

// ─── Reference Panel Component ──────────────────────────────────────────────
function RefPanel({ onClose }: { onClose: () => void }) {
  const [activeRef, setActiveRef] = useState<"wyckoff"|"elliott"|"smc">("wyckoff");
  const [expandedSection, setExpandedSection] = useState<number|null>(0);
  const [imgModal, setImgModal] = useState<{src:string;label:string}|null>(null);

  const refs = { wyckoff: WYCKOFF_REF, elliott: ELLIOTT_REF, smc: SMC_REF };
  const ref = refs[activeRef];

  return (
    <div style={{ position:"fixed",top:0,right:0,width:420,height:"100vh",background:"#070b14",borderLeft:`1px solid #1e2d45`,zIndex:200,display:"flex",flexDirection:"column",boxShadow:"-4px 0 20px rgba(0,0,0,0.5)" }}>
      {imgModal && (
        <div onClick={()=>setImgModal(null)} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.9)",zIndex:300,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"zoom-out" }}>
          <div style={{ fontSize:9,color:C.muted,letterSpacing:2,marginBottom:10 }}>{imgModal.label} — clica para fechar</div>
          <img src={imgModal.src} alt={imgModal.label} style={{ maxWidth:"90vw",maxHeight:"85vh",borderRadius:8,border:`1px solid #1e2d45` }} onClick={e=>e.stopPropagation()} />
        </div>
      )}

      {/* Header */}
      <div style={{ padding:"14px 16px",borderBottom:`1px solid #1e2d45`,display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0 }}>
        <div style={{ fontSize:11,fontWeight:600,color:"#e2e8f0" }}>📚 Referência Rápida</div>
        <button onClick={onClose} style={{ background:"none",border:`1px solid #1e2d45`,color:C.muted,fontSize:14,padding:"2px 8px",borderRadius:4,cursor:"pointer" }}>✕</button>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex",gap:0,borderBottom:`1px solid #1e2d45`,flexShrink:0 }}>
        {([["wyckoff","Wyckoff",C.accent],["elliott","Elliott",C.purple],["smc","SMC/ICT",C.blue]] as const).map(([id,label,col])=>(
          <button key={id} onClick={()=>{setActiveRef(id);setExpandedSection(0);}} style={{
            flex:1,padding:"10px 4px",fontSize:11,fontWeight:500,cursor:"pointer",
            background:activeRef===id?col+"15":"transparent",
            color:activeRef===id?col:C.muted,
            border:"none",borderBottom:`2px solid ${activeRef===id?col:"transparent"}`,
          }}>{label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex:1,overflowY:"auto",padding:"12px 14px" }}>
        <div style={{ fontSize:12,fontWeight:600,color:ref.color,marginBottom:12 }}>{ref.title}</div>
        {ref.sections.map((section,si)=>(
          <div key={si} style={{ marginBottom:8 }}>
            <button onClick={()=>setExpandedSection(expandedSection===si?null:si)} style={{
              width:"100%",textAlign:"left",background:expandedSection===si?ref.color+"15":C.elevated,
              border:`1px solid ${expandedSection===si?ref.color+"44":C.border}`,
              borderRadius:6,padding:"8px 12px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",
            }}>
              <span style={{ fontSize:10,color:expandedSection===si?ref.color:C.secondary,letterSpacing:1,fontWeight:600 }}>
                {(section as any).label}
              </span>
              <span style={{ color:C.muted,fontSize:12 }}>{expandedSection===si?"▲":"▼"}</span>
            </button>
            {expandedSection===si && (
              <div style={{ background:"#070b14",border:`1px solid ${C.border}`,borderTop:"none",borderRadius:"0 0 6px 6px",padding:10 }}>
                {"images" in section ? (
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}>
                    {(section as any).images.map((img:any,ii:number)=>(
                      <div key={ii} onClick={()=>setImgModal(img)} style={{ cursor:"zoom-in",borderRadius:6,overflow:"hidden",border:`1px solid ${C.border}` }}>
                        <img src={img.src} alt={img.label} style={{ width:"100%",height:80,objectFit:"cover",objectPosition:"top" }} />
                        <div style={{ padding:"4px 6px",fontSize:8,color:C.muted }}>{img.label}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  (section as any).items.map((item:any,ii:number)=>(
                    <div key={ii} style={{ padding:"7px 0",borderBottom:ii<(section as any).items.length-1?`1px solid #111827`:"none" }}>
                      <div style={{ fontSize:11,color:"#e2e8f0",fontWeight:500,marginBottom:3 }}>{item.name}</div>
                      <div style={{ fontSize:10,color:C.secondary,lineHeight:1.6 }}>{item.desc}</div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Upload Component ────────────────────────────────────────────────────────
function ScreenshotUpload({ label, value, onChange }: any) {
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    setUploading(true);
    const fd = new FormData(); fd.append("file",file);
    const res = await fetch("/api/upload",{method:"POST",body:fd});
    const d = await res.json();
    onChange(d.url||""); setUploading(false);
  };
  return (
    <div style={{ border:`1px dashed ${value?"#2d4a6b":C.border}`,borderRadius:6,padding:8,cursor:"pointer",minHeight:80,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,background:C.elevated }}
      onClick={()=>ref.current?.click()}
      onDragOver={e=>e.preventDefault()}
      onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)upload(f);}}>
      <input ref={ref} type="file" accept="image/*" style={{display:"none"}} onChange={e=>e.target.files?.[0]&&upload(e.target.files[0])}/>
      {value
        ?<><img src={value} alt={label} style={{maxHeight:90,maxWidth:"100%",borderRadius:4,objectFit:"contain"}}/><div style={{fontSize:8,color:C.accent}}>Clica para substituir</div></>
        :<><div style={{fontSize:14,color:C.muted}}>📷</div><div style={{fontSize:9,color:C.muted,textAlign:"center"}}>{uploading?"A carregar...":"Clica ou arrasta"}</div><div style={{fontSize:8,color:"#2d4a6b"}}>{label}</div></>
      }
    </div>
  );
}

// ─── Slider Component ────────────────────────────────────────────────────────
function SliderField({ label, value, onChange, color=C.accent }: any) {
  const n = Number(value);
  return (
    <div style={{ display:"flex",flexDirection:"column",gap:3 }}>
      <div style={{ display:"flex",justifyContent:"space-between" }}>
        <span style={{ fontSize:9,color:C.muted }}>{label}</span>
        <span style={{ fontSize:10,fontWeight:600,color:n>=7?C.green:n>=5?C.amber:C.red }}>{value}/10</span>
      </div>
      <input type="range" min="1" max="10" value={value} onChange={e=>onChange(e.target.value)} style={{ accentColor:color,cursor:"pointer" }} />
    </div>
  );
}

// ─── Field wrapper ───────────────────────────────────────────────────────────
function F({ label, children }: any) {
  return (
    <div style={{ display:"flex",flexDirection:"column",gap:4 }}>
      <div style={{ fontSize:9,color:C.muted,letterSpacing:1.3,textTransform:"uppercase" }}>{label}</div>
      {children}
    </div>
  );
}

const blank = () => ({
  date:new Date().toISOString().slice(0,10), pair:"EUR/USD", direction:"LONG", setup:"", session:"London",
  entry:"", exit_price:"", stop_loss:"", take_profit:"",
  risk_percent:"1", pnl:"", rr_planned:"", rr_real:"", outcome:"WIN",
  elliott_wave:"", wyckoff_phase:"", wyckoff_event:"", imbalance_zone:"", htf_bias:"",
  confluences:"", entry_reason:"", shock_type:"", shock_timeframe:"",
  management:"", lesson:"", notes:"",
  screenshot_before:"", screenshot_after:"", screenshot_entry:"", tags:"",
  mental_state:"B", followed_plan:"1",
  sleep_quality:"7", fatigue_level:"3", stress_level:"3", anxiety_level:"3",
  focus_level:"7", confidence_level:"6",
  emotional_state:"Calmo e focado", pre_session_notes:"", post_trade_emotion:"",
});

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function JournalPage() {
  const [trades, setTrades] = useState<any[]>([]);
  const [setupNames, setSetupNames] = useState<string[]>([]);
  const [form, setForm] = useState<any>(blank());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number|null>(null);
  const [tab, setTab] = useState<"basic"|"technical"|"psychological"|"screenshots">("basic");
  const [filter, setFilter] = useState({outcome:"",setup:"",direction:""});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [showRef, setShowRef] = useState(false);

  const load = () => {
    fetch("/api/trades?limit=200").then(r=>r.json()).then(setTrades).catch(()=>{});
    fetch("/api/setups").then(r=>r.json()).then(s=>{
      const names = s.map((x:any)=>x.name);
      setSetupNames(names);
    }).catch(()=>{});
  };
  useEffect(()=>{load();},[]);

  const set = (k:string) => (e:any) => setForm((f:any)=>({...f,[k]:e.target?.value??e}));
  const setVal = (k:string,v:any) => setForm((f:any)=>({...f,[k]:v}));

  const mentalScore = () => {
    const f = form;
    return ((Number(f.sleep_quality))+(Number(f.focus_level))+(Number(f.confidence_level))+(10-Number(f.fatigue_level))+(10-Number(f.stress_level))+(10-Number(f.anxiety_level)))/6;
  };
  const mscore = mentalScore();
  const mcolor = mscore>=7?C.green:mscore>=5?C.amber:C.red;

  const openNew = () => {
    setForm(blank()); setEditingId(null); setTab("basic");
    setShowForm(true); setMsg(""); setSelected(null);
  };

  const openEdit = (t: any) => {
    setForm({
      date:t.date||"", pair:t.pair||"EUR/USD", direction:t.direction||"LONG",
      setup:t.setup||"", session:t.session||"London",
      entry:t.entry||"", exit_price:t.exit_price||"", stop_loss:t.stop_loss||"",
      take_profit:t.take_profit||"", risk_percent:t.risk_percent||"1",
      pnl:t.pnl||"", rr_planned:t.rr_planned||"", rr_real:t.rr_real||"",
      outcome:t.outcome||"WIN",
      elliott_wave:t.elliott_wave||"", wyckoff_phase:t.wyckoff_phase||"",
      wyckoff_event:t.wyckoff_event||"", imbalance_zone:t.imbalance_zone||"",
      htf_bias:t.htf_bias||"", confluences:t.confluences||"",
      entry_reason:t.entry_reason||"", shock_type:t.shock_type||"",
      shock_timeframe:t.shock_timeframe||"", management:t.management||"",
      lesson:t.lesson||"", notes:t.notes||"",
      screenshot_before:t.screenshot_before||"", screenshot_after:t.screenshot_after||"",
      screenshot_entry:t.screenshot_entry||"", tags:t.tags||"",
      mental_state:t.mental_state||"B", followed_plan:String(t.followed_plan??1),
      sleep_quality:String(t.sleep_quality||7), fatigue_level:String(t.fatigue_level||3),
      stress_level:String(t.stress_level||3), anxiety_level:String(t.anxiety_level||3),
      focus_level:String(t.focus_level||7), confidence_level:String(t.confidence_level||6),
      emotional_state:t.emotional_state||"Calmo e focado",
      pre_session_notes:t.pre_session_notes||"", post_trade_emotion:t.post_trade_emotion||"",
    });
    setEditingId(t.id); setTab("basic"); setShowForm(true); setMsg(""); setSelected(null);
    window.scrollTo({top:0,behavior:"smooth"});
  };

  const save = async () => {
    if (!form.entry||!form.stop_loss||!form.setup||!form.pair) {
      setMsg("Par, Setup, Entrada e SL são obrigatórios."); return;
    }
    setSaving(true); setMsg("");
    const payload = {
      ...form,
      entry:Number(form.entry)||0,
      exit_price:form.exit_price?Number(form.exit_price):null,
      stop_loss:Number(form.stop_loss)||0,
      take_profit:form.take_profit?Number(form.take_profit):null,
      risk_percent:Number(form.risk_percent)||1,
      pnl:form.pnl?Number(form.pnl):0,
      rr_planned:form.rr_planned?Number(form.rr_planned):null,
      rr_real:form.rr_real?Number(form.rr_real):null,
      followed_plan:Number(form.followed_plan),
      sleep_quality:Number(form.sleep_quality),
      fatigue_level:Number(form.fatigue_level),
      stress_level:Number(form.stress_level),
      anxiety_level:Number(form.anxiety_level),
      focus_level:Number(form.focus_level),
      confidence_level:Number(form.confidence_level),
    };
    try {
      let r;
      if (editingId) {
        r = await fetch("/api/trades",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,id:editingId})});
      } else {
        r = await fetch("/api/trades",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      }
      if (r.ok) {
        setMsg(editingId?"✓ Trade actualizado!":"✓ Trade guardado!");
        setForm(blank()); setShowForm(false); setEditingId(null); load();
      } else {
        const err = await r.json().catch(()=>({}));
        setMsg("Erro: "+(err.error||r.status));
      }
    } catch(e:any){ setMsg("Erro de rede: "+e.message); }
    setSaving(false);
  };

  const del = async (id:number) => {
    if (!confirm("Apagar este trade?")) return;
    await fetch(`/api/trades?id=${id}`,{method:"DELETE"});
    load(); setSelected(null);
  };

  const filtered = trades.filter(t=>
    (!filter.outcome||t.outcome===filter.outcome)&&
    (!filter.setup||t.setup===filter.setup)&&
    (!filter.direction||t.direction===filter.direction)
  );

  const TabBtn = ({id,label}:{id:any;label:string}) => (
    <button onClick={()=>setTab(id)} style={{
      padding:"7px 14px",fontSize:11,cursor:"pointer",
      background:tab===id?C.elevated:"transparent",
      color:tab===id?"#e2e8f0":C.muted,
      border:`1px solid ${tab===id?C.border:"transparent"}`,
      borderBottom:tab===id?"none":`1px solid ${C.border}`,
      borderRadius:"4px 4px 0 0",
    }}>{label}</button>
  );

  const sel = (v:string) => <select value={form[v.split("|")[0]]} onChange={set(v.split("|")[0])} style={{width:"100%"}}>{}</select>;

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:20,paddingRight:showRef?430:0,transition:"padding-right 0.2s" }}>
      {showRef && <RefPanel onClose={()=>setShowRef(false)} />}

      {/* Header */}
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
        <div>
          <div style={{ fontSize:9,color:C.muted,letterSpacing:2 }}>TRADING OS</div>
          <div style={{ fontSize:22,fontWeight:600,color:C.accent }}>Journal de Trades</div>
        </div>
        <div style={{ display:"flex",gap:8 }}>
          <button onClick={()=>setShowRef(r=>!r)} style={{ background:showRef?"#1e3a5f":C.elevated,color:showRef?C.blue:C.secondary,border:`1px solid ${showRef?"#2d4a6b":C.border}`,padding:"7px 14px",borderRadius:4,fontSize:12 }}>
            📚 {showRef?"Fechar Referência":"Abrir Referência"}
          </button>
          <button onClick={openNew} style={{ background:"#0f4c3a",color:C.accent,border:`1px solid ${C.accent}`,padding:"7px 16px",borderRadius:4,fontSize:12 }}>
            + Novo Trade
          </button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background:C.card,border:`1px solid ${editingId?"#2d4a6b":C.border}`,borderRadius:8,overflow:"hidden" }}>
          {/* Form header */}
          <div style={{ background:editingId?"#0a1929":"transparent",padding:"12px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center" }}>
            <div style={{ fontSize:12,fontWeight:600,color:editingId?C.blue:"#e2e8f0" }}>
              {editingId?`✏ Editar Trade #${editingId}`:"Novo Trade"}
            </div>
            <div style={{ display:"flex",gap:10,alignItems:"center" }}>
              <div style={{ fontSize:10,color:mcolor }}>Mental: <strong>{mscore.toFixed(1)}/10</strong></div>
              {mscore<5&&<div style={{ fontSize:9,background:"#3b1a1a",color:C.red,padding:"2px 8px",borderRadius:10 }}>⚠ Mau estado</div>}
              <button onClick={()=>{setShowForm(false);setEditingId(null);}} style={{ background:"transparent",border:`1px solid ${C.border}`,color:C.muted,fontSize:12,padding:"3px 10px",borderRadius:4,cursor:"pointer" }}>✕</button>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display:"flex",padding:"0 16px",paddingTop:12,borderBottom:`1px solid ${C.border}`,gap:4 }}>
            <TabBtn id="basic" label="① Básico"/>
            <TabBtn id="technical" label="② Elliott + Wyckoff + SMC"/>
            <TabBtn id="psychological" label="③ Estado Mental"/>
            <TabBtn id="screenshots" label="④ Screenshots"/>
          </div>

          <div style={{ padding:18 }}>
            {/* ── TAB 1: BASIC ── */}
            {tab==="basic" && (
              <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
                <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12 }}>
                  <F label="Data"><input type="date" value={form.date} onChange={set("date")} style={{width:"100%"}}/></F>
                  <F label="Par">
                    <select value={form.pair} onChange={set("pair")} style={{width:"100%"}}>
                      {PAIRS.map(p=><option key={p}>{p}</option>)}
                    </select>
                  </F>
                  <F label="Direcção">
                    <select value={form.direction} onChange={set("direction")} style={{width:"100%"}}>
                      <option value="LONG">LONG ▲</option>
                      <option value="SHORT">SHORT ▼</option>
                    </select>
                  </F>
                  <F label="Sessão">
                    <select value={form.session} onChange={set("session")} style={{width:"100%"}}>
                      {SESSIONS.map(s=><option key={s}>{s}</option>)}
                    </select>
                  </F>
                </div>

                <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12 }}>
                  <F label="Setup">
                    <input list="setup-dl" value={form.setup} onChange={set("setup")} placeholder="Seleciona ou escreve..." style={{width:"100%"}}/>
                    <datalist id="setup-dl">
                      {setupNames.map(s=><option key={s} value={s}/>)}
                    </datalist>
                  </F>
                  <F label="Resultado">
                    <select value={form.outcome} onChange={set("outcome")} style={{width:"100%"}}>
                      <option value="WIN">WIN ✓</option>
                      <option value="LOSS">LOSS ✗</option>
                      <option value="BE">B/E →</option>
                      <option value="RUNNING">Em curso…</option>
                    </select>
                  </F>
                  <F label="Seguiu o plano?">
                    <select value={form.followed_plan} onChange={set("followed_plan")} style={{width:"100%"}}>
                      <option value="1">Sim ✓</option>
                      <option value="0">Não ✗</option>
                    </select>
                  </F>
                  <F label="Tags"><input value={form.tags} onChange={set("tags")} placeholder="fomo, news, london..." style={{width:"100%"}}/></F>
                </div>

                <div style={{ display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:12 }}>
                  <F label="Entrada"><input type="number" step="any" value={form.entry} onChange={set("entry")} placeholder="1.0842" style={{width:"100%"}}/></F>
                  <F label="Stop Loss"><input type="number" step="any" value={form.stop_loss} onChange={set("stop_loss")} placeholder="1.0820" style={{width:"100%"}}/></F>
                  <F label="Take Profit"><input type="number" step="any" value={form.take_profit} onChange={set("take_profit")} placeholder="1.0901" style={{width:"100%"}}/></F>
                  <F label="Saída Real"><input type="number" step="any" value={form.exit_price} onChange={set("exit_price")} placeholder="1.0891" style={{width:"100%"}}/></F>
                  <F label="Risco (%)"><input type="number" step="0.1" value={form.risk_percent} onChange={set("risk_percent")} style={{width:"100%"}}/></F>
                  <F label="P&L ($)"><input type="number" step="any" value={form.pnl} onChange={set("pnl")} style={{width:"100%"}}/></F>
                </div>

                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12 }}>
                  <F label="R:R Planeado"><input type="number" step="0.1" value={form.rr_planned} onChange={set("rr_planned")} placeholder="2.0" style={{width:"100%"}}/></F>
                  <F label="R:R Real"><input type="number" step="0.1" value={form.rr_real} onChange={set("rr_real")} placeholder="2.4" style={{width:"100%"}}/></F>
                  <F label="HTF Bias">
                    <select value={form.htf_bias} onChange={set("htf_bias")} style={{width:"100%"}}>
                      <option value="">Seleciona...</option>
                      <option>Bullish</option><option>Bearish</option><option>Neutro</option>
                    </select>
                  </F>
                </div>

                <div style={{ display:"flex",justifyContent:"flex-end" }}>
                  <button onClick={()=>setTab("technical")} style={{ background:"#1e3a5f",color:C.blue,border:"1px solid #2d4a6b",padding:"6px 14px",borderRadius:4,fontSize:11 }}>Seguinte: Técnico →</button>
                </div>
              </div>
            )}

            {/* ── TAB 2: TECHNICAL ── */}
            {tab==="technical" && (
              <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
                <div style={{ display:"flex",justifyContent:"flex-end",marginBottom:-6 }}>
                  <button onClick={()=>setShowRef(r=>!r)} style={{ fontSize:10,color:C.blue,background:"#1e3a5f",border:"1px solid #2d4a6b",padding:"4px 12px",borderRadius:4,cursor:"pointer" }}>
                    📚 {showRef?"Fechar":"Abrir"} Referência
                  </button>
                </div>

                {/* Elliott */}
                <div style={{ background:"#0a0514",border:`1px solid ${C.purple}33`,borderRadius:8,padding:14 }}>
                  <div style={{ fontSize:9,color:C.purple,letterSpacing:2,marginBottom:12 }}>🌊 ELLIOTT WAVE</div>
                  <F label="Onda Elliott (macro D1/W) — onde estamos na contagem?">
                    <select value={form.elliott_wave} onChange={set("elliott_wave")} style={{width:"100%"}}>
                      {ELLIOTT_WAVES.map(w=><option key={w} value={w}>{w||"Seleciona a onda..."}</option>)}
                    </select>
                  </F>
                </div>

                {/* Wyckoff */}
                <div style={{ background:"#050a0a",border:`1px solid ${C.accent}33`,borderRadius:8,padding:14 }}>
                  <div style={{ fontSize:9,color:C.accent,letterSpacing:2,marginBottom:12 }}>📊 WYCKOFF</div>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
                    <F label="Fase / Estrutura (macro)">
                      <select value={form.wyckoff_phase} onChange={set("wyckoff_phase")} style={{width:"100%"}}>
                        {WYCKOFF_PHASES.map(w=><option key={w} value={w}>{w||"Seleciona a fase..."}</option>)}
                      </select>
                    </F>
                    <F label="Evento (macro)">
                      <select value={form.wyckoff_event} onChange={set("wyckoff_event")} style={{width:"100%"}}>
                        {WYCKOFF_EVENTS.map(w=><option key={w} value={w}>{w||"Seleciona o evento..."}</option>)}
                      </select>
                    </F>
                  </div>
                </div>

                {/* SMC/ICT */}
                <div style={{ background:"#050814",border:`1px solid ${C.blue}33`,borderRadius:8,padding:14 }}>
                  <div style={{ fontSize:9,color:C.blue,letterSpacing:2,marginBottom:12 }}>🔷 SMC / ICT</div>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
                    <F label="Imbalance / FVG (zona alvo)">
                      <input value={form.imbalance_zone} onChange={set("imbalance_zone")} placeholder="ex: H4 FVG 1.0820-1.0840" style={{width:"100%"}}/>
                    </F>
                    <F label="Tipo de Chock (entrada)">
                      <select value={form.shock_type} onChange={set("shock_type")} style={{width:"100%"}}>
                        {SHOCK_TYPES.map(s=><option key={s} value={s}>{s||"Seleciona o chock..."}</option>)}
                      </select>
                    </F>
                    <F label="Timeframe do Chock">
                      <select value={form.shock_timeframe} onChange={set("shock_timeframe")} style={{width:"100%"}}>
                        <option value="">Seleciona...</option>
                        {["M1","M2","M5","M15","M30","H1"].map(t=><option key={t}>{t}</option>)}
                      </select>
                    </F>
                  </div>
                </div>

                {/* Confluences + Entry */}
                <F label="Confluências — lista todas as que se aplicam">
                  <textarea value={form.confluences} onChange={set("confluences")} rows={2} placeholder="BOS H4 + FVG H1 + OB M15 + Spring M5 + Volume + Elliott onda 2..." style={{width:"100%",resize:"vertical"}}/>
                </F>
                <F label="Razão de entrada — o que viste exactamente?">
                  <textarea value={form.entry_reason} onChange={set("entry_reason")} rows={3} placeholder="Elliott: onda X em Y. Wyckoff: fase Z, evento W. Spring no M5 dentro do FVG. Volume confirmou..." style={{width:"100%",resize:"vertical"}}/>
                </F>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
                  <F label="Gestão durante o trade">
                    <textarea value={form.management} onChange={set("management")} rows={2} placeholder="Movi SL para BE em... Saí parcial em..." style={{width:"100%",resize:"vertical"}}/>
                  </F>
                  <F label="Lição aprendida / O que faria diferente?">
                    <textarea value={form.lesson} onChange={set("lesson")} rows={2} placeholder="O que mudaria na próxima vez..." style={{width:"100%",resize:"vertical"}}/>
                  </F>
                </div>

                <div style={{ display:"flex",justifyContent:"space-between" }}>
                  <button onClick={()=>setTab("basic")} style={{ background:"transparent",color:C.muted,border:`1px solid ${C.border}`,padding:"6px 14px",borderRadius:4,fontSize:11,cursor:"pointer" }}>← Básico</button>
                  <button onClick={()=>setTab("psychological")} style={{ background:"#4a1a6b",color:C.purple,border:"1px solid #6b2da0",padding:"6px 14px",borderRadius:4,fontSize:11,cursor:"pointer" }}>Seguinte: Mental →</button>
                </div>
              </div>
            )}

            {/* ── TAB 3: PSYCHOLOGICAL ── */}
            {tab==="psychological" && (
              <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
                <div style={{ background:mscore<5?"#3b1a1a":mscore<7?"#451a03":"#14532d",border:`1px solid ${mcolor}44`,borderRadius:8,padding:12 }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                    <span style={{ fontSize:9,color:mcolor,letterSpacing:2 }}>SCORE MENTAL</span>
                    <span style={{ fontSize:22,fontWeight:700,color:mcolor }}>{mscore.toFixed(1)}/10</span>
                  </div>
                  <div style={{ fontSize:11,color:mcolor,marginTop:4 }}>
                    {mscore<5?"⚠ ESTADO MAU — Sem trades hoje":mscore<6?"⚠ Reduzir size → 0.5%":mscore<7?"→ Normal — manter regras":mscore<8?"✓ Bom estado":"✓✓ Estado óptimo"}
                  </div>
                </div>

                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:20 }}>
                  <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
                    <div style={{ fontSize:9,color:C.muted,letterSpacing:2 }}>SONO / FÍSICO</div>
                    <SliderField label="Qualidade do sono" value={form.sleep_quality} onChange={(v:string)=>setVal("sleep_quality",v)} color={C.blue}/>
                    <SliderField label="Fadiga (1=descansado 10=esgotado)" value={form.fatigue_level} onChange={(v:string)=>setVal("fatigue_level",v)} color={C.amber}/>
                  </div>
                  <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
                    <div style={{ fontSize:9,color:C.muted,letterSpacing:2 }}>EMOCIONAL</div>
                    <SliderField label="Stress (1=zero 10=extremo)" value={form.stress_level} onChange={(v:string)=>setVal("stress_level",v)} color={C.red}/>
                    <SliderField label="Ansiedade" value={form.anxiety_level} onChange={(v:string)=>setVal("anxiety_level",v)} color={C.red}/>
                    <SliderField label="Foco (1=distraído 10=total)" value={form.focus_level} onChange={(v:string)=>setVal("focus_level",v)} color={C.green}/>
                    <SliderField label="Confiança" value={form.confidence_level} onChange={(v:string)=>setVal("confidence_level",v)} color={C.green}/>
                  </div>
                </div>

                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
                  <F label="Estado emocional pré-trade">
                    <select value={form.emotional_state} onChange={set("emotional_state")} style={{width:"100%"}}>
                      {EMOTIONAL_STATES.map(e=><option key={e}>{e}</option>)}
                    </select>
                  </F>
                  <F label="Estado mental geral">
                    <select value={form.mental_state} onChange={set("mental_state")} style={{width:"100%"}}>
                      <option value="A">A — Óptimo</option>
                      <option value="B">B — Bom</option>
                      <option value="C">C — Médio</option>
                      <option value="D">D — Mau</option>
                    </select>
                  </F>
                </div>
                <F label="Notas pré-sessão">
                  <textarea value={form.pre_session_notes} onChange={set("pre_session_notes")} rows={2} placeholder="Como te sentiste antes de abrir a plataforma..." style={{width:"100%",resize:"vertical"}}/>
                </F>
                <F label="Emoção pós-trade">
                  <textarea value={form.post_trade_emotion} onChange={set("post_trade_emotion")} rows={2} placeholder="Como te sentiste depois do resultado..." style={{width:"100%",resize:"vertical"}}/>
                </F>

                <div style={{ display:"flex",justifyContent:"space-between" }}>
                  <button onClick={()=>setTab("technical")} style={{ background:"transparent",color:C.muted,border:`1px solid ${C.border}`,padding:"6px 14px",borderRadius:4,fontSize:11,cursor:"pointer" }}>← Técnico</button>
                  <button onClick={()=>setTab("screenshots")} style={{ background:"#1e3a5f",color:C.blue,border:"1px solid #2d4a6b",padding:"6px 14px",borderRadius:4,fontSize:11,cursor:"pointer" }}>Seguinte: Screenshots →</button>
                </div>
              </div>
            )}

            {/* ── TAB 4: SCREENSHOTS ── */}
            {tab==="screenshots" && (
              <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14 }}>
                  <F label="Análise HTF (antes da sessão)">
                    <ScreenshotUpload label="D1/H4 — contexto macro" value={form.screenshot_before} onChange={(v:string)=>setVal("screenshot_before",v)}/>
                  </F>
                  <F label="Entrada real (M5/M2)">
                    <ScreenshotUpload label="M5/M2 — chock de entrada" value={form.screenshot_entry} onChange={(v:string)=>setVal("screenshot_entry",v)}/>
                  </F>
                  <F label="Resultado final">
                    <ScreenshotUpload label="Após fecho" value={form.screenshot_after} onChange={(v:string)=>setVal("screenshot_after",v)}/>
                  </F>
                </div>
                <F label="Notas gerais">
                  <textarea value={form.notes} onChange={set("notes")} rows={2} placeholder="Qualquer observação adicional..." style={{width:"100%",resize:"vertical"}}/>
                </F>

                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                  <button onClick={()=>setTab("psychological")} style={{ background:"transparent",color:C.muted,border:`1px solid ${C.border}`,padding:"6px 14px",borderRadius:4,fontSize:11,cursor:"pointer" }}>← Mental</button>
                  <div style={{ display:"flex",gap:10,alignItems:"center" }}>
                    {msg&&<span style={{ fontSize:11,color:msg.startsWith("✓")?C.green:C.red }}>{msg}</span>}
                    <button onClick={save} disabled={saving} style={{ background:saving?"#0f3028":"#0f4c3a",color:C.accent,border:`1px solid ${C.accent}`,padding:"8px 20px",borderRadius:4,fontSize:12,fontWeight:500,cursor:"pointer" }}>
                      {saving?"A guardar...":editingId?"✓ Actualizar Trade":"✓ Guardar Trade"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Quick save bar (visible on all tabs except screenshots) */}
          {tab!=="screenshots" && (
            <div style={{ padding:"10px 18px",borderTop:`1px solid ${C.border}`,display:"flex",justifyContent:"flex-end",gap:10,alignItems:"center",background:"#070b14" }}>
              {msg&&<span style={{ fontSize:11,color:msg.startsWith("✓")?C.green:C.red }}>{msg}</span>}
              <button onClick={save} disabled={saving} style={{ background:saving?"#0f3028":"#0f4c3a",color:C.accent,border:`1px solid ${C.accent}`,padding:"6px 16px",borderRadius:4,fontSize:12,cursor:"pointer" }}>
                {saving?"A guardar...":editingId?"✓ Actualizar":"✓ Guardar já"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── FILTERS ── */}
      <div style={{ display:"flex",gap:10,alignItems:"center",flexWrap:"wrap" }}>
        <span style={{ fontSize:9,color:C.muted,letterSpacing:1.5 }}>FILTRAR:</span>
        <select value={filter.outcome} onChange={e=>setFilter(f=>({...f,outcome:e.target.value}))} style={{width:130}}>
          <option value="">Todos resultados</option>
          {["WIN","LOSS","BE","RUNNING"].map(v=><option key={v}>{v}</option>)}
        </select>
        <select value={filter.setup} onChange={e=>setFilter(f=>({...f,setup:e.target.value}))} style={{width:200}}>
          <option value="">Todos os setups</option>
          {setupNames.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filter.direction} onChange={e=>setFilter(f=>({...f,direction:e.target.value}))} style={{width:120}}>
          <option value="">LONG + SHORT</option>
          <option value="LONG">LONG</option>
          <option value="SHORT">SHORT</option>
        </select>
        <span style={{ fontSize:10,color:C.muted,marginLeft:"auto" }}>{filtered.length} trades</span>
      </div>

      {/* ── TABLE ── */}
      <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden" }}>
        <div style={{ overflowX:"auto" }}>
          <table>
            <thead>
              <tr>
                <th>DATA</th><th>PAR</th><th>DIR</th><th>SETUP</th>
                <th>ENTRADA</th><th>SL</th><th>TP</th><th>SAÍDA</th>
                <th>R:R</th><th>P&L</th><th>RESULTADO</th>
                <th>MENTAL</th><th>😴</th><th>PLANO</th><th style={{width:80}}>AÇÕES</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t=>(
                <tr key={t.id} onClick={()=>setSelected(selected?.id===t.id?null:t)}
                  style={{ cursor:"pointer",background:selected?.id===t.id?"#111827":"transparent" }}>
                  <td style={{ color:C.muted,whiteSpace:"nowrap",fontSize:11 }}>{t.date}</td>
                  <td style={{ color:"#e2e8f0",fontWeight:500 }}>{t.pair}</td>
                  <td>
                    <span style={{ fontSize:9,padding:"2px 6px",borderRadius:10,background:t.direction==="LONG"?"#1e3a5f":"#3b1a1a",color:t.direction==="LONG"?"#7dd3fc":"#fca5a5" }}>{t.direction}</span>
                  </td>
                  <td style={{ maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:11 }}>{t.setup}</td>
                  <td style={{ fontFamily:"monospace",fontSize:11 }}>{Number(t.entry||0).toFixed(4)}</td>
                  <td style={{ fontFamily:"monospace",fontSize:11,color:C.red }}>{t.stop_loss?Number(t.stop_loss).toFixed(4):"—"}</td>
                  <td style={{ fontFamily:"monospace",fontSize:11,color:C.green }}>{t.take_profit?Number(t.take_profit).toFixed(4):"—"}</td>
                  <td style={{ fontFamily:"monospace",fontSize:11 }}>{t.exit_price?Number(t.exit_price).toFixed(4):"—"}</td>
                  <td style={{ color:C.amber,fontSize:11 }}>{t.rr_real?`1:${Number(t.rr_real).toFixed(1)}`:"—"}</td>
                  <td style={{ color:Number(t.pnl)>=0?C.green:C.red,fontWeight:600 }}>{Number(t.pnl)>=0?"+":""}${Number(t.pnl||0).toFixed(0)}</td>
                  <td>
                    <span style={{ fontSize:9,padding:"2px 6px",borderRadius:10,background:t.outcome==="WIN"?"#14532d":t.outcome==="LOSS"?"#7f1d1d":"#1e293b",color:t.outcome==="WIN"?C.green:t.outcome==="LOSS"?C.red:C.secondary }}>
                      {t.outcome}
                    </span>
                  </td>
                  <td style={{ color:{A:C.green,B:C.accent,C:C.amber,D:C.red}[t.mental_state as string]||C.muted,fontWeight:600 }}>{t.mental_state}</td>
                  <td style={{ color:Number(t.sleep_quality)>=7?C.green:Number(t.sleep_quality)>=5?C.amber:C.red,fontSize:11 }}>{t.sleep_quality||"—"}</td>
                  <td style={{ color:t.followed_plan?C.green:C.red }}>{t.followed_plan?"✓":"✗"}</td>
                  <td onClick={e=>e.stopPropagation()}>
                    <div style={{ display:"flex",gap:4 }}>
                      <button onClick={()=>openEdit(t)} style={{ background:"#1e3a5f",border:"none",color:C.blue,fontSize:10,padding:"3px 8px",borderRadius:4,cursor:"pointer" }} title="Editar">✏</button>
                      <button onClick={()=>del(t.id)} style={{ background:"#3b1a1a",border:"none",color:C.red,fontSize:10,padding:"3px 8px",borderRadius:4,cursor:"pointer" }} title="Apagar">✕</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length===0&&(
                <tr><td colSpan={15} style={{ textAlign:"center",color:C.muted,padding:40,fontSize:12 }}>
                  Sem trades ainda. Clica em "+ Novo Trade" para começar.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── DETAIL PANEL ── */}
        {selected && (
          <div style={{ borderTop:`1px solid ${C.border}`,padding:20,background:"#070b14" }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
              <div style={{ fontSize:9,color:C.muted,letterSpacing:2 }}>DETALHE — {selected.pair} {selected.date}</div>
              <button onClick={()=>openEdit(selected)} style={{ background:"#1e3a5f",color:C.blue,border:"1px solid #2d4a6b",padding:"5px 14px",borderRadius:4,fontSize:11,cursor:"pointer" }}>
                ✏ Editar este trade
              </button>
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:14 }}>
              <div>
                <div style={{ fontSize:9,color:C.muted,marginBottom:6,letterSpacing:1 }}>NÍVEIS</div>
                {[["Entrada",Number(selected.entry||0).toFixed(5),"#e2e8f0"],["Stop Loss",selected.stop_loss?Number(selected.stop_loss).toFixed(5):"—",C.red],["Take Profit",selected.take_profit?Number(selected.take_profit).toFixed(5):"—",C.green],["Saída Real",selected.exit_price?Number(selected.exit_price).toFixed(5):"—","#e2e8f0"],["HTF Bias",selected.htf_bias||"—",C.accent]].map(([l,v,c])=>(
                  <div key={l} style={{ display:"flex",justifyContent:"space-between",fontSize:11,padding:"2px 0" }}>
                    <span style={{ color:C.secondary }}>{l}</span>
                    <span style={{ color:c as string }}>{v}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize:9,color:C.muted,marginBottom:6,letterSpacing:1 }}>ANÁLISE TÉCNICA</div>
                {[["Elliott",selected.elliott_wave||"—",C.purple],["Wyckoff Fase",selected.wyckoff_phase||"—",C.accent],["Evento",selected.wyckoff_event||"—",C.accent],["Imbalance",selected.imbalance_zone||"—",C.amber],["Chock",selected.shock_type?`${selected.shock_type} (${selected.shock_timeframe})`:("—"),C.amber]].map(([l,v,c])=>(
                  <div key={l} style={{ fontSize:11,padding:"2px 0",borderBottom:"1px solid #111827" }}>
                    <span style={{ color:C.muted,fontSize:9 }}>{l}: </span>
                    <span style={{ color:c as string }}>{v}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize:9,color:C.muted,marginBottom:6,letterSpacing:1 }}>ESTADO MENTAL</div>
                {[["Sono",selected.sleep_quality],[" Fadiga",selected.fatigue_level],["Stress",selected.stress_level],["Ansiedade",selected.anxiety_level],["Foco",selected.focus_level],["Confiança",selected.confidence_level]].map(([l,v])=>(
                  <div key={l} style={{ display:"flex",justifyContent:"space-between",fontSize:11,padding:"1px 0" }}>
                    <span style={{ color:C.secondary }}>{l}</span>
                    <span style={{ color:Number(v)>=7?C.green:Number(v)>=5?C.amber:C.red }}>{v||"—"}/10</span>
                  </div>
                ))}
                <div style={{ fontSize:10,color:C.muted,marginTop:4 }}>{selected.emotional_state}</div>
              </div>
              <div>
                <div style={{ fontSize:9,color:C.muted,marginBottom:6,letterSpacing:1 }}>NOTAS</div>
                {selected.entry_reason&&<><div style={{ fontSize:9,color:C.muted }}>Entrada:</div><div style={{ fontSize:10,color:"#e2e8f0",lineHeight:1.5,marginBottom:6 }}>{selected.entry_reason}</div></>}
                {selected.lesson&&<><div style={{ fontSize:9,color:C.muted }}>Lição:</div><div style={{ fontSize:10,color:C.secondary,lineHeight:1.5 }}>{selected.lesson}</div></>}
                {selected.confluences&&<><div style={{ fontSize:9,color:C.muted,marginTop:4 }}>Confluências:</div><div style={{ fontSize:10,color:C.accent,lineHeight:1.5 }}>{selected.confluences}</div></>}
              </div>
            </div>
            {(selected.screenshot_before||selected.screenshot_entry||selected.screenshot_after)&&(
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10 }}>
                {[["screenshot_before","HTF Análise"],["screenshot_entry","Entrada M5"],["screenshot_after","Resultado"]].map(([k,l])=>selected[k]?(
                  <div key={k}>
                    <div style={{ fontSize:9,color:C.muted,marginBottom:4 }}>{l}</div>
                    <img src={selected[k]} alt={l} style={{ maxWidth:"100%",maxHeight:160,borderRadius:6,border:`1px solid ${C.border}`,objectFit:"contain" }}/>
                  </div>
                ):null)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
