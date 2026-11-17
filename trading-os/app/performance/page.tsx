"use client";
import { useState, useEffect } from "react";
import { computeMetrics, equityCurve, isClosedOutcome } from "@/lib/metrics";
import { costsByAccount, KIND_LABEL, netPnl, toEur, tradeFees, type Account } from "@/lib/accounts";
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
  const [equityNow, setEquityNow] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(()=>{
    // Capital actual = soma das contas no servidor (prop firms + corretoras), em EUR.
    fetch("/api/accounts").then(r=>r.json()).then((d: any)=>{
      const total=(d?.accounts||[]).reduce((a: number,x: any)=>a+toEur(Number(x.equity)||0,x.currency,d?.eurusd??null),0);
      setEquityNow(total);
      setAccounts(d?.accounts||[]);
    }).catch(()=>{});
    Promise.all([
      fetch("/api/stats").then(r=>r.json()),
      fetch("/api/trades?limit=5000").then(r=>r.json()),
    ]).then(([s,t])=>{setStats(s);setTrades(t);}).catch(e=>setErr(String(e)));
  },[]);

  if (err) return <div style={{color:C.red,padding:40}}>Erro: {err}</div>;
  if (!stats) return <div style={{color:C.muted,padding:40,textAlign:"center"}}>A carregar analytics...</div>;

  const s = stats.summary||{};
  // Só trades fechadas (exclui RUNNING e sinais PENDING por validar).
  const closedTrades = trades.filter(t=>isClosedOutcome(t.outcome));
  // Métricas líquidas (P&L − comissão − swap/funding); o PF bruto fica ao lado para comparar.
  const netTrades = closedTrades.map(t=>({...t,pnl:netPnl(t)}));
  const m = computeMetrics(netTrades);
  const mGross = computeMetrics(closedTrades);
  const pf = m.profitFactor;
  const fmtPf = (x: number|null)=>x==null?"—":x===Infinity?"∞":x.toFixed(2);
  const pfLabel = fmtPf(pf);
  const totalFees = closedTrades.reduce((a,t)=>a+tradeFees(t),0);
  const totalNet = netTrades.reduce((a,t)=>a+Number(t.pnl||0),0);
  const accountCosts = costsByAccount(closedTrades, accounts);

  // Curva de capital por dia: capital inicial = capital actual − P&L total fechado.
  const dailyMap = new Map<string,number>();
  for (const t of netTrades) dailyMap.set(String(t.date||""),(dailyMap.get(String(t.date||""))||0)+Number(t.pnl||0));
  const daily = [...dailyMap.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,pnl])=>({date,pnl}));
  const totalPnl = daily.reduce((a: number,d: any)=>a+Number(d.pnl||0),0);
  const startEquity = equityNow>0 ? equityNow - totalPnl : 0;
  const curve = equityCurve(daily.map((d: any)=>({label:String(d.date||"").slice(5),pnl:Number(d.pnl||0)})), startEquity);
  const equityData = curve.points.map(p=>({date:p.label,pnl:p.pnl,cumulative:p.equity,dd:p.ddPct}));
  const ddLabel = startEquity>0 ? `-${curve.maxDrawdownPct.toFixed(1)}%` : `-$${curve.maxDrawdownMoney.toFixed(0)}`;

  const setupStats=(stats.bySetup||[]).map((x: any)=>({
    name:(x.setup||"").length>14?(x.setup||"").slice(0,14)+"…":(x.setup||""),
    wr:x.total>0?Number(((x.wins/x.total)*100).toFixed(1)):0,
    pnl:Number(x.pnl||0),trades:x.total,rr:Number(x.avg_rr||0).toFixed(2),
  }));

  const sorted=[...closedTrades].reverse();
  let mxW=0,mxL=0,cW=0,cL=0;
  sorted.forEach(t=>{if(t.outcome==="WIN"){cW++;cL=0;mxW=Math.max(mxW,cW);}else if(t.outcome==="LOSS"){cL++;cW=0;mxL=Math.max(mxL,cL);}});

  const rrData=closedTrades.filter(t=>t.rr_planned&&t.rr_real).map(t=>({planned:Number(t.rr_planned),real:Number(t.rr_real),outcome:t.outcome}));

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

      {m.smallSample && m.trades>0 && (
        <div style={{background:"#2a1f08",border:`1px solid ${C.amber}55`,color:C.amber,padding:"8px 12px",borderRadius:6,fontSize:11}}>
          Amostra insuficiente: {m.trades} trades fechadas (mínimo 30 para conclusões fiáveis).
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
        <Stat label="P&L LÍQUIDO" value={`$${totalNet.toFixed(0)}`} color={totalNet>=0?C.green:C.red} sub={`bruto $${Number(s.total_pnl||0).toFixed(0)} · custos $${totalFees.toFixed(0)}`}/>
        <Stat label="WIN RATE" value={m.winRate==null?"—":`${m.winRate.toFixed(1)}%`} color={C.accent} sub={`${m.wins}W ${m.losses}L`}/>
        <Stat label="PROFIT FACTOR" value={pfLabel} color={pf==null?C.muted:pf>=1.5?C.green:pf>=1?C.amber:C.red} sub={`líquido · bruto ${fmtPf(mGross.profitFactor)}`}/>
        <Stat label="PAYOFF" value={m.payoff==null?"—":m.payoff.toFixed(2)} color={C.secondary} sub="ganho médio / perda média"/>
        <Stat label="EXPECTÂNCIA" value={m.expectancyR==null?"—":`${m.expectancyR>=0?"+":""}${m.expectancyR.toFixed(2)}R`} color={m.expectancyR==null?C.muted:m.expectancyR>0?C.green:C.red} sub={m.expectancyMoney==null?undefined:`$${m.expectancyMoney.toFixed(1)} por trade`}/>
        <Stat label="DRAWDOWN MÁX." value={ddLabel} color={C.red} sub={startEquity>0?"sobre o capital":"define o capital na Mesa para ver em %"}/>
        <Stat label="GANHO / PERDA MÉDIA" value={`$${(m.avgWin??0).toFixed(0)} / $${(m.avgLoss??0).toFixed(0)}`} color={C.secondary}/>
        <Stat label="SEQUÊNCIAS" value={`${mxW} / ${mxL}`} color={C.secondary} sub="máx. ganhos / perdas seguidas"/>
      </div>

      {accountCosts.length>0 && (
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16}}>
          <div style={{fontSize:9,color:C.muted,letterSpacing:2,marginBottom:12}}>CUSTOS POR CONTA</div>
          <table>
            <thead><tr><th>CONTA</th><th>TRADES</th><th>P&L BRUTO</th><th>CUSTOS</th><th>P&L LÍQUIDO</th><th title="spread / distância do SL + taxas / risco">CUSTO MÉDIO</th></tr></thead>
            <tbody>
              {accountCosts.map(b=>{ const kind=accounts.find(a=>a.name===b.account)?.kind; return (
                <tr key={b.account}>
                  <td style={{color:"#e2e8f0",fontWeight:500}}>{b.account}{kind&&<span style={{color:C.muted,fontSize:9,marginLeft:6}}>{KIND_LABEL[kind]}</span>}</td>
                  <td>{b.trades}</td>
                  <td style={{color:b.grossPnl>=0?C.green:C.red}}>${b.grossPnl.toFixed(0)}</td>
                  <td style={{color:C.amber}}>${b.fees.toFixed(2)}</td>
                  <td style={{color:b.netPnl>=0?C.green:C.red,fontWeight:600}}>${b.netPnl.toFixed(0)}</td>
                  <td style={{color:b.avgCostR==null?C.muted:b.avgCostR>0.15?C.red:b.avgCostR>0.08?C.amber:C.green}}>{b.avgCostR==null?"—":`${b.avgCostR.toFixed(3)}R`}</td>
                </tr>
              );})}
            </tbody>
          </table>
          <div style={{fontSize:9,color:C.muted,marginTop:8}}>Custo em R = spread ÷ distância do SL + (comissão + swap/funding) ÷ risco. Acima de 0,15R por trade come boa parte da vantagem.</div>
        </div>
      )}

      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:16}}>
        <div style={{fontSize:9,color:C.muted,letterSpacing:2,marginBottom:12}}>{startEquity>0?"CURVA DE CAPITAL":"CURVA DE EQUITY — P&L ACUMULADO"}</div>
        {equityData.length>0?(
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={equityData}>
              <defs><linearGradient id="eg2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.accent} stopOpacity={0.3}/><stop offset="95%" stopColor={C.accent} stopOpacity={0}/></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2d45"/>
              <XAxis dataKey="date" tick={{fontSize:9,fill:C.muted}}/>
              <YAxis tick={{fontSize:9,fill:C.muted}}/>
              <Tooltip content={<Tip/>}/>
              <ReferenceLine y={0} stroke={C.border}/>
              <Area type="monotone" dataKey="cumulative" name={startEquity>0?"Capital":"P&L $"} stroke={C.accent} fill="url(#eg2)" strokeWidth={2} dot={false}/>
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
          <div style={{fontSize:9,color:C.muted,letterSpacing:2,marginBottom:12}}>ANÁLISE POR ATIVO</div>
          {(stats.byPair||[]).length>0?(
            <table>
              <thead><tr><th>PAR</th><th>TRADES</th><th>WIN RATE</th><th>AVG RR</th><th>P&L</th></tr></thead>
              <tbody>
                {(stats.byPair||[]).map((x: any)=>{
                  const wr=x.total>0?Number(((x.wins/x.total)*100).toFixed(1)):0;
                  const pnl=Number(x.pnl||0);
                  return (
                    <tr key={x.pair}>
                      <td style={{color:"#e2e8f0",fontWeight:500}}>{x.pair}</td>
                      <td>{x.total}</td>
                      <td style={{color:wr>=60?C.green:wr>=45?C.amber:C.red,fontWeight:500}}>{wr}%</td>
                      <td style={{color:C.amber}}>1:{Number(x.avg_rr||0).toFixed(2)}</td>
                      <td style={{color:pnl>=0?C.green:C.red,fontWeight:600}}>${pnl.toFixed(0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ):<div style={{color:C.muted,fontSize:11}}>Sem dados por par ainda.</div>}
        </div>

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
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
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
