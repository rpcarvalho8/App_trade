/**
 * Servidor WebSocket para alertas em tempo real.
 *
 * Arranca num processo único (via instrumentation.ts) numa porta separada
 * (default 3001) para não interferir com o servidor Next (3000). O frontend
 * liga-se a ws://<host>:<WS_PORT> e recebe alertas em push (toasts).
 *
 * Mantém um buffer curto dos últimos alertas para reidratar clientes que
 * liguem depois de um alerta ter sido emitido.
 */
import type { WebSocketServer, WebSocket } from "ws";

export interface MarketAlert {
  id: string;
  type: "price" | "calendar";
  level: "info" | "warning" | "critical";
  asset?: string;
  title: string;
  message: string;
  ts: number; // epoch ms
}

export const WS_PORT = Number(process.env.ALERTS_WS_PORT || 3001);
const BUFFER_MAX = 30;

interface WsState {
  wss: WebSocketServer | null;
  clients: Set<WebSocket>;
  buffer: MarketAlert[];
  started: boolean;
}

function state(): WsState {
  const g = globalThis as any;
  if (!g.__tosAlertWs) {
    g.__tosAlertWs = { wss: null, clients: new Set(), buffer: [], started: false } as WsState;
  }
  return g.__tosAlertWs as WsState;
}

/** Arranca o servidor WebSocket (idempotente). */
export async function startAlertWs(): Promise<void> {
  const s = state();
  if (s.started) return;
  s.started = true;

  let WSServer: typeof WebSocketServer;
  try {
    ({ WebSocketServer: WSServer } = await import("ws"));
  } catch {
    console.error("[Alerts] pacote 'ws' não instalado. Corre: npm install");
    return;
  }

  try {
    const wss = new WSServer({ port: WS_PORT });
    s.wss = wss;

    wss.on("connection", (socket: WebSocket) => {
      s.clients.add(socket);
      // Reidrata o cliente com os alertas recentes.
      try {
        socket.send(JSON.stringify({ kind: "hello", recent: s.buffer }));
      } catch {}
      socket.on("close", () => s.clients.delete(socket));
      socket.on("error", () => s.clients.delete(socket));
    });

    wss.on("error", (err: any) => {
      if (err?.code === "EADDRINUSE") {
        console.warn(`[Alerts] porta ${WS_PORT} já em uso — assumo que o servidor WS já corre.`);
      } else {
        console.error("[Alerts] erro no servidor WS:", err?.message || err);
      }
    });

    console.log(`[Alerts] servidor WebSocket ativo em ws://localhost:${WS_PORT}`);
  } catch (e: any) {
    console.error("[Alerts] não foi possível arrancar o servidor WS:", e?.message || e);
  }
}

/** Emite um alerta para todos os clientes ligados e guarda no buffer. */
export function broadcastAlert(alert: MarketAlert): void {
  const s = state();
  s.buffer.push(alert);
  if (s.buffer.length > BUFFER_MAX) s.buffer.splice(0, s.buffer.length - BUFFER_MAX);

  const payload = JSON.stringify({ kind: "alert", alert });
  for (const socket of s.clients) {
    try {
      if ((socket as any).readyState === 1) socket.send(payload);
    } catch {}
  }
  console.log(`[Alerts] ${alert.level.toUpperCase()} · ${alert.title} — ${alert.message}`);
}

export function recentAlerts(): MarketAlert[] {
  return state().buffer.slice();
}
