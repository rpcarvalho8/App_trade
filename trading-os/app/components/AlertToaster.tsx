"use client";
import { useEffect, useRef, useState, useCallback } from "react";

interface MarketAlert {
  id: string;
  type: "price" | "calendar" | "signal";
  level: "info" | "warning" | "critical";
  asset?: string;
  title: string;
  message: string;
  ts: number;
  meta?: Record<string, unknown>;
}

const LEVEL_STYLE: Record<string, { border: string; bg: string; accent: string }> = {
  info: { border: "#1e2d45", bg: "#0d1929", accent: "#4af0c4" },
  warning: { border: "#78551a", bg: "#1f1608", accent: "#fbbf24" },
  critical: { border: "#7f1d1d", bg: "#2a1215", accent: "#f87171" },
};

const AUTO_DISMISS_MS = 12000;

/** Beep curto via Web Audio API (sem ficheiro externo). */
function playAlertSound(kind: MarketAlert["type"]) {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const tones =
      kind === "signal"
        ? [880, 1174, 880]
        : kind === "calendar"
          ? [660, 520]
          : [740];
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.16);
    });
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch {
    // autoplay policies / browsers sem AudioContext
  }
}

export default function AlertToaster() {
  const [toasts, setToasts] = useState<MarketAlert[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushToast = useCallback((a: MarketAlert) => {
    if (seen.current.has(a.id)) return;
    seen.current.add(a.id);
    setToasts((prev) => [a, ...prev].slice(0, 5));
    if (a.type === "signal" || a.level === "critical") {
      playAlertSound(a.type);
    }
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== a.id));
    }, a.type === "signal" ? 20000 : AUTO_DISMISS_MS);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    let closed = false;

    async function connect() {
      let wsPort = 3001;
      try {
        const r = await fetch("/api/alerts/config", { cache: "no-store" });
        const j = await r.json();
        if (j?.wsPort) wsPort = j.wsPort;
      } catch {
        // usa o default
      }
      if (closed) return;

      const host = window.location.hostname || "localhost";
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      let ws: WebSocket;
      try {
        ws = new WebSocket(`${proto}://${host}:${wsPort}`);
      } catch {
        scheduleRetry();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.kind === "alert" && data.alert) {
            pushToast(data.alert as MarketAlert);
          } else if (data.kind === "hello" && Array.isArray(data.recent)) {
            for (const a of data.recent as MarketAlert[]) seen.current.add(a.id);
          }
        } catch {}
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) scheduleRetry();
      };
      ws.onerror = () => {
        try { ws.close(); } catch {}
      };
    }

    function scheduleRetry() {
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = setTimeout(connect, 5000);
    }

    connect();
    return () => {
      closed = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      try { wsRef.current?.close(); } catch {}
    };
  }, [pushToast]);

  return (
    <div
      style={{
        position: "fixed",
        top: 56,
        right: 16,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        width: 340,
        maxWidth: "calc(100vw - 32px)",
        pointerEvents: "none",
      }}
    >
      <div style={{ alignSelf: "flex-end", pointerEvents: "none", display: "flex", alignItems: "center", gap: 5, opacity: 0.7 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: connected ? "#4ade80" : "#475569" }} />
        <span style={{ fontSize: 9, color: "#475569", letterSpacing: 0.5 }}>
          {connected ? "ALERTAS LIVE" : "ALERTAS OFF"}
        </span>
      </div>

      {toasts.map((t) => {
        const st = LEVEL_STYLE[t.level] || LEVEL_STYLE.info;
        const typeLabel =
          t.type === "calendar" ? "CALENDÁRIO" : t.type === "signal" ? "SINAL" : "PREÇO";
        return (
          <div
            key={t.id}
            style={{
              pointerEvents: "auto",
              background: st.bg,
              border: `1px solid ${st.border}`,
              borderLeft: `3px solid ${st.accent}`,
              borderRadius: 8,
              padding: "11px 13px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
              animation: "tos-slide-in 0.22s ease-out",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ color: st.accent, fontSize: 12, fontWeight: 600 }}>{t.title}</div>
              <button
                onClick={() => dismiss(t.id)}
                style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}
              >
                ×
              </button>
            </div>
            <div style={{ color: "#cbd5e1", fontSize: 11.5, marginTop: 5, lineHeight: 1.45 }}>{t.message}</div>
            <div style={{ color: "#475569", fontSize: 9, marginTop: 6, display: "flex", justifyContent: "space-between" }}>
              <span>{typeLabel}{t.asset ? ` · ${t.asset}` : ""}</span>
              <span>{new Date(t.ts).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          </div>
        );
      })}

      <style jsx global>{`
        @keyframes tos-slide-in {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
