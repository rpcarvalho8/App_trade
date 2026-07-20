/**
 * Motor de Alertas em Tempo Real.
 *
 * Corre em segundo plano dentro do processo do `next dev` (via instrumentation.ts).
 * Dois mecanismos:
 *   1. Desvios abruptos de preço — sonda os ativos a cada N segundos e compara
 *      com a leitura anterior; se a variação exceder o limiar do ativo, emite alerta.
 *   2. Proximidade de eventos de ALTO IMPACTO — verifica o calendário económico
 *      e emite alerta ~5 min antes de cada evento de alto impacto do dia.
 *
 * Fontes (gratuitas, sem chave):
 *   - Ouro: gold-api.com          (intraday)
 *   - Cripto: CoinGecko           (intraday)
 *   - FX: Frankfurter             (ECB, diário — variação intraday rara)
 *   - Calendário: ForexFactory JSON
 *
 * Nota: FX (Frankfurter) é atualizado diariamente, por isso os alertas de
 * desvio abrupto virão sobretudo de cripto e ouro.
 */
import { broadcastAlert, MarketAlert } from "@/lib/alert-ws";
import { fetchCalendar, CalEvent } from "@/lib/morning-brief";

const UA = "Mozilla/5.0 (compatible; TradingOS-AlertEngine/1.0)";

// Intervalos (segundos) — configuráveis por env.
const PRICE_INTERVAL = Number(process.env.ALERTS_PRICE_INTERVAL || 45);
const CAL_INTERVAL = Number(process.env.ALERTS_CAL_INTERVAL || 60);
const CAL_LEAD_MIN = Number(process.env.ALERTS_CAL_LEAD_MIN || 5); // minutos antes do evento

// Limiar de variação (%) por leitura para considerar "desvio abrupto".
const THRESHOLDS: Record<string, number> = {
  XAUUSD: Number(process.env.ALERTS_TH_GOLD || 0.4),
  BTCUSD: Number(process.env.ALERTS_TH_BTC || 0.8),
  ETHUSD: Number(process.env.ALERTS_TH_ETH || 1.0),
  SOLUSD: Number(process.env.ALERTS_TH_SOL || 1.2),
  EURUSD: Number(process.env.ALERTS_TH_EUR || 0.3),
  GBPUSD: Number(process.env.ALERTS_TH_GBP || 0.3),
};

async function getJSON(url: string, timeout = 15000): Promise<any> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  return res.json();
}

async function fetchPrices(): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  // Ouro + cripto + FX em paralelo, cada um tolerante a falhas.
  const tasks = [
    (async () => {
      try {
        const g = await getJSON("https://api.gold-api.com/price/XAU");
        out.XAUUSD = typeof g?.price === "number" ? g.price : null;
      } catch {}
    })(),
    (async () => {
      try {
        const c = await getJSON(
          "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd"
        );
        out.BTCUSD = c?.bitcoin?.usd ?? null;
        out.ETHUSD = c?.ethereum?.usd ?? null;
        out.SOLUSD = c?.solana?.usd ?? null;
      } catch {}
    })(),
    (async () => {
      try {
        const [eur, gbp] = await Promise.all([
          getJSON("https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD"),
          getJSON("https://api.frankfurter.dev/v1/latest?base=GBP&symbols=USD"),
        ]);
        out.EURUSD = eur?.rates?.USD ?? null;
        out.GBPUSD = gbp?.rates?.USD ?? null;
      } catch {}
    })(),
  ];
  await Promise.all(tasks);
  return out;
}

interface EngineState {
  started: boolean;
  lastPrices: Record<string, number | null>;
  firedCalendar: Set<string>;
  events: CalEvent[];
  eventsDay: string;
  priceTimer: NodeJS.Timeout | null;
  calTimer: NodeJS.Timeout | null;
}

function state(): EngineState {
  const g = globalThis as any;
  if (!g.__tosAlertEngine) {
    g.__tosAlertEngine = {
      started: false,
      lastPrices: {},
      firedCalendar: new Set<string>(),
      events: [],
      eventsDay: "",
      priceTimer: null,
      calTimer: null,
    } as EngineState;
  }
  return g.__tosAlertEngine as EngineState;
}

function mkAlert(a: Omit<MarketAlert, "id" | "ts">): MarketAlert {
  return { ...a, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ts: Date.now() };
}

function fmtPrice(v: number): string {
  return v >= 100 ? v.toLocaleString("pt-PT", { maximumFractionDigits: 2 }) : v.toFixed(4);
}

// ---------- 1) desvios abruptos ----------
async function priceTick(): Promise<void> {
  const s = state();
  let prices: Record<string, number | null>;
  try {
    prices = await fetchPrices();
  } catch {
    return;
  }

  for (const [asset, price] of Object.entries(prices)) {
    if (price == null) continue;
    const prev = s.lastPrices[asset];
    if (prev != null && prev > 0) {
      const changePct = ((price - prev) / prev) * 100;
      const th = THRESHOLDS[asset] ?? 1;
      if (Math.abs(changePct) >= th) {
        const dir = changePct > 0 ? "▲ subida" : "▼ queda";
        const level: MarketAlert["level"] = Math.abs(changePct) >= th * 2 ? "critical" : "warning";
        broadcastAlert(
          mkAlert({
            type: "price",
            level,
            asset,
            title: `${asset} · movimento abrupto`,
            message: `${dir} de ${changePct > 0 ? "+" : ""}${changePct.toFixed(2)}% (${fmtPrice(prev)} → ${fmtPrice(price)})`,
          })
        );
      }
    }
    s.lastPrices[asset] = price;
  }
}

// ---------- 2) proximidade de eventos de alto impacto ----------
function localDay(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function refreshEventsIfNeeded(): Promise<void> {
  const s = state();
  const day = localDay();
  if (s.eventsDay === day && s.events.length) return;
  try {
    const cal = await fetchCalendar(day);
    s.events = cal.todayHighImpact.filter((e) => !!e.date);
    s.eventsDay = day;
    console.log(`[Alerts] ${s.events.length} evento(s) de alto impacto carregado(s) para ${day}.`);
  } catch (e: any) {
    console.warn("[Alerts] não foi possível carregar o calendário:", e?.message || e);
  }
}

async function calendarTick(): Promise<void> {
  const s = state();
  await refreshEventsIfNeeded();
  const now = Date.now();
  for (const ev of s.events) {
    const t = new Date(ev.date).getTime();
    if (Number.isNaN(t)) continue;
    const minsTo = (t - now) / 60000;
    // Dispara uma vez quando faltam <= LEAD minutos e o evento ainda não passou.
    if (minsTo <= CAL_LEAD_MIN && minsTo > -1 && !s.firedCalendar.has(ev.date + ev.title)) {
      s.firedCalendar.add(ev.date + ev.title);
      const hhmm = new Intl.DateTimeFormat("pt-PT", {
        timeZone: "Europe/Lisbon",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(t));
      broadcastAlert(
        mkAlert({
          type: "calendar",
          level: "critical",
          asset: ev.country,
          title: `⚠️ Evento de alto impacto em ~${Math.max(0, Math.round(minsTo))} min`,
          message: `${hhmm} · ${ev.country} · ${ev.title}${ev.forecast ? ` (prev. ${ev.forecast} vs ant. ${ev.previous})` : ""}`,
        })
      );
    }
  }
}

/** Arranca o motor de alertas (idempotente). */
export function startAlertEngine(): void {
  const s = state();
  if (s.started) return;
  s.started = true;

  // Primeira leitura de preços só regista a baseline (sem alerta).
  fetchPrices()
    .then((p) => {
      s.lastPrices = p;
      console.log("[Alerts] baseline de preços registada.");
    })
    .catch(() => {});

  refreshEventsIfNeeded();

  s.priceTimer = setInterval(() => {
    priceTick().catch((e) => console.warn("[Alerts] priceTick:", e?.message || e));
  }, PRICE_INTERVAL * 1000);

  s.calTimer = setInterval(() => {
    calendarTick().catch((e) => console.warn("[Alerts] calendarTick:", e?.message || e));
  }, CAL_INTERVAL * 1000);

  console.log(
    `[Alerts] motor ativo — preços a cada ${PRICE_INTERVAL}s, calendário a cada ${CAL_INTERVAL}s (aviso ${CAL_LEAD_MIN} min antes).`
  );
}
