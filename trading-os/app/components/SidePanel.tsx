"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect } from "react";

/** Morning Brief e AI Coach como painéis laterais: abrem por cima de qualquer ecrã, sem sair da Mesa. */
const MorningBrief = dynamic(() => import("@/app/morning-brief/page"), { ssr: false });
const AICoach = dynamic(() => import("@/app/ai-coach/page"), { ssr: false });

export type PanelId = "brief" | "coach";

const TITLE: Record<PanelId, { label: string; href: string }> = {
  brief: { label: "Morning Brief", href: "/morning-brief" },
  coach: { label: "AI Coach", href: "/ai-coach" },
};

export default function SidePanel({ panel, onClose }: { panel: PanelId | null; onClose: () => void }) {
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, onClose]);

  if (!panel) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#00000088", zIndex: 40 }} />
      <aside
        role="dialog"
        aria-label={TITLE[panel].label}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(720px, 100vw)",
          background: "#0a0e1a",
          borderLeft: "1px solid #1e2d45",
          zIndex: 41,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid #1e2d45" }}>
          <span style={{ color: "#4af0c4", fontSize: 12, fontWeight: 600, letterSpacing: 1 }}>{TITLE[panel].label.toUpperCase()}</span>
          <Link href={TITLE[panel].href} onClick={onClose} style={{ color: "#64748b", fontSize: 11, marginLeft: "auto" }}>
            Abrir em página inteira
          </Link>
          <button onClick={onClose} aria-label="Fechar" style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 16, cursor: "pointer" }}>
            ✕
          </button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>{panel === "brief" ? <MorningBrief /> : <AICoach />}</div>
      </aside>
    </>
  );
}
