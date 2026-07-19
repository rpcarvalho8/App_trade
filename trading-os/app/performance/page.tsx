"use client";
import { useState, useEffect } from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, ReferenceLine, ScatterChart, Scatter } from "recharts";

const C = { accent:"#4af0c4",green:"#4ade80",red:"#f87171",amber:"#fbbf24",blue:"#60a5fa",muted:"#475569",secondary:"#94a3b8",border:"#1e2d45",card:"#0d1929",elevated:"#111827" };

const Tip = ({active,payload,label}: any) => {
  if (!active||!payload?.length) return null;
  return <div style={{background:"#0d1929",border:"1px solid #1e2d45",padding:"8px 12px",borderRadius:4,fontSize:11}}>
    {label&&<div style={{color:C.muted,fontSize:9,marginBottom:4}}>{label}</div>}
    {payload.map((p: any)=><div key={p.name} style={{color:p.color||C.secondary}}>{p.name}: {typeof p.value==="number"?`$${p.value.toFixed(0)}`:p.value}</div>)}
  </div>;
};

export default function PerformancePage() {
  const [stats, setStats] = useState<any>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [err, setErr] = useState("");

  useEffect(()=>{
    Promise.all([
      fetch("/api/stats").then(r=>r.json()),
      fetch("/api/trades?limit=200").then(r=>r.json()),
    ]).then(([s,t])=>{setStats(s);setTrades(t);}).catch(e=>setErr(String(e)));
  },[]);

  if (err) return <div style={{color:C.red,padding:40}}>Erro: {err}</div>;
  if (!stats) return <div style={{color:C.muted,padding:40,textAlign:"center"}}>A carregar analytics...</div>;

  const s = stats.summary||{};
  const wins = trades.filter(t=>t.outcome==="WIN").map(t=>Number(t.pnl));
  const losses = trades.filter(t=>t.outcome==="LOSS").map(t=>Number(t.pnl));
  const avgWin = wins.length?wins.reduce((a,b)=>a+b,0)/wins.length:0;
  const avgLoss = losses.length?losses.reduce((a,b)=>a+b,0)/losses.length:0;
  const profitFactor = avgLoss!==0?Math.abs(avgWin/avgLoss):0;

  let cum=0,peak=0;
  const equityData=(stats.daily||[]).slice().reverse().map((d: any)=>{
    cum+=Number(d.pnl||0);
    peak=Math.max(peak,cum);
    return {date:String(d.date||"").slice(5),pnl:Number(d.pnl||0),cumulative:parseFloat(cum.toFixed(2)),dd:peak>0?parseFloat(((cum-peak)/peak*100).toFixed(2)):0};
  });

  const setupStats=(stats.bySetup||[]).map((x: any)=>({
    name:(x.setup||"").length>14?(x.setup||"").slice(0,14)+"…":(x.setup||""),
    wr:x.total>0?Number(((x.wins/x.total)*100).toFixed(1)):0,
    pnl:Number(x.pnl||0),trades:x.total,rr:Number(x.avg_rr||0).toFixed(2),
  }));

  const sorted=[...trades].filter(t=>t.outcome!=="RUNNING").reverse();
  let mxW=0,mxL=0,cW=0,cL=0;
  sorted.forEach(t=>{if(t.outcome==="WIN"){cW++;cL=0;mxW=Math.max(mxW,cW);}else if(t.outcome==="LOSS"){cL++;cW=0;mxL=Math.max(mxL,cL);}});

  const rrData=trades.filter(t=>t.rr_planned&&t.rr_real&&t.outcome!=="RUNNING").map(t=>({planned:Number(t.rr_planned),real:Number(t.rr_real),outcome:t.outcome}));

  const Stat=({label,value,color=C.secondary,sub}: any)=>(
    <div style={{background:C.elevated,borderRadius:6,padding:"12px 14px",border:`1px solid ${C.border}`}}>
      <div style={{fontSize:9,color:C.muted,letterSpacing:1.5,marginBottom:4}}>{label}</div>
      <div style={{fontSize:20,fontWeight:600,color}}>{value}</div>
      {sub&&<div style={{fontSize:9,color:C.muted,marginTop:2}}>{sub}</div>}
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div><div style={{fontSize:9,color:C.muted,letterSpacing:2}}>TRADING OS</div><div style={{fontSize:22,fontWeight:600,color:C.accent}}>Performance Analytics</div></div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:10}}>
        <Stat label="NET P&L" value={`$${Number(s.total_pnl||0).toFixed(0)}`} color={Number(s.total_pnl||0)>=0?C.green:C.red}/>
        <Stat label="WIN RATE" value={`${s.win_rate||0}%`} color={C.accent} sub={`${s.wins||0}W ${s.losses||0}L`}/>
        <Stat label="PROFIT FACTOR" value={profitFactor.toFixed(2)} color={profitFactor>=1.5?C.green:profitFactor>=1?C.amber:C.red}/>
        <Stat label="AVG WIN" value={`$${avgWin.toFixed(0)}`} color={C.green}/>
        <Stat label="AVG LOSS" value={`$${avgLoss.toFixed(0)}`} color={C.red}/>
        <Stat label="MAX WIN STREAK" value={mxW} color={C.green} sub="consecutivos"/>
        <Stat label="MAX LOSS STREAK" value={mxL} color={C.red} sub="consecutivos"/>
      </div>

      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16}}>
        <div style={{fontSize:9,color:C.muted,letterSpacing:2,marginBottom:12}}>CURVA DE EQUITY — ACUMULADO</div>
        {equityData.length>0?(
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={equityData}>
              <defs><linearGradient id="eg2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.accent} stopOpacity={0.3}/><stop offset="95%" stopColor={C.accent} stopOpacity={0}/></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45"/>
              <XAxis dataKey="date" tick={{fontSize:9,fill:C.muted}}/>
              <YAxis tick={{fontSize:9,fill:C.muted}}/>
              <Tooltip content={<Tip/>}/>
              <ReferenceLine y={0} stroke={C.border}/>
              <Area type="monotone" dataKey="cumulative" name="P&L $" stroke={C.accent} fill="url(#eg2)" strokeWidth={2} dot={false}/>
            </AreaChart>
          </ResponsiveContainer>
        ):<div style={{color:C.muted,fontSize:11,padding:40,textAlign:"center"}}>Sem dados de trades ainda.</div>}
      </div>

      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16}}>
        <div style={{fontSize:9,color:C.muted,letterSpacing:2,marginBottom:12}}>P&L DIÁRIO</div>
        {equityData.length>0?(
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={equityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45" vertical={false}/>
              <XAxis dataKey="date" tick={{fontSize:9,fill:C.muted}}/>
              <YAxis tick={{fontSize:9,fill:C.muted}}/>
              <Tooltip content={<Tip/>}/>
              <ReferenceLine y={0} stroke={C.muted}/>
              <Bar dataKey="pnl" name="P&L $" radius={[2,2,0,0]}>
                {equityData.map((d: any,i: number)=><Cell key={i} fill={d.pnl>=0?C.green:C.red}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ):<div style={{color:C.muted,fontSize:11,padding:20,textAlign:"center"}}>Sem dados.</div>}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16}}>
          <div style={{fontSize:9,color:C.muted,letterSpacing:2,marginBottom:12}}>ANÁLISE POR SETUP</div>
          {setupStats.length>0?(
            <table>
              <thead><tr><th>SETUP</th><th>TRADES</th><th>WIN RATE</th><th>AVG RR</th><th>P&L</th></tr></thead>
              <tbody>
                {setupStats.map((x: any)=>(
                  <tr key={x.name}>
                    <td style={{color:"#e2e8f0",fontWeight:500}}>{x.name}</td>
                    <td>{x.trades}</td>
                    <td>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{color:x.wr>=60?C.green:x.wr>=45?C.amber:C.red,fontWeight:500}}>{x.wr}%</span>
                        <div style={{flex:1,background:"#1e293b",borderRadius:2,height:4}}><div style={{width:`${x.wr}%`,height:"100%",background:x.wr>=60?C.green:x.wr>=45?C.amber:C.red,borderRadius:2}}/></div>
                      </div>
                    </td>
                    <td style={{color:C.amber}}>1:{x.rr}</td>
                    <td style={{color:x.pnl>=0?C.green:C.red,fontWeight:600}}>${x.pnl.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ):<div style={{color:C.muted,fontSize:11}}>Sem dados de setups ainda.</div>}
        </div>

        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16}}>
          <div style={{fontSize:9,color:C.muted,letterSpacing:2,marginBottom:12}}>ESTADO MENTAL vs PERFORMANCE</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {(stats.byMental||[]).map((m: any)=>{
              const wr=m.total>0?Number(((m.wins/m.total)*100).toFixed(1)):0;
              const pnl=Number(m.pnl||0);
              const cols: any={A:C.green,B:C.accent,C:C.amber,D:C.red};
              const labs: any={A:"Óptimo",B:"Bom",C:"Médio",D:"Mau"};
              const col=cols[m.mental_state]||C.muted;
              return (
                <div key={m.mental_state} style={{background:col+"11",border:`1px solid ${col}44`,borderRadius:8,padding:12,textAlign:"center"}}>
                  <div style={{fontSize:26,fontWeight:700,color:col}}>{m.mental_state}</div>
                  <div style={{fontSize:9,color:C.muted,marginBottom:8}}>{labs[m.mental_state]}</div>
                  <div style={{fontSize:16,fontWeight:600,color:wr>=60?C.green:wr>=45?C.amber:C.red}}>{wr}%</div>
                  <div style={{fontSize:9,color:C.muted}}>win rate</div>
                  <div style={{fontSize:13,fontWeight:500,color:pnl>=0?C.green:C.red,marginTop:4}}>${pnl.toFixed(0)}</div>
                  <div style={{fontSize:9,color:C.muted}}>{m.total} trades</div>
                </div>
              );
            })}
          </div>
          {(stats.byMental||[]).length===0&&<div style={{color:C.muted,fontSize:11,textAlign:"center"}}>Sem dados ainda.</div>}
        </div>
      </div>
    </div>
  );
}
