"use client";
import "./globals.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import AlertToaster from "./components/AlertToaster";
import DayRiskBar from "./components/DayRiskBar";

/** Navegação pela ordem do dia de trading: preparar e operar, depois rever, e só então consultar. */
const navGroups = [
  { title:"OPERAR", items:[
    { href:"/sessao", label:"Mesa de Operação", icon:"▶" },
    { href:"/morning-brief", label:"Morning Brief", icon:"🌅" },
    { href:"/signals", label:"Sinais", icon:"⚑" },
  ]},
  { title:"REVER", items:[
    { href:"/journal", label:"Journal", icon:"◉" },
    { href:"/performance", label:"Performance", icon:"▲" },
    { href:"/weekly-journal", label:"Journal Semanal", icon:"📅" },
    { href:"/ai-coach", label:"AI Coach", icon:"⬡" },
    { href:"/", label:"Overview", icon:"◈" },
  ]},
  { title:"REFERÊNCIA", items:[
    { href:"/setups", label:"Setups", icon:"◆" },
    { href:"/principles", label:"Princípios", icon:"◎" },
    { href:"/exchanges", label:"Exchanges", icon:"⇄" },
  ]},
];

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
          <div style={{ marginLeft:"auto",display:"flex",gap:16,alignItems:"center" }}>
            <DayRiskBar />
            <Link href="/journal" style={{ background:"#1e293b",color:"#94a3b8",border:"1px solid #1e2d45",padding:"4px 12px",borderRadius:4,textDecoration:"none",fontSize:11 }}>+ Trade</Link>
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
              {navGroups.map((g)=>(
                <div key={g.title} style={{ marginBottom:8 }}>
                  <div style={{ fontSize:9,color:"#2d4a6b",letterSpacing:2,padding:"8px 16px 4px" }}>{g.title}</div>
                  {g.items.map(({href,label,icon})=>(
                    <Link key={href} href={href} style={{
                      display:"flex",alignItems:"center",gap:10,padding:"8px 16px",
                      color:path===href?"#4af0c4":"#64748b",textDecoration:"none",fontSize:12,
                      borderLeft:`2px solid ${path===href?"#4af0c4":"transparent"}`,
                      background:path===href?"#0d1929":"transparent",
                    }}>
                      <span style={{ fontSize:11 }}>{icon}</span>{label}
                    </Link>
                  ))}
                </div>
              ))}
            </nav>
          </aside>
          <main style={{ flex:1,overflow:"auto",padding:20 }}>{children}</main>
        </div>
        {/* Alertas em tempo real (toasts globais via WebSocket) */}
        <AlertToaster />
      </body>
    </html>
  );
}
