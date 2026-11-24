/**
 * Deduplicação (a mesma notícia em 3 fontes = 1 alerta) e limite de frequência.
 */
const STOP = new Set(
  "the a an of to in on for and or as at by with from is are was be after amid over says said its it this that new us u.s. will has have than into about".split(" ")
);

export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9$%.\s]/g, " ")
      .split(/\s+/)
      .map((t) => t.replace(/\.$/, ""))
      .filter((t) => t.length > 2 && !STOP.has(t))
  );
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  // Overlap coefficient: apanha o mesmo título reescrito curto vs. longo.
  return inter / Math.min(a.size, b.size);
}

export interface RecentHeadline {
  tokens: Set<string>;
  at: number;
}

export function isDuplicate(title: string, recent: RecentHeadline[], now: number, windowMs = 6 * 3600_000, threshold = 0.6): boolean {
  const tk = titleTokens(title);
  if (tk.size < 3) return recent.some((r) => now - r.at < windowMs && similarity(tk, r.tokens) === 1);
  return recent.some((r) => now - r.at < windowMs && similarity(tk, r.tokens) >= threshold);
}

export interface RateLimitCfg {
  /** Intervalo mínimo entre alertas "warning" do mesmo activo. */
  minGapMs: number;
  /** Máximo de alertas por activo numa hora (critical pode exceder em +2). */
  maxPerHour: number;
}

/** Decide se um alerta pode sair agora. `history` = instantes dos alertas já emitidos para o activo. */
export function allowByRate(history: number[], level: "warning" | "critical", now: number, cfg: RateLimitCfg): boolean {
  const lastHour = history.filter((t) => now - t < 3600_000);
  const cap = level === "critical" ? cfg.maxPerHour + 2 : cfg.maxPerHour;
  if (lastHour.length >= cap) return false;
  if (level === "critical") return true;
  const last = history.length ? Math.max(...history) : -Infinity;
  return now - last >= cfg.minGapMs;
}
