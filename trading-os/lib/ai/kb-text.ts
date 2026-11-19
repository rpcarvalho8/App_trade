/**
 * Texto da base de conhecimento: limpeza de notas Obsidian, chunking por cabeçalhos,
 * extração de Daily Report Cards e pesquisa lexical BM25. Funções puras (testáveis).
 *
 * Porquê BM25 e não embeddings: a base tem dezenas de notas curtas em PT/EN com vocabulário
 * técnico muito específico (CHoCH, UTAD, FVG, Spring). Para este tamanho a pesquisa lexical
 * com sinónimos acerta tanto como embeddings, não custa chamadas à API e corre no SQLite local.
 * Quando passar de ~2000 chunks (ex.: livros convertidos), ver docs/ia/01-arquitetura.md (fase 2).
 */

export type KbKind = "note" | "drc" | "guide";

export interface KbChunk {
  source: string;
  title: string;
  kind: KbKind;
  tags: string[];
  text: string;
  /** Imagens referidas na nota (![[x.png]]), para mostrar ou enviar como referência visual. */
  images: string[];
}

const TAG_RULES: Record<string, RegExp> = {
  wyckoff: /wyckoff|acumula|distribui|reacumula|redistribui|spring|utad|\bsos\b|\blps\b|selling climax|causa e efeito|fase [a-e]\b|força e debilidade/i,
  elliott: /elliott|onda|impuls|zigzag|flat|triângulo|triangulo|correç|correc|w-x-y/i,
  smc: /\bsmc\b|order block|\bob\b|fvg|fair value|choch|bos\b|mss|premium|discount|desconto|prémio|imbalance/i,
  liquidez: /liquidez|liquidity|sweep|stop hunt|bsl|ssl|fundos? válid|equal (highs|lows)|oferta|procura|demanda|supply|demand/i,
  padroes: /flag|pennant|wedge|triângulo simétrico|symmetrical|flagpole|reteste|rompimento|breakout/i,
  volume: /volume/i,
  risco: /risco|stop loss|\bsl\b|take profit|break.?even|lote|drawdown|r:r|risk/i,
  macro: /macro|business cycle|inflação|recess|fed|cpi|nfp|fomc|yields?/i,
  rotina: /playbook|report card|journal|revisão|rotina/i,
  xauusd: /xau|ouro|gold/i,
  solusd: /\bsol\b|solana|funding|liquidaç|open interest|perp/i,
};

export function tagText(text: string): string[] {
  return Object.entries(TAG_RULES).filter(([, re]) => re.test(text)).map(([t]) => t);
}

export function stripFrontmatter(md: string): { body: string; fm: Record<string, string> } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { body: md, fm: {} };
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w ]+):\s*(.*)$/);
    if (kv) fm[kv[1].trim().toLowerCase()] = kv[2].trim();
  }
  return { body: md.slice(m[0].length), fm };
}

export function extractImages(md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(/!\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]/g)) out.add(m[1].trim());
  for (const m of md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) out.add(m[1].trim());
  return [...out];
}

/** Remove sintaxe Obsidian que só faz ruído no prompt. */
export function cleanObsidian(md: string): string {
  return md
    .replace(/!\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]/g, "(imagem: $1)")
    .replace(/\[\[([^\]|]+?)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isDailyReportCard(md: string): boolean {
  return /WHAT I LEARNED/i.test(md) && /Daily Report Card/i.test(md);
}

/**
 * Extrai o que um Daily Report Card PREENCHIDO ensina: aprendizagens, mudanças, overview
 * e as trades registadas. Devolve null para templates vazios (a maioria do vault atual).
 */
export function extractDailyReportCard(md: string): string | null {
  const { body, fm } = stripFrontmatter(md);
  const labels = ["WHAT I LEARNED / IMPROVED UPON TODAY", "CHANGES I NEED TO MAKE FROM TODAY", "OVERVIEW", "EASIEST 100€"];
  const parts: string[] = [];
  for (let i = 0; i < labels.length; i++) {
    const start = body.indexOf(labels[i] + ":");
    if (start < 0) continue;
    const from = start + labels[i].length + 1;
    const ends = labels.slice(i + 1).map((l) => body.indexOf(l + ":", from)).filter((n) => n > 0);
    const tableAt = body.indexOf("\n|", from);
    const end = Math.min(...[...ends, tableAt > 0 ? tableAt : body.length]);
    const txt = body.slice(from, end).trim();
    if (txt) parts.push(`${labels[i]}: ${txt}`);
  }
  // Tabelas: linhas com pelo menos 2 células preenchidas (ignora cabeçalhos e separadores).
  const rows = body
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith("|") && !/^\|\s*-/.test(l.trim()))
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()))
    .filter((cells) => cells.filter(Boolean).length >= 2 && !cells.some((c) => /^\*\*.*\*\*$|^Name$|^Time$/.test(c)));
  if (rows.length) parts.push("TRADES/SEGMENTOS:\n" + rows.map((r) => "- " + r.join(" | ")).join("\n"));
  if (!parts.length) return null;
  const head = [fm.date && `Data: ${fm.date}`, fm.grade && `Nota: ${fm.grade}`, fm.goal && `Objetivo: ${fm.goal}`].filter(Boolean).join(" · ");
  return (head ? head + "\n" : "") + parts.join("\n\n");
}

/** Divide por cabeçalhos (#..###) e depois por tamanho, sem cortar parágrafos. */
export function chunkMarkdown(md: string, maxChars = 1400): { heading: string; text: string }[] {
  const sections: { heading: string; text: string }[] = [];
  let heading = "";
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text.length > 20) sections.push({ heading, text });
    buf = [];
  };
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flush();
      heading = h[2].trim();
      buf.push(line);
    } else buf.push(line);
  }
  flush();

  const out: { heading: string; text: string }[] = [];
  for (const s of sections) {
    if (s.text.length <= maxChars) {
      out.push(s);
      continue;
    }
    let cur = "";
    for (const para of s.text.split(/\n\s*\n/)) {
      if (cur && cur.length + para.length + 2 > maxChars) {
        out.push({ heading: s.heading, text: cur.trim() });
        cur = s.heading ? `(${s.heading}, cont.)\n` : "";
      }
      cur += para + "\n\n";
    }
    if (cur.trim()) out.push({ heading: s.heading, text: cur.trim() });
  }
  return out;
}

/** Converte um ficheiro .md em chunks prontos a indexar. */
export function markdownToChunks(source: string, md: string, kind: KbKind = "note"): KbChunk[] {
  const baseTitle = source.split("/").pop()!.replace(/\.md$/i, "").replace(/[-_]/g, " ");
  if (isDailyReportCard(md)) {
    const drc = extractDailyReportCard(md);
    if (!drc) return [];
    return [{ source, title: `Daily Report Card ${baseTitle}`, kind: "drc", tags: ["rotina", ...tagText(drc)], text: drc, images: [] }];
  }
  const { body } = stripFrontmatter(md);
  const images = extractImages(body);
  const clean = cleanObsidian(body);
  if (clean.replace(/\(imagem: [^)]+\)/g, "").trim().length < 30) return [];
  return chunkMarkdown(clean).map((c) => ({
    source,
    title: c.heading ? `${baseTitle} — ${c.heading}` : baseTitle,
    kind,
    // Etiquetas do caminho só para metodologia (o nome do guia contém "xau"/"sol" e marcaria tudo).
    tags: [...new Set([...tagText(source).filter((t) => t !== "xauusd" && t !== "solusd"), ...tagText(c.text)])],
    text: c.text,
    images: images.filter((img) => c.text.includes(img)),
  }));
}

// ---------- Pesquisa BM25 ----------

const STOP = new Set(
  "a o os as de da do das dos e em no na nos nas um uma uns umas para por com sem que se ao à às é ser são foi como mais menos mas ou the of and to in is for on with at by an be this that it are or from as".split(" ")
);

/** Sinónimos PT/EN e abreviaturas: expandem a consulta, não o índice. */
const SYNONYMS: Record<string, string[]> = {
  ob: ["order", "block"],
  fvg: ["fair", "value", "gap", "imbalance"],
  choch: ["change", "character", "mudanca", "caracter"],
  mss: ["choch", "estrutura", "structure"],
  bos: ["break", "structure", "quebra", "estrutura"],
  liquidez: ["liquidity", "sweep"],
  liquidity: ["liquidez"],
  oferta: ["supply", "demanda"],
  procura: ["demand", "demanda"],
  acumulacao: ["accumulation", "spring", "reacumulacao"],
  distribuicao: ["distribution", "utad", "redistribuicao"],
  ondas: ["elliott", "onda"],
  onda: ["elliott"],
  bandeira: ["flag"],
  cunha: ["wedge"],
  volume: ["volume", "esforco"],
  fundo: ["fundos", "validos"],
  reteste: ["rompimento", "retest"],
};

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function expandQuery(q: string): string[] {
  const toks = tokenize(q);
  const out = [...toks];
  for (const t of toks) for (const s of SYNONYMS[t] || []) out.push(...tokenize(s));
  return [...new Set(out)];
}

export interface Scored<T> {
  item: T;
  score: number;
}

/** BM25 (k1=1.4, b=0.75) sobre título + tags + texto. Bónus para tags pedidas explicitamente. */
export function bm25Search<T extends { title: string; text: string; tags: string[] }>(
  docs: T[],
  query: string,
  opts: { limit?: number; boostTags?: string[] } = {}
): Scored<T>[] {
  const q = expandQuery(query);
  if (!docs.length || !q.length) return [];
  const toks = docs.map((d) => tokenize(`${d.title} ${d.title} ${d.tags.join(" ")} ${d.text}`));
  const avg = toks.reduce((s, t) => s + t.length, 0) / toks.length;
  const df = new Map<string, number>();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) || 0) + 1);
  const N = docs.length;
  const k1 = 1.4;
  const b = 0.75;
  const boost = new Set(opts.boostTags || []);

  const scored = docs.map((item, i) => {
    const tf = new Map<string, number>();
    for (const w of toks[i]) tf.set(w, (tf.get(w) || 0) + 1);
    let score = 0;
    for (const w of q) {
      const f = tf.get(w);
      if (!f) continue;
      const n = df.get(w) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * toks[i].length) / avg)));
    }
    const tagHits = item.tags.filter((t) => boost.has(t)).length;
    if (score > 0) score *= 1 + 0.15 * tagHits;
    return { item, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 6);
}
