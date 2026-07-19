"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from "recharts";

const C = { accent:"#4af0c4",green:"#4ade80",red:"#f87171",amber:"#fbbf24",blue:"#60a5fa",muted:"#475569",secondary:"#94a3b8",border:"#1e2d45",card:"#0d1929",elevated:"#111827" };

const Tip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{background:"#0d1929",border:"1px solid #1e2d45",padding:"8px 12px",borderRadius:4,fontSize:11}}>
      {label && <div style={{color:C.muted,fontSize:9,marginBottom:4}}>{label}</div>}
      {payload.map((p: any) => <div key={p.name} style={{color:p.color||C.secondary}}>{p.name}: {typeof p.value==="number"?`$${p.value.toFixed(0)}`:p.value}</div>)}
    </div>
  );
};

export default function OverviewPage() {
  const [stats, setStats] = useState<any>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/stats").then(r=>r.json()),
      fetch("/api/trades?limit=20").then(r=>r.json()),
    ]).then(([s,t]) => { setStats(s); setTrades(t); }).catch(e => setErr(String(e)));
  }, []);

  if (err) return <div style={{color:C.red,padding:40}}>Erro: {err} — tenta recarregar a página.</div>;
  if (!stats) return <div style={{color:C.muted,padding:40,textAlign:"center"}}>A carregar dashboard...</div>;

  const s = stats.summary || {};
  const pnl = Number(s.total_pnl || 0);

  let cum = 0, peak = 0;
  const equityData = (stats.daily || []).slice().reverse().map((d: any) => {
    cum += Number(d.pnl || 0);
    peak = Math.max(peak, cum);
    return { date: String(d.date||"").slice(5), cumulative: parseFloat(cum.toFixed(2)), dd: peak>0 ? parseFloat(((cum-peak)/peak*100).toFixed(2)) : 0 };
  });

  const setupData = (stats.bySetup || []).map((x: any) => ({
    name: (x.setup||"").length>12?(x.setup||"").slice(0,12)+"…":(x.setup||""),
    wr: x.total>0?Math.round((x.wins/x.total)*100):0,
    pnl: Number(x.pnl||0),
  }));

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div>
          <div style={{fontSize:9,color:C.muted,letterSpacing:2}}>TRADING OS</div>
          <div style={{fontSize:22,fontWeight:600,color:C.accent}}>Overview</div>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>{new Date().toLocaleDateString("pt-PT",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Link href="/ai-coach" style={{background:C.card,color:C.accent,border:"1px solid #1e4d6b",padding:"6px 14px",borderRadius:4,textDecoration:"none",fontSize:11}}>⬡ Análise AI</Link>
          <Link href="/journal" style={{background:"#0f4c3a",color:C.accent,border:`1px solid ${C.accent}`,padding:"6px 14px",borderRadius:4,textDecoration:"none",fontSize:11}}>+ Registar Trade</Link>
        </div>
      </div>

      {/* Metrics */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:10}}>
        {[
          {label:"NET P&L",value:`$${pnl.toFixed(0)}`,color:pnl>=0?C.green:C.red,sub:`${s.total||0} trades`},
          {label:"WIN RATE",value:`${s.win_rate||0}%`,color:C.accent,sub:`${s.wins||0}W / ${s.losses||0}L`},
          {label:"AVG R:R",value:`1:${Number(s.avg_rr||0).toFixed(1)}`,color:C.amber,sub:"real"},
          {label:"AVG WIN",value:`$${Number(s.avg_win||0).toFixed(0)}`,color:C.green,sub:"por trade"},
          {label:"AVG LOSS",value:`$${Number(s.avg_loss||0).toFixed(0)}`,color:C.red,sub:"por trade"},
          {label:"VIOLATIONS",value:s.violations||0,color:(s.violations||0)>0?C.amber:C.green,sub:"regras quebradas"},
        ].map(m=>(
          <div key={m.label} style={{background:C.elevated,borderRadius:6,padding:"14px 16px",border:`1px solid ${C.border}`}}>
            <div style={{fontSize:9,color:C.muted,letterSpacing:2,marginBottom:6}}>{m.label}</div>
            <div style={{fontSize:22,fontWeight:600,color:m.color}}>{m.value}</div>
            <div style={{fontSize:10,color:C.muted,marginTop:3}}>{m.sub}</div>
          </div>
        ))}
      </div>

      {/* Execution Flow */}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16}}>
        <div style={{fontSize:9,color:C.muted,letterSpacing:2,marginBottom:12}}>EXECUTION FLOW — ÚLTIMOS 10 TRADES</div>
        <div style={{display:"flex",alignItems:"center",overflowX:"auto",paddingBottom:8}}>
          {trades.slice(0,10).reverse().map((t,i,arr)=>{
            const col = {WIN:C.green,LOSS:C.red,BE:C.amber,RUNNING:C.blue}[t.outcome as string]||C.muted;
            const lbl = (t.setup||"?").split(" ")[0].slice(0,3).toUpperCase();
            return (
              <div key={t.id} style={{display:"flex",alignItems:"center"}}>
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,minWidth:64}}>
                  <div style={{width:42,height:42,borderRadius:"50%",background:col+"22",border:`2px solid ${col}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:col,fontWeight:600}}>{lbl}</div>
                  <div style={{fontSize:9,color:Number(t.pnl)>=0?C.green:C.red,fontWeight:500}}>{Number(t.pnl)>=0?"+":""} ${Number(t.pnl).toFixed(0)}</div>
                  <div style={{fontSize:8,color:C.muted}}>{String(t.date||"").slice(5)}</div>
                </div>
                {i<arr.length-1&&<div style={{color:C.border,fontSize:14,margin:"0 -4px",paddingBottom:16}}>→</div>}
              </div>
            );
          })}
        </div>
        <div style={{fontSize:9,color:C.muted,marginTop:4}}>
          <span style={{color:C.green}}>●</span> WIN &nbsp;
          <span style={{color:C.red}}>●</span> LOSS &nbsp;
          <span style={{color:C.amber}}>●</span> B/E
        </div>
      </div>

      {/* Charts */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16}}>
          <div style={{fontSize:9,color:C.muted,letterSpacing:2,marginBottom:12}}>CURVA DE EQUITY</div>
          {equityData.length>0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={equityData}>
                <defs><linearGradient id="eg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.accent} stopOpacity={0.3}/><stop offset="95%" stopColor={C.accent} stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45"/>
                <XAxis dataKey="date" tick={{fontSize:9,fill:C.muted}}/>
                <YAxis tick={{fontSize:9,fill:C.muted}}/>
                <Tooltip content={<Tip/>}/>
                <Area type="monotone" dataKey="cumulative" name="P&L $" stroke={C.accent} fill="url(#eg)" strokeWidth={2} dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          ):<div style={{color:C.muted,fontSize:11,padding:20,textAlign:"center"}}>Sem dados ainda. Regista trades no Journal.</div>}
        </div>

        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16}}>
          <div style={{fontSize:9,color:C.muted,letterSpacing:2,marginBottom:12}}>WIN RATE POR SETUP</div>
          {setupData.length>0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={setupData} layout="vertical">
                <XAxis type="number" tick={{fontSize:9,fill:C.muted}} domain={[0,100]}/>
                <YAxis type="category" dataKey="name" tick={{fontSize:9,fill:C.secondary}} width={80}/>
                <Tooltip content={<Tip/>}/>
                <Bar dataKey="wr" name="Win Rate %" radius={[0,3,3,0]}>
                  {setupData.map((e: any,i: number)=><Cell key={i} fill={e.wr>=60?C.green:e.wr>=45?C.amber:C.red}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ):<div style={{color:C.muted,fontSize:11,padding:20,textAlign:"center"}}>Regista trades para ver este gráfico.</div>}
        </div>
      </div>

      {/* Session + Mental + Recent */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16}}>
          <div style={{fontSize:9,color:C.muted,letterSpacing:2,marginBottom:12}}>P&L POR SESSÃO</div>
          {(stats.bySession||[]).length===0 && <div style={{color:C.muted,fontSize:11}}>Sem dados</div>}
          {(stats.bySession||[]).map((s: any)=>{
            const wr=s.total>0?Math.round((s.wins/s.total)*100):0;
            return (
              <div key={s.session} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:`1px solid ${C.border}`,fontSize:11}}>
                <span style={{color:C.secondary}}>{s.session}</span>
                <span style={{color:C.muted}}>{s.total}</span>
                <span style={{color:wr>=55?C.green:wr>=40?C.amber:C.red}}>{wr}%</span>
                <span style={{color:Number(s.pnl)>=0?C.green:C.red,fontWeight:500}}>${Number(s.pnl).toFixed(0)}</span>
              </div>
            );
          })}
        </div>

        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16}}>
          <div style={{fontSize:9,color:C.muted,letterSpacing:2,marginBottom:12}}>ESTADO MENTAL vs RESULTADO</div>
          {(stats.byMental||[]).map((m: any)=>{
            const wr=m.total>0?Math.round((m.wins/m.total)*100):0;
            const colors: any={A:C.green,B:C.accent,C:C.amber,D:C.red};
            return (
              <div key={m.mental_state} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:`1px solid ${C.border}`,fontSize:11}}>
                <span style={{color:colors[m.mental_state]||C.muted,fontWeight:600}}>Estado {m.mental_state}</span>
                <span style={{color:C.muted}}>{m.total} trades</span>
                <span style={{color:wr>=60?C.green:wr>=40?C.amber:C.red}}>{wr}% WR</span>
                <span style={{color:Number(m.pnl)>=0?C.green:C.red,fontWeight:500}}>${Number(m.pnl).toFixed(0)}</span>
              </div>
            );
          })}
        </div>

        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:9,color:C.muted,letterSpacing:2}}>ÚLTIMOS TRADES</div>
            <Link href="/journal" style={{fontSize:10,color:C.accent,textDecoration:"none"}}>ver todos →</Link>
          </div>
          {trades.slice(0,5).map((t: any)=>(
            <div key={t.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:`1px solid ${C.border}`}}>
              <div><div style={{fontSize:11,color:"#e2e8f0"}}>{t.pair}</div><div style={{fontSize:9,color:C.muted}}>{t.setup}</div></div>
              <span style={{fontSize:9,padding:"1px 6px",borderRadius:10,background:t.direction==="LONG"?"#1e3a5f":"#3b1a1a",color:t.direction==="LONG"?"#7dd3fc":"#fca5a5"}}>{t.direction}</span>
              <span style={{fontSize:9,padding:"1px 7px",borderRadius:10,background:t.outcome==="WIN"?"#14532d":t.outcome==="LOSS"?"#7f1d1d":"#1e293b",color:t.outcome==="WIN"?C.green:t.outcome==="LOSS"?C.red:C.secondary}}>{t.outcome}</span>
              <span style={{fontSize:11,fontWeight:500,color:Number(t.pnl)>=0?C.green:C.red}}>{Number(t.pnl)>=0?"+":""} ${Number(t.pnl).toFixed(0)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
