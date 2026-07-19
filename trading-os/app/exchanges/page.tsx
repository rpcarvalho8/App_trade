"use client";
import { useState, useEffect } from "react";

const C = { accent:"#4af0c4",green:"#4ade80",red:"#f87171",amber:"#fbbf24",blue:"#60a5fa",muted:"#475569",secondary:"#94a3b8",border:"#1e2d45",card:"#0d1929",elevated:"#111827" };

const EXCHANGES = [
  { id:"bybit",name:"Bybit",logo:"🔶",color:"#f7931a",status:"supported",docs:"https://www.bybit.com/app/user/api-management",note:"Futures & Spot. Criar API key com permissão Read Only." },
  { id:"binance",name:"Binance",logo:"🟡",color:"#f3ba2f",status:"supported",docs:"https://www.binance.com/en/my/settings/api-management",note:"Futures (FAPI) & Spot. API key com Read Only." },
  { id:"kraken",name:"Kraken",logo:"🐙",color:"#5741d9",status:"supported",docs:"https://www.kraken.com/u/security/api",note:"Spot & Futuros. API key com permissão Query Funds & Orders." },
  { id:"xtb",name:"XTB",logo:"📊",color:"#e63946",status:"manual",docs:"https://www.xtb.com",note:"XTB não disponibiliza API pública REST para clientes retail. Importa trades manualmente via CSV (Export do xStation)." },
];

interface ExchangeConfig { exchange: string; apiKey: string; apiSecret: string; }

export default function ExchangesPage() {
  const [configs, setConfigs] = useState<Record<string,{key:string;secret:string}>>({});
  const [results, setResults] = useState<Record<string,any>>({});
  const [loading, setLoading] = useState<Record<string,boolean>>({});
  const [saved, setSaved] = useState<Record<string,boolean>>({});

  // Load saved keys from localStorage (keys stay local, never sent to server stored)
  useEffect(()=>{
    try {
      const saved = JSON.parse(localStorage.getItem("exchange_configs")||"{}");
      setConfigs(saved);
    } catch {}
  },[]);

  const setKey = (exchange:string, field:"key"|"secret", val:string) => {
    setConfigs(c=>({...c,[exchange]:{...(c[exchange]||{key:"",secret:""}), [field]:val}}));
  };

  const saveConfig = (exchange:string) => {
    const all = {...configs};
    localStorage.setItem("exchange_configs", JSON.stringify(all));
    setSaved(s=>({...s,[exchange]:true}));
    setTimeout(()=>setSaved(s=>({...s,[exchange]:false})),3000);
  };

  const testConnection = async (exchange:string) => {
    const cfg = configs[exchange]||{key:"",secret:""};
    if (!cfg.key||!cfg.secret) { setResults(r=>({...r,[exchange]:{ok:false,error:"API Key e Secret obrigatórios"}})); return; }
    setLoading(l=>({...l,[exchange]:true}));
    try {
      const res = await fetch("/api/exchanges",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({exchange,apiKey:cfg.key,apiSecret:cfg.secret,action:"test"})});
      const data = await res.json();
      setResults(r=>({...r,[exchange]:data}));
    } catch(e:any){ setResults(r=>({...r,[exchange]:{ok:false,error:e.message}})); }
    setLoading(l=>({...l,[exchange]:false}));
  };

  const importTrades = async (exchange:string) => {
    const cfg = configs[exchange]||{key:"",secret:""};
    if (!cfg.key||!cfg.secret) { setResults(r=>({...r,[exchange]:{ok:false,error:"Configura e testa a conexão primeiro"}})); return; }
    setLoading(l=>({...l,[exchange]:true}));
    try {
      const res = await fetch("/api/exchanges",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({exchange,apiKey:cfg.key,apiSecret:cfg.secret,action:"import"})});
      const data = await res.json();
      setResults(r=>({...r,[exchange]:data}));
    } catch(e:any){ setResults(r=>({...r,[exchange]:{ok:false,error:e.message}})); }
    setLoading(l=>({...l,[exchange]:false}));
  };

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:20 }}>
      <div>
        <div style={{ fontSize:9,color:C.muted,letterSpacing:2 }}>TRADING OS</div>
        <div style={{ fontSize:22,fontWeight:600,color:C.accent }}>Ligações a Exchanges</div>
        <div style={{ fontSize:11,color:C.muted,marginTop:2 }}>Importa trades automaticamente — entrada, SL, TP, P&L e fees</div>
      </div>

      {/* Security notice */}
      <div style={{ background:"#1a1a2e",border:"1px solid #2d4a6b",borderRadius:8,padding:14 }}>
        <div style={{ fontSize:9,color:C.blue,letterSpacing:2,marginBottom:6 }}>🔒 SEGURANÇA</div>
        <div style={{ fontSize:11,color:C.secondary,lineHeight:1.7 }}>
          As API keys são guardadas <strong style={{color:"#e2e8f0"}}>apenas no teu browser</strong> (localStorage local) e nunca são enviadas para nenhum servidor externo.
          As chamadas às APIs das exchanges são feitas pelo teu servidor local (localhost). <strong style={{color:C.amber}}>Usa sempre permissões Read Only</strong> — nunca dês permissões de trading às API keys.
        </div>
      </div>

      {/* Exchange cards */}
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(420px,1fr))",gap:16 }}>
        {EXCHANGES.map(ex=>{
          const cfg = configs[ex.id]||{key:"",secret:""};
          const result = results[ex.id];
          const isLoading = loading[ex.id];
          return (
            <div key={ex.id} style={{ background:C.card,border:`1px solid ${ex.status==="supported"?C.border:"#2d1a00"}`,borderRadius:10,overflow:"hidden" }}>
              {/* Header */}
              <div style={{ background:ex.color+"11",padding:"14px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12 }}>
                <span style={{ fontSize:24 }}>{ex.logo}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14,fontWeight:600,color:"#e2e8f0" }}>{ex.name}</div>
                  <span style={{ fontSize:9,padding:"2px 8px",borderRadius:10,background:ex.status==="supported"?"#14532d":"#451a03",color:ex.status==="supported"?C.green:C.amber }}>
                    {ex.status==="supported"?"API Automática":"Importação Manual"}
                  </span>
                </div>
                {result && (
                  <div style={{ fontSize:11,color:result.ok?C.green:C.red }}>
                    {result.ok ? "✓ OK" : "✗ Erro"}
                  </div>
                )}
              </div>

              <div style={{ padding:16 }}>
                <div style={{ fontSize:11,color:C.secondary,lineHeight:1.6,marginBottom:14 }}>{ex.note}</div>

                {ex.status==="supported" ? (
                  <>
                    <div style={{ display:"flex",flexDirection:"column",gap:10,marginBottom:14 }}>
                      <div>
                        <div style={{ fontSize:9,color:C.muted,letterSpacing:1.5,marginBottom:4 }}>API KEY</div>
                        <input type="password" value={cfg.key} onChange={e=>setKey(ex.id,"key",e.target.value)}
                          placeholder="Cole a tua API Key aqui..."
                          style={{ width:"100%",fontFamily:"monospace",fontSize:11 }}/>
                      </div>
                      <div>
                        <div style={{ fontSize:9,color:C.muted,letterSpacing:1.5,marginBottom:4 }}>API SECRET</div>
                        <input type="password" value={cfg.secret} onChange={e=>setKey(ex.id,"secret",e.target.value)}
                          placeholder="Cole o teu API Secret aqui..."
                          style={{ width:"100%",fontFamily:"monospace",fontSize:11 }}/>
                      </div>
                    </div>

                    {result && !result.ok && (
                      <div style={{ background:"#3b0f0f",border:"1px solid #7f1d1d",borderRadius:6,padding:10,marginBottom:10,fontSize:11,color:C.red }}>
                        ✗ {result.error}
                      </div>
                    )}
                    {result?.ok && result.imported !== undefined && (
                      <div style={{ background:"#14532d",border:"1px solid #4ade80",borderRadius:6,padding:10,marginBottom:10,fontSize:11,color:C.green }}>
                        ✓ {result.imported} trades novos importados de {result.total} encontrados
                      </div>
                    )}
                    {result?.ok && result.message && !result.imported && (
                      <div style={{ background:"#0f4c3a",border:"1px solid "+C.accent,borderRadius:6,padding:10,marginBottom:10,fontSize:11,color:C.accent }}>
                        ✓ {result.message}
                      </div>
                    )}

                    <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
                      <button onClick={()=>saveConfig(ex.id)} style={{ background:C.elevated,color:C.secondary,border:`1px solid ${C.border}`,padding:"6px 12px",borderRadius:4,fontSize:11 }}>
                        {saved[ex.id]?"✓ Guardado!":"Guardar Keys"}
                      </button>
                      <button onClick={()=>testConnection(ex.id)} disabled={isLoading} style={{ background:"#1e3a5f",color:C.blue,border:"1px solid #2d4a6b",padding:"6px 12px",borderRadius:4,fontSize:11 }}>
                        {isLoading?"A testar...":"Testar Conexão"}
                      </button>
                      <button onClick={()=>importTrades(ex.id)} disabled={isLoading} style={{ background:"#0f4c3a",color:C.accent,border:`1px solid ${C.accent}`,padding:"6px 12px",borderRadius:4,fontSize:11 }}>
                        {isLoading?"A importar...":"↓ Importar Trades"}
                      </button>
                      <a href={ex.docs} target="_blank" rel="noopener noreferrer" style={{ color:C.muted,fontSize:10,textDecoration:"none",padding:"6px 8px",border:`1px solid ${C.border}`,borderRadius:4,background:"transparent" }}>
                        Docs API ↗
                      </a>
                    </div>
                  </>
                ) : (
                  <div style={{ background:C.elevated,borderRadius:6,padding:12 }}>
                    <div style={{ fontSize:9,color:C.amber,letterSpacing:1.5,marginBottom:8 }}>COMO IMPORTAR MANUALMENTE</div>
                    <div style={{ fontSize:11,color:C.secondary,lineHeight:1.7 }}>
                      1. No xStation 5: Menu → Histórico → Exportar CSV<br/>
                      2. Seleciona o período pretendido<br/>
                      3. Exporta e regista manualmente cada trade no Journal<br/>
                      <span style={{ color:C.muted }}>Nota: A XTB não permite acesso via API para contas retail.</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Info about imported trades */}
      <div style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16 }}>
        <div style={{ fontSize:9,color:C.muted,letterSpacing:2,marginBottom:10 }}>ℹ️ O QUE É IMPORTADO AUTOMATICAMENTE</div>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12 }}>
          {[
            {icon:"📅",label:"Data do trade"},
            {icon:"💱",label:"Par / Instrumento"},
            {icon:"↕️",label:"Direcção (LONG/SHORT)"},
            {icon:"🎯",label:"Preço de entrada"},
            {icon:"💰",label:"P&L realizado"},
            {icon:"📊",label:"Quantidade"},
            {icon:"💸",label:"Fees/comissões"},
            {icon:"🔖",label:"ID da ordem"},
          ].map(({icon,label})=>(
            <div key={label} style={{ display:"flex",alignItems:"center",gap:8,fontSize:11,color:C.secondary }}>
              <span>{icon}</span>{label}
            </div>
          ))}
        </div>
        <div style={{ marginTop:12,fontSize:11,color:C.muted }}>
          Após importação, os campos técnicos (Elliott, Wyckoff, chock, estado mental) ficam para preencher manualmente no Journal. O sistema deteta trades duplicados pelo ID da ordem.
        </div>
      </div>
    </div>
  );
}
