export type SessionAsset = "XAUUSD" | "SOLUSD";
export type StepKind = "manual" | "news" | "rr" | "filters";

export interface PlaybookStep {
  id: string;
  label: string;
  help: string;
  kind: StepKind;
}

export interface AssetPlaybook {
  asset: SessionAsset;
  setupName: string;
  title: string;
  tagline: string;
  sessionWindow: string;
  defaultSession: string;
  timeframes: string;
  minRR: number;
  maxTrades: number;
  maxDailyDD: number;
  pauseAfterLosses: number;
  pauseMinutes: number;
  defaultRiskPct: number;
  reducedRiskPct: number;
  steps: PlaybookStep[];
  management: string[];
  invalidation: string[];
  killSwitch: string[];
}

export const PLAYBOOKS: Record<SessionAsset, AssetPlaybook> = {
  XAUUSD: {
    asset: "XAUUSD",
    setupName: "XAUUSD — London Structure",
    title: "London Structure",
    tagline: "Bias H4 → sweep/MSS M15 → entrada M5. Um setup, uma janela, um kill-switch.",
    sessionWindow: "London e London+NY. Fora disto: observação, não execução.",
    defaultSession: "London",
    timeframes: "H4 bias · M15 sweep/MSS · M5 entrada",
    minRR: 2,
    maxTrades: 2,
    maxDailyDD: 1.5,
    pauseAfterLosses: 2,
    pauseMinutes: 30,
    defaultRiskPct: 1,
    reducedRiskPct: 0.5,
    steps: [
      {
        id: "news",
        label: "Calendário limpo (30 min)",
        help: "Nenhum high-impact US nos próximos 30 min (NFP, CPI, FOMC, Powell). Se o motor de alertas marcar blackout, este passo fica bloqueado.",
        kind: "news",
      },
      {
        id: "bias",
        label: "Bias H4 claro",
        help: "Direção óbvia no H4. Não operar em Fase B / range incerto. Wyckoff D/E ou BOS H4 na mesma direção.",
        kind: "manual",
      },
      {
        id: "sweep",
        label: "Sweep de liquidez M15",
        help: "Preço viola EQH/EQL (ou máximo/mínimo chave) e fecha de volta para dentro. Wick de desvio, não close através.",
        kind: "manual",
      },
      {
        id: "mss",
        label: "CISD / MSS M15 na direção do bias",
        help: "Após o sweep, mudança de estrutura M15 a favor do bias H4. Sem MSS: não há trade.",
        kind: "manual",
      },
      {
        id: "zone",
        label: "Zona de entrada M5 (OB ou FVG)",
        help: "Order Block ou FVG M5 que causou o MSS. SL além do sweep. Sem zona clara: esperar.",
        kind: "manual",
      },
      {
        id: "rr",
        label: "R:R ≥ 2.0 até liquidez oposta",
        help: "Calcular até ao próximo pool H1/M15. Abaixo de 2.0: rejeitar. Não forçar 3R em ouro.",
        kind: "rr",
      },
      {
        id: "risk",
        label: "Risco 1% (0.5% se mental < 5)",
        help: "Size = f(SL). Score mental baixo → metade do risco. Grade D / sono < 6h / stress > 7 → sessão fechada.",
        kind: "filters",
      },
    ],
    management: [
      "SL além do extremo do sweep.",
      "TP1: 50% em 1R → mover SL para break-even.",
      "Resto na liquidez oposta H1/M15.",
    ],
    invalidation: [
      "Vela fecha através da zona de entrada.",
      "Notícia high-impact a sair.",
      "H4 vira contra o trade.",
      "R:R calculado < 2.0.",
    ],
    killSwitch: [
      "2 losses seguidos → pausa 30 min.",
      "Máximo 2 trades no dia.",
      "Drawdown diário ≥ 1.5% → parar.",
      "Grade D, sono < 6h ou stress > 7 → não operar.",
    ],
  },
  SOLUSD: {
    asset: "SOLUSD",
    setupName: "SMC 3-Step Scalping",
    title: "SMC 3-Step",
    tagline: "Sweep 15m → ChoCH 1m com volume → FVG na Golden Ratio. Sequência obrigatória.",
    sessionWindow: "Liquidez US / overlap. Evitar Ásia ilíquida se o sweep 15m for barulho.",
    defaultSession: "NY",
    timeframes: "15m direção · 1m ChoCH + FVG + execução",
    minRR: 3,
    maxTrades: 3,
    maxDailyDD: 3,
    pauseAfterLosses: 2,
    pauseMinutes: 30,
    defaultRiskPct: 1,
    reducedRiskPct: 0.5,
    steps: [
      {
        id: "sweep",
        label: "Passo 1 — Sweep 15m",
        help: "Wick viola máximo/mínimo chave de 15m e fecha dentro. Desvio ≤ 0.2%. Janela: 30 velas de 1m. Sem sweep: não há setup.",
        kind: "manual",
      },
      {
        id: "choch",
        label: "Passo 2 — ChoCH 1m com volume",
        help: "Bullish: close acima do último LH. Bearish: close abaixo do último HL. Volume da vela ChoCH > média 20 × 1.5. Máximo 20 velas de 1m após o Passo 1.",
        kind: "manual",
      },
      {
        id: "fvg",
        label: "Passo 3 — FVG 1m na Golden Ratio",
        help: "Fib do impulso do ChoCH. FVG ≥ 0.10% que coincide com 0.618–0.786. Ordem limite no topo (long) ou base (short) do FVG.",
        kind: "manual",
      },
      {
        id: "rr",
        label: "Gate R:R ≥ 3.0",
        help: "Até à liquidez 15m oposta. Se R:R < 3.0 → rejeitar sem exceções.",
        kind: "rr",
      },
      {
        id: "filters",
        label: "Spread, ATR e notícias",
        help: "Spread < 50% do FVG. ATR 15m ≤ 1.5%. Sem high-impact nos próximos 30 min. Se BTC/SOL em spike de liquidação: esperar.",
        kind: "news",
      },
    ],
    management: [
      "SL agressivo: 1 tick além do FVG (só se FVG > 0.15%).",
      "SL conservador: 1 tick além do extremo do impulso ChoCH.",
      "TP parcial 50% em 2R → SL para break-even.",
      "TP final 50% em 3R+ ou liquidez 15m oposta.",
    ],
    invalidation: [
      "Sem sweep 15m claro.",
      "ChoCH sem spike de volume.",
      "FVG fora de 0.618–0.786.",
      "R:R < 3.0.",
      "ATR > 1.5% ou spread > 50% do FVG.",
    ],
    killSwitch: [
      "2 losses seguidos → pausa 30 min.",
      "Máximo 3 trades no dia.",
      "Drawdown diário ≥ 3% → parar.",
      "Grade D, sono < 6h ou stress > 7 → não operar.",
    ],
  },
};

export function getPlaybook(asset: string): AssetPlaybook | null {
  if (asset === "XAUUSD" || asset === "SOLUSD") return PLAYBOOKS[asset];
  return null;
}

export function calcRR(
  direction: "LONG" | "SHORT",
  entry: number,
  sl: number,
  tp: number
): number | null {
  if (![entry, sl, tp].every((n) => Number.isFinite(n) && n > 0)) return null;
  const risk = direction === "LONG" ? entry - sl : sl - entry;
  const reward = direction === "LONG" ? tp - entry : entry - tp;
  if (risk <= 0 || reward <= 0) return null;
  return reward / risk;
}

/** Unidades por cada 1000 de capital, dado o risco % e a distância ao SL. */
export function sizePerThousand(
  riskPct: number,
  entry: number,
  sl: number
): number | null {
  if (![riskPct, entry, sl].every((n) => Number.isFinite(n)) || entry <= 0) return null;
  const dist = Math.abs(entry - sl);
  if (dist <= 0) return null;
  const riskMoney = (1000 * riskPct) / 100;
  return riskMoney / dist;
}

export function sizeForEquity(
  equity: number,
  riskPct: number,
  entry: number,
  sl: number
): number | null {
  const perK = sizePerThousand(riskPct, entry, sl);
  if (perK == null || !Number.isFinite(equity) || equity <= 0) return null;
  return (perK * equity) / 1000;
}
