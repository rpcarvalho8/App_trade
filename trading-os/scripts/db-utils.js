#!/usr/bin/env node
/**
 * Utilitário de backup/restauro para a base de dados local 'trading.db'.
 *
 * Como o 'trading.db' está ignorado no Git (dados sensíveis), nunca sincroniza
 * entre máquinas. Este script permite guardar e recuperar cópias locais.
 *
 * Uso (a partir da pasta 'trading-os/'):
 *   node scripts/db-utils.js --backup    -> cria backups/trading_backup_YYYYMMDD_HHmmss.db
 *   node scripts/db-utils.js --restore   -> restaura o backup mais recente para trading.db
 *
 * Ou via npm:
 *   npm run db:backup
 *   npm run db:restore
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@libsql/client");

const ROOT = process.cwd();
const DB_PATH = path.join(ROOT, "trading.db");
const BACKUP_DIR = path.join(ROOT, "backups");
const PREFIX = "trading_backup_";
const EXT = ".db";

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith(EXT))
    .map((f) => ({ name: f, full: path.join(BACKUP_DIR, f) }))
    .sort((a, b) => b.name.localeCompare(a.name)); // mais recente primeiro (nome ordenável)
}

/**
 * A app usa SQLite em modo WAL: as escritas recentes vivem em trading.db-wal até ao checkpoint.
 * Copiar só o trading.db perdia-as; VACUUM INTO tira uma cópia consistente mesmo com a app a correr.
 */
async function snapshot(dest) {
  const db = createClient({ url: `file:${DB_PATH}` });
  try {
    await db.execute({ sql: "VACUUM INTO ?", args: [dest] });
  } finally {
    db.close();
  }
}

/** Ficheiros WAL antigos aplicados sobre uma DB restaurada corrompem-na: apagam-se. */
function removeWalFiles() {
  for (const ext of ["-wal", "-shm"]) {
    const f = DB_PATH + ext;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

async function backup() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(
      `[db:backup] ERRO: 'trading.db' não encontrado em ${DB_PATH}.\n` +
        `Confirma que corres o comando dentro da pasta 'trading-os/'.`
    );
    process.exit(1);
  }
  const size = fs.statSync(DB_PATH).size;
  if (size === 0) {
    console.error(
      `[db:backup] ERRO: 'trading.db' tem 0 bytes (vazio). Backup cancelado ` +
        `para não sobrescrever cópias válidas com uma DB vazia.`
    );
    process.exit(1);
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dest = path.join(BACKUP_DIR, `${PREFIX}${timestamp()}${EXT}`);
  await snapshot(dest);
  console.log(
    `[db:backup] OK: cópia criada -> ${path.relative(ROOT, dest)} (${humanSize(fs.statSync(dest).size)})`
  );
  const all = listBackups();
  console.log(`[db:backup] Total de backups guardados: ${all.length}`);
}

async function restore() {
  const backups = listBackups();
  if (backups.length === 0) {
    console.error(
      `[db:restore] ERRO: nenhum backup encontrado em ${BACKUP_DIR}.\n` +
        `Cria um primeiro com: npm run db:backup`
    );
    process.exit(1);
  }
  const latest = backups[0];
  const size = fs.statSync(latest.full).size;

  // Segurança: guarda a DB atual antes de a substituir (se existir e não estiver vazia).
  if (fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 0) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const safety = path.join(BACKUP_DIR, `${PREFIX}pre-restore_${timestamp()}${EXT}`);
    await snapshot(safety);
    console.log(
      `[db:restore] DB atual salvaguardada em -> ${path.relative(ROOT, safety)}`
    );
  }

  console.log("[db:restore] Pára a app (npm run dev) antes de restaurar.");
  removeWalFiles();
  fs.copyFileSync(latest.full, DB_PATH);
  console.log(
    `[db:restore] OK: restaurado ${latest.name} (${humanSize(size)}) -> trading.db`
  );
  console.log(
    `[db:restore] Reinicia o servidor a partir de 'trading-os/' e faz hard refresh (Ctrl+Shift+R).`
  );
}

function main() {
  const args = process.argv.slice(2);
  const fail = (e) => {
    console.error("[db-utils] ERRO:", e?.message || e);
    process.exit(1);
  };
  if (args.includes("--backup")) return backup().catch(fail);
  if (args.includes("--restore")) return restore().catch(fail);
  console.log(
    `Uso:\n` +
      `  node scripts/db-utils.js --backup    Criar cópia de segurança do trading.db\n` +
      `  node scripts/db-utils.js --restore   Restaurar o backup mais recente\n\n` +
      `Ou via npm: npm run db:backup | npm run db:restore`
  );
  process.exit(1);
}

main();
