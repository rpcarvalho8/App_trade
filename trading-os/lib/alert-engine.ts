/**
 * Motor de Alertas em Tempo Real.
 *
 * Corre em segundo plano dentro do processo do `next dev` (via instrumentation.ts).
 * Dois mecanismos:
 *   1. Desvios abruptos de preço — sonda os ativos a cada N segundos e compara
 *      com a leitura anterior; se a variação exceder o limiar do ativo, emite alerta.
 *   2. Proximidade de eventos de ALTO IMPACTO — verifica o calendário económico
 *      e emite alerta ~5 min antes de cada evento de alto impacto do dia, e outro
 *      ~3 min depois com a reação de XAUUSD/SOLUSD (o feed não traz o valor real).
 *   3. Notícias de última hora — ver lib/news-engine.ts (arrancado em conjunto).
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
// Minutos DEPOIS da divulgação para medir a reação do preço (o calendário gratuito não traz o valor real).
const CAL_POST_MIN = Number(process.env.ALERTS_CAL_POST_MIN || 3);
// Ativos operados: a reação pós-evento é medida nestes.
const TRADED = ["XAUUSD", "SOLUSD"] as const;
const HISTORY_MS = 90 * 60_000;

// Limiar de variação (%) por leitura (~45s) para considerar "desvio abrupto".
// Valores base calibrados pela volatilidade intrínseca de cada ativo, lidos do
// .env (fallback para os defaults se ausentes/inválidos).
const THRESHOLD_DEFAULTS: Record<string, number> = {
  XAUUSD: 0.15, // Ouro — reage a dados macro e quebras técnicas
  BTCUSD: 0.4, // Bitcoin — referência, volatilidade moderada
  ETHUSD: 0.55, // Ethereum — volatilidade intermédia
  SOLUSD: 0.8, // Solana — beta alto, maior volatilidade
  EURUSD: 0.15, // FX — fonte diária (raramente dispara intraday)
  GBPUSD: 0.15,
};

/** Lê uma variável de ambiente como float; usa o fallback se ausente ou inválida. */
function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Limiares ativos, lidos do process.env em cada chamada (permite ao endpoint
 * /api/alerts/config refletir a configuração atual).
 */
export function getThresholds(): Record<string, number> {
  return {
    XAUUSD: envFloat("ALERT_THRESHOLD_GOLD", THRESHOLD_DEFAULTS.XAUUSD),
    BTCUSD: envFloat("ALERT_THRESHOLD_BTC", THRESHOLD_DEFAULTS.BTCUSD),
    ETHUSD: envFloat("ALERT_THRESHOLD_ETH", THRESHOLD_DEFAULTS.ETHUSD),
    SOLUSD: envFloat("ALERT_THRESHOLD_SOL", THRESHOLD_DEFAULTS.SOLUSD),
    EURUSD: envFloat("ALERT_THRESHOLD_EUR", THRESHOLD_DEFAULTS.EURUSD),
    GBPUSD: envFloat("ALERT_THRESHOLD_GBP", THRESHOLD_DEFAULTS.GBPUSD),
  };
}

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
  firedPost: Set<string>;
  /** Leituras recentes por ativo (90 min) para medir reações a notícias/eventos. */
  history: Record<string, { t: number; p: number }[]>;
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
      firedPost: new Set<string>(),
      history: {},
      events: [],
      eventsDay: "",
      priceTimer: null,
      calTimer: null,
    } as EngineState;
  }
  const st = g.__tosAlertEngine as EngineState;
  // Estado criado por uma versão anterior (hot reload) não tem estes campos.
  st.firedPost ??= new Set<string>();
  st.history ??= {};
  return st;
}

function recordPrice(asset: string, p: number, t = Date.now()): void {
  const h = (state().history[asset] ??= []);
  h.push({ t, p });
  while (h.length && t - h[0].t > HISTORY_MS) h.shift();
}

/** Último preço lido em ou antes de `t`. */
export function priceAt(asset: string, t: number): number | null {
  const h = state().history[asset] || [];
  let out: number | null = null;
  for (const x of h) {
    if (x.t <= t) out = x.p;
    else break;
  }
  return out;
}

/** Preço atual e variação % face a `windowMs` atrás (null se não houver histórico suficiente). */
export function priceReaction(asset: string, windowMs: number, now = Date.now()): { price: number; changePct: number | null } | null {
  const h = state().history[asset] || [];
  if (!h.length) return null;
  const price = h[h.length - 1].p;
  const ref = priceAt(asset, now - windowMs);
  return { price, changePct: ref ? ((price - ref) / ref) * 100 : null };
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

  const thresholds = getThresholds();
  for (const [asset, price] of Object.entries(prices)) {
    if (price == null) continue;
    recordPrice(asset, price);
    const prev = s.lastPrices[asset];
    if (prev != null && prev > 0) {
      // Variação absoluta percentual entre leitura atual e anterior.
      const changePct = ((price - prev) / prev) * 100;
      const th = thresholds[asset] ?? 1;
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

/**
 * Depois da divulgação: o feed gratuito não traz o valor real, por isso medimos o que interessa
 * ao trader — a reação do preço de XAUUSD e SOLUSD desde a hora do evento.
 */
function postReleaseTick(): void {
  const s = state();
  const now = Date.now();
  const th = getThresholds();
  for (const ev of s.events) {
    const t = new Date(ev.date).getTime();
    if (Number.isNaN(t)) continue;
    const minsAfter = (now - t) / 60000;
    const key = ev.date + ev.title;
    if (minsAfter < CAL_POST_MIN || minsAfter > CAL_POST_MIN + 10 || s.firedPost.has(key)) continue;
    s.firedPost.add(key);

    const moves: { asset: string; pct: number; price: number }[] = [];
    for (const a of TRADED) {
      const ref = priceAt(a, t);
      const cur = s.lastPrices[a];
      if (ref && cur) moves.push({ asset: a, pct: ((cur - ref) / ref) * 100, price: cur });
    }
    // Reação "forte" = acima do limiar de desvio abrupto do ativo.
    const strong = moves.some((m) => Math.abs(m.pct) >= (th[m.asset] ?? 1));
    const reaction = moves.length
      ? moves.map((m) => `${m.asset} ${m.pct >= 0 ? "+" : ""}${m.pct.toFixed(2)}% (${fmtPrice(m.price)})`).join(" · ")
      : "sem preço suficiente para medir a reação";
    broadcastAlert(
      mkAlert({
        type: "calendar",
        level: strong ? "critical" : "warning",
        asset: ev.country,
        title: `${strong ? "🚨" : "📊"} Saiu: ${ev.country} ${ev.title}`,
        message: `Reação em ${Math.round(minsAfter)} min: ${reaction}.${ev.forecast ? ` Previsão ${ev.forecast} vs anterior ${ev.previous}.` : ""}${strong ? " Movimento forte: não persigas o preço, espera a estrutura." : ""}`,
        meta: { kind: "post_release", moves },
      })
    );
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
      for (const [a, v] of Object.entries(p)) if (v != null) recordPrice(a, v);
      console.log("[Alerts] baseline de preços registada.");
    })
    .catch(() => {});

  refreshEventsIfNeeded();

  s.priceTimer = setInterval(() => {
    priceTick().catch((e) => console.warn("[Alerts] priceTick:", e?.message || e));
  }, PRICE_INTERVAL * 1000);

  s.calTimer = setInterval(() => {
    calendarTick()
      .then(() => postReleaseTick())
      .catch((e) => console.warn("[Alerts] calendarTick:", e?.message || e));
  }, CAL_INTERVAL * 1000);

  console.log(
    `[Alerts] motor ativo — preços a cada ${PRICE_INTERVAL}s, calendário a cada ${CAL_INTERVAL}s (aviso ${CAL_LEAD_MIN} min antes).`
  );
}
