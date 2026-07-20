"use client";
import "./globals.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import AlertToaster from "./components/AlertToaster";

const navItems = [
  { href:"/", label:"Overview", icon:"◈" },
  { href:"/morning-brief", label:"Morning Brief", icon:"🌅" },
  { href:"/journal", label:"Journal", icon:"◉" },
  { href:"/weekly-journal", label:"Journal Semanal", icon:"📅" },
  { href:"/performance", label:"Performance", icon:"▲" },
  { href:"/setups", label:"Setups", icon:"◆" },
  { href:"/ai-coach", label:"AI Coach", icon:"⬡" },
  { href:"/principles", label:"Princípios", icon:"◎" },
  { href:"/exchanges", label:"Exchanges", icon:"⇄" },
];

function QuickStats() {
  const [stats, setStats] = useState<any>(null);
  useEffect(()=>{
    fetch("/api/stats").then(r=>r.json()).then(setStats).catch(()=>{});
  },[]);
  if (!stats) return <div style={{ color:"#475569",fontSize:10 }}>Sem dados</div>;
  const s = stats.summary||{};
  const pnl = Number(s.total_pnl||0);
  return (
    <div style={{ display:"flex",flexDirection:"column",gap:4 }}>
      {[
        ["Wins",s.wins||0,"#4ade80"],
        ["Losses",s.losses||0,"#f87171"],
        ["P&L",`$${pnl.toFixed(0)}`,pnl>=0?"#4ade80":"#f87171"],
        ["Win Rate",`${s.win_rate||0}%`,"#4af0c4"],
        ["Violations",s.violations||0,"#fbbf24"],
      ].map(([label,val,color])=>(
        <div key={label as string} style={{ display:"flex",justifyContent:"space-between",fontSize:11 }}>
          <span style={{ color:"#475569" }}>{label}</span>
          <span style={{ color:color as string,fontWeight:500 }}>{val}</span>
        </div>
      ))}
    </div>
  );
}

function TopbarStats() {
  const [stats, setStats] = useState<any>(null);
  useEffect(()=>{
    fetch("/api/stats").then(r=>r.json()).then(setStats).catch(()=>{});
  },[]);
  if (!stats) return null;
  const s = stats.summary||{};
  const pnl = Number(s.total_pnl||0);
  return (
    <div style={{ display:"flex",gap:20,fontSize:11,color:"#64748b" }}>
      <span>WR <span style={{ color:"#4af0c4",fontWeight:500 }}>{s.win_rate||0}%</span></span>
      <span>Trades <span style={{ color:"#94a3b8",fontWeight:500 }}>{s.total||0}</span></span>
      <span>P&L <span style={{ color:pnl>=0?"#4ade80":"#f87171",fontWeight:500 }}>${pnl.toFixed(0)}</span></span>
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const path = usePathname();

  return (
    <html lang="pt">
      <body style={{ display:"flex",flexDirection:"column",height:"100vh",overflow:"hidden" }}>
        {/* Topbar */}
        <div style={{ background:"#050810",borderBottom:"1px solid #1e2d45",padding:"10px 20px",display:"flex",alignItems:"center",gap:16,zIndex:10,flexShrink:0 }}>
          <button onClick={()=>setSidebarOpen(o=>!o)} style={{ background:"none",border:"none",color:"#475569",fontSize:16,padding:"0 4px",cursor:"pointer" }}>☰</button>
          <span style={{ color:"#4af0c4",fontSize:11,fontWeight:600,letterSpacing:1 }}>TRADING OS</span>
          <span style={{ color:"#475569",fontSize:10 }}>·</span>
          <span style={{ color:"#64748b",fontSize:10 }}>Journal + AI Analysis + Exchanges</span>
          <div style={{ marginLeft:"auto",display:"flex",gap:16,alignItems:"center" }}>
            <TopbarStats />
            <Link href="/journal" style={{ background:"#0f4c3a",color:"#4af0c4",border:"1px solid #4af0c4",padding:"4px 12px",borderRadius:4,textDecoration:"none",fontSize:11 }}>+ Trade</Link>
            <Link href="/exchanges" style={{ background:"#1e293b",color:"#94a3b8",border:"1px solid #1e2d45",padding:"4px 12px",borderRadius:4,textDecoration:"none",fontSize:11 }}>⇄ Exchanges</Link>
          </div>
        </div>

        {/* Body */}
        <div style={{ display:"flex",flex:1,overflow:"hidden" }}>
          {/* Sidebar */}
          <aside style={{ width:sidebarOpen?210:0,minWidth:sidebarOpen?210:0,background:"#0a0e1a",borderRight:"1px solid #1e2d45",display:"flex",flexDirection:"column",overflow:"hidden",transition:"all 0.2s",flexShrink:0 }}>
            <div style={{ padding:"20px 16px 12px" }}>
              <div style={{ color:"#4af0c4",fontSize:11,fontWeight:600,letterSpacing:2 }}>⚡ TRADING OS</div>
              <div style={{ color:"#475569",fontSize:9,marginTop:2 }}>v1.0 · LOCAL · SQLite</div>
            </div>
            <nav style={{ flex:1,padding:"8px 0",overflowY:"auto" }}>
              <div style={{ fontSize:9,color:"#2d4a6b",letterSpacing:2,padding:"8px 16px 4px" }}>NAVIGATION</div>
              {navItems.map(({href,label,icon})=>(
                <Link key={href} href={href} style={{
                  display:"flex",alignItems:"center",gap:10,padding:"8px 16px",
                  color:path===href?"#4af0c4":"#64748b",textDecoration:"none",fontSize:12,
                  borderLeft:`2px solid ${path===href?"#4af0c4":"transparent"}`,
                  background:path===href?"#0d1929":"transparent",
                }}>
                  <span style={{ fontSize:11 }}>{icon}</span>{label}
                </Link>
              ))}
            </nav>
            <div style={{ padding:12,borderTop:"1px solid #1e2d45" }}>
              <div style={{ fontSize:9,color:"#2d4a6b",letterSpacing:2,marginBottom:8 }}>QUICK STATS</div>
              <QuickStats />
            </div>
          </aside>
          <main style={{ flex:1,overflow:"auto",padding:20 }}>{children}</main>
        </div>
        {/* Alertas em tempo real (toasts globais via WebSocket) */}
        <AlertToaster />
      </body>
    </html>
  );
}
