import type { BiasDirection, Candle } from "../types";

/**
 * Zonas HTF (H4 / H1): Fair Value Gaps e Order Blocks nascidos de deslocamento.
 *
 * Uma zona é útil enquanto está "fresca": ainda não foi tocada depois de nascer.
 * O primeiro regresso do preço a uma zona fresca é o ponto onde a estratégia de
 * rotação procura entrada; a zona oposta é o destino (TP) do movimento.
 */
export interface HtfZone {
  /** Identificador estável (TF + tipo + hora da vela que criou a zona). */
  id: string;
  tf: string;
  kind: "fvg" | "ob";
  /** bullish = zona de procura (compra); bearish = zona de oferta (venda). */
  direction: "bullish" | "bearish";
  high: number;
  low: number;
  /** Hora (ms) da vela que completou a zona. */
  createdAt: number;
  /** ATR do TF no momento da criação. */
  atr: number;
  /** Uma vela fechou para lá do extremo oposto da zona. */
  broken: boolean;
  /** Índice da primeira vela (fechada) que tocou na zona depois de nascer. */
  firstTouchIndex: number | null;
}

export interface ZoneParams {
  atrPeriod?: number;
  /** Corpo mínimo da vela de deslocamento, em múltiplos de ATR. */
  displacementAtr?: number;
  /** Tamanho mínimo do FVG, em múltiplos de ATR. */
  minGapAtr?: number;
  /** Idade máxima da zona, em velas do próprio TF. */
  maxAgeBars?: number;
  /** Altura máxima do OB, em múltiplos de ATR (OBs enormes dão SL inutilizável). */
  maxObAtr?: number;
}

/** Average True Range simples das `period` velas que terminam em `end` (inclusive). */
export function atrAt(candles: Candle[], end: number, period = 14): number {
  const start = Math.max(1, end - period + 1);
  let sum = 0;
  let n = 0;
  for (let i = start; i <= end; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    sum += Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
    n++;
  }
  return n > 0 ? sum / n : 0;
}

export function atr(candles: Candle[], period = 14): number {
  if (!candles || candles.length < 2) return 0;
  return atrAt(candles, candles.length - 1, period);
}

const body = (c: Candle) => Math.abs(c.close - c.open);
const isBull = (c: Candle) => c.close > c.open;
const isBear = (c: Candle) => c.close < c.open;

/**
 * Encontra FVGs e OBs em velas FECHADAS de um TF.
 * Só considera zonas criadas por uma vela de deslocamento (corpo ≥ displacementAtr × ATR).
 */
export function findHtfZones(candles: Candle[], tf: string, params: ZoneParams = {}): HtfZone[] {
  const period = params.atrPeriod ?? 14;
  const dispK = params.displacementAtr ?? 1.2;
  const gapK = params.minGapAtr ?? 0.25;
  const maxAge = params.maxAgeBars ?? 60;
  const maxObK = params.maxObAtr ?? 2.5;
  const n = candles?.length ?? 0;
  if (n < period + 3) return [];

  const zones: HtfZone[] = [];
  const from = Math.max(period + 2, n - maxAge);

  for (let i = from; i < n; i++) {
    const c0 = candles[i - 2];
    const d = candles[i - 1]; // vela de deslocamento
    const c2 = candles[i];
    const a = atrAt(candles, i - 2, period);
    if (a <= 0) continue;
    if (body(d) < dispK * a) continue;

    // FVG: gap entre c0 e c2, com a vela do meio a deslocar na mesma direcção.
    if (isBull(d) && c2.low > c0.high && c2.low - c0.high >= gapK * a) {
      zones.push(mk(tf, "fvg", "bullish", c2.low, c0.high, c2.time, a));
    }
    if (isBear(d) && c2.high < c0.low && c0.low - c2.high >= gapK * a) {
      zones.push(mk(tf, "fvg", "bearish", c0.low, c2.high, c2.time, a));
    }

    // OB: última vela contrária antes do deslocamento, que o deslocamento ultrapassa.
    if (isBull(d) && isBear(c0) && d.close > c0.high && c0.high - c0.low <= maxObK * a) {
      zones.push(mk(tf, "ob", "bullish", c0.high, c0.low, d.time, a));
    }
    if (isBear(d) && isBull(c0) && d.close < c0.low && c0.high - c0.low <= maxObK * a) {
      zones.push(mk(tf, "ob", "bearish", c0.high, c0.low, d.time, a));
    }
  }

  // Estado de cada zona depois de nascer: tocada? partida?
  for (const z of zones) {
    const start = candles.findIndex((c) => c.time > z.createdAt);
    if (start < 0) continue;
    for (let k = start; k < n; k++) {
      const c = candles[k];
      const touched = z.direction === "bullish" ? c.low <= z.high : c.high >= z.low;
      if (touched && z.firstTouchIndex == null) z.firstTouchIndex = k;
      const broke = z.direction === "bullish" ? c.close < z.low : c.close > z.high;
      if (broke) {
        z.broken = true;
        break;
      }
    }
  }
  return zones;
}

function mk(
  tf: string,
  kind: HtfZone["kind"],
  direction: HtfZone["direction"],
  high: number,
  low: number,
  createdAt: number,
  a: number
): HtfZone {
  return {
    id: `${tf}:${kind}:${direction}:${createdAt}`,
    tf,
    kind,
    direction,
    high,
    low,
    createdAt,
    atr: a,
    broken: false,
    firstTouchIndex: null,
  };
}

/**
 * Zona fresca a ser tocada agora: não partida, sem toques antes da última vela fechada,
 * e o preço actual dentro da zona (± tolerância). Prefere H4 a H1 e a zona mais recente.
 */
export function findTappedZone(
  zonesByTf: { tf: string; zones: HtfZone[]; closedCount: number }[],
  price: number,
  bias: BiasDirection,
  opts: { requireBiasAlignment?: boolean; toleranceAtr?: number; exclude?: string[] } = {}
): HtfZone | null {
  const tolK = opts.toleranceAtr ?? 0.1;
  const exclude = new Set(opts.exclude || []);
  for (const { zones, closedCount } of zonesByTf) {
    const candidates = zones
      .filter((z) => !z.broken && !exclude.has(z.id))
      .filter((z) => z.firstTouchIndex == null || z.firstTouchIndex >= closedCount - 1)
      .filter((z) => !opts.requireBiasAlignment || z.direction === bias)
      .filter((z) => {
        const tol = z.atr * tolK;
        return price <= z.high + tol && price >= z.low - tol;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    if (candidates.length) return candidates[0];
  }
  return null;
}

/** Pivots fractais (máximos/mínimos com `side` velas mais baixas/altas de cada lado). */
export function swingPivots(candles: Candle[], side = 2): { highs: { i: number; v: number }[]; lows: { i: number; v: number }[] } {
  const highs: { i: number; v: number }[] = [];
  const lows: { i: number; v: number }[] = [];
  for (let i = side; i < candles.length - side; i++) {
    let isH = true;
    let isL = true;
    for (let k = 1; k <= side; k++) {
      if (candles[i].high < candles[i - k].high || candles[i].high < candles[i + k].high) isH = false;
      if (candles[i].low > candles[i - k].low || candles[i].low > candles[i + k].low) isL = false;
    }
    if (isH) highs.push({ i, v: candles[i].high });
    if (isL) lows.push({ i, v: candles[i].low });
  }
  return { highs, lows };
}

/**
 * Destino do movimento (draw on liquidity): o nível oposto mais próximo para lá da entrada.
 * Long → limite inferior da zona de oferta fresca mais próxima acima, ou máximo de swing H4.
 * Short → limite superior da zona de procura fresca mais próxima abaixo, ou mínimo de swing H4.
 */
export function findDrawLevel(
  direction: "long" | "short",
  entry: number,
  zones: HtfZone[],
  swingCandles: Candle[],
  /** Distância mínima à entrada (ex.: rrMin × risco). Níveis mais perto são ignorados. */
  minDistance = 0
): { level: number; source: string } | null {
  const cands: { level: number; source: string }[] = [];
  for (const z of zones) {
    if (z.broken) continue;
    if (direction === "long" && z.direction === "bearish" && z.low > entry) cands.push({ level: z.low, source: z.id });
    if (direction === "short" && z.direction === "bullish" && z.high < entry) cands.push({ level: z.high, source: z.id });
  }
  const { highs, lows } = swingPivots(swingCandles, 2);
  if (direction === "long") {
    for (const h of highs) if (h.v > entry) cands.push({ level: h.v, source: "swing_high" });
  } else {
    for (const l of lows) if (l.v < entry) cands.push({ level: l.v, source: "swing_low" });
  }
  const far = cands.filter((c) => Math.abs(c.level - entry) >= minDistance);
  if (!far.length) return null;
  far.sort((a, b) => Math.abs(a.level - entry) - Math.abs(b.level - entry));
  return far[0];
}
