/**
 * Base de conhecimento (RAG leve): indexa notas .md em SQLite (tabela kb_chunks) e pesquisa com BM25.
 *
 * Fontes:
 *  - knowledge/ no repositório (notas curadas + guia de estudo) — sempre.
 *  - KNOWLEDGE_DIRS no .env.local (separadas por vírgula), ex.: o vault Obsidian completo
 *    com os Daily Report Cards. Os DRC vazios (templates) são ignorados.
 *
 * Reindexar: POST /api/knowledge (ou automaticamente na primeira pesquisa com a tabela vazia).
 */
import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { db, initDB } from "@/lib/db";
import { bm25Search, markdownToChunks, type KbChunk, type KbKind } from "./kb-text";

const MAX_FILE_BYTES = 400 * 1024;
const SKIP_DIRS = new Set([".obsidian", ".git", "node_modules", ".trash"]);

export interface KbHit extends KbChunk {
  id: number;
  score: number;
}

let cache: (KbChunk & { id: number })[] | null = null;

export function knowledgeDirs(): string[] {
  const extra = (process.env.KNOWLEDGE_DIRS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [path.join(process.cwd(), "knowledge"), ...extra];
}

async function ensureTable(): Promise<void> {
  await initDB();
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS kb_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      text TEXT NOT NULL,
      images TEXT DEFAULT '[]',
      indexed_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_kb_chunks_source ON kb_chunks(source);
  `);
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && SKIP_DIRS.has(e.name)) continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.isFile() && /\.md$/i.test(e.name)) out.push(p);
  }
  return out;
}

function kindFor(rel: string): KbKind {
  return /guia-estudo/i.test(rel) ? "guide" : "note";
}

/** Reconstrói o índice a partir dos ficheiros. Devolve contagens para a UI/diagnóstico. */
export async function reindexKnowledge(): Promise<{ files: number; chunks: number; drc: number; skipped: number; dirs: string[] }> {
  await ensureTable();
  const dirs = knowledgeDirs();
  const chunks: KbChunk[] = [];
  let files = 0;
  let skipped = 0;
  for (const dir of dirs) {
    for (const file of await walk(dir)) {
      const st = await stat(file).catch(() => null);
      if (!st || st.size > MAX_FILE_BYTES) {
        skipped++;
        continue;
      }
      const rel = `${path.basename(dir)}/${path.relative(dir, file).split(path.sep).join("/")}`;
      const md = await readFile(file, "utf8").catch(() => "");
      const c = markdownToChunks(rel, md, kindFor(rel));
      if (!c.length) skipped++;
      else files++;
      chunks.push(...c);
    }
  }
  await db.execute("DELETE FROM kb_chunks");
  for (const c of chunks) {
    await db.execute({
      sql: "INSERT INTO kb_chunks (source, title, kind, tags, text, images) VALUES (?,?,?,?,?,?)",
      args: [c.source, c.title, c.kind, JSON.stringify(c.tags), c.text, JSON.stringify(c.images)],
    });
  }
  cache = null;
  return { files, chunks: chunks.length, drc: chunks.filter((c) => c.kind === "drc").length, skipped, dirs };
}

async function loadAll(): Promise<(KbChunk & { id: number })[]> {
  if (cache) return cache;
  await ensureTable();
  let r = await db.execute("SELECT id, source, title, kind, tags, text, images FROM kb_chunks");
  if (!r.rows.length) {
    await reindexKnowledge();
    r = await db.execute("SELECT id, source, title, kind, tags, text, images FROM kb_chunks");
  }
  cache = (r.rows as unknown as Record<string, unknown>[]).map((row) => ({
    id: Number(row.id),
    source: String(row.source),
    title: String(row.title),
    kind: row.kind as KbKind,
    tags: JSON.parse(String(row.tags || "[]")),
    text: String(row.text),
    images: JSON.parse(String(row.images || "[]")),
  }));
  return cache;
}

/**
 * Pesquisa na base. `boostTags` favorece metodologias/activo (ex.: ["wyckoff","xauusd"]).
 * Garante diversidade: no máximo 2 chunks do mesmo ficheiro.
 */
export async function searchKnowledge(query: string, opts: { limit?: number; boostTags?: string[] } = {}): Promise<KbHit[]> {
  const all = await loadAll();
  const raw = bm25Search(all, query, { limit: (opts.limit ?? 6) * 3, boostTags: opts.boostTags });
  const perSource = new Map<string, number>();
  const out: KbHit[] = [];
  for (const { item, score } of raw) {
    const n = perSource.get(item.source) || 0;
    if (n >= 2) continue;
    perSource.set(item.source, n + 1);
    out.push({ ...item, score: Math.round(score * 100) / 100 });
    if (out.length >= (opts.limit ?? 6)) break;
  }
  return out;
}

export async function knowledgeStats(): Promise<{ chunks: number; bySource: number; byKind: Record<string, number> }> {
  const all = await loadAll();
  const byKind: Record<string, number> = {};
  for (const c of all) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
  return { chunks: all.length, bySource: new Set(all.map((c) => c.source)).size, byKind };
}
