/**
 * Contas (prop firm ou corretora) guardadas no servidor (SQLite) e câmbio EUR/USD automático.
 */
import { db, getSetting, setSetting } from "@/lib/db";
import { accountForSymbolIn, isAccountKind, nextPeak, parseSymbols, usdPerAccountUnit, type Account, type AccountCurrency, type AccountKind } from "@/lib/accounts";

const FX_TTL_MS = 60 * 60_000;

/** EUR/USD (USD por 1 EUR), Frankfurter/BCE, com cache de 1 h em settings. Último valor se a fonte falhar. */
export async function getEurUsd(): Promise<number | null> {
  const cached = Number(await getSetting("fx_eurusd").catch(() => null));
  const at = Number(await getSetting("fx_eurusd_at").catch(() => null));
  if (cached > 0 && Date.now() - at < FX_TTL_MS) return cached;
  try {
    const r = await fetch("https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { rates?: { USD?: number } };
    const rate = Number(j?.rates?.USD);
    if (rate > 0) {
      await setSetting("fx_eurusd", String(rate));
      await setSetting("fx_eurusd_at", String(Date.now()));
      return rate;
    }
  } catch {
    /* fonte em baixo: usa o último valor conhecido */
  }
  return cached > 0 ? cached : null;
}

type Row = Omit<Account, "symbols"> & { symbols: string };

export async function listAccounts(): Promise<Account[]> {
  const r = await db.execute(
    "SELECT name, kind, currency, symbols, equity, peak_equity, updated_at FROM trade_accounts ORDER BY kind DESC, name"
  );
  return (r.rows as unknown as Row[]).map((a) => ({
    name: String(a.name),
    kind: isAccountKind(a.kind) ? a.kind : "broker",
    currency: a.currency === "EUR" ? "EUR" : "USD",
    symbols: parseSymbols(a.symbols),
    equity: Number(a.equity) || 0,
    peak_equity: Number(a.peak_equity) || 0,
    updated_at: a.updated_at,
  }));
}

export interface AccountPatch {
  equity?: number;
  currency?: AccountCurrency;
  kind?: AccountKind;
  symbols?: string[];
  /** Novo nome (renomear). */
  rename?: string;
}

/** Cada activo pertence a uma só conta: tira-o das outras. */
async function releaseSymbols(symbols: string[], except: string): Promise<void> {
  if (!symbols.length) return;
  for (const a of await listAccounts()) {
    if (a.name === except) continue;
    const left = a.symbols.filter((s) => !symbols.includes(s));
    if (left.length !== a.symbols.length) {
      await db.execute({ sql: "UPDATE trade_accounts SET symbols=? WHERE name=?", args: [left.join(","), a.name] });
    }
  }
}

/** Cria a conta se não existir; senão actualiza. O pico de capital nunca desce. */
export async function upsertAccount(name: string, patch: AccountPatch): Promise<Account | null> {
  const nm = name.trim();
  if (!nm) return null;
  const cur = (await listAccounts()).find((a) => a.name === nm);
  const newName = patch.rename?.trim() || nm;
  if (newName !== nm && (await listAccounts()).some((a) => a.name === newName)) return null;
  const equity = patch.equity != null && Number.isFinite(patch.equity) && patch.equity >= 0 ? patch.equity : cur?.equity ?? 0;
  const currency = patch.currency === "EUR" || patch.currency === "USD" ? patch.currency : cur?.currency ?? "USD";
  const kind = isAccountKind(patch.kind) ? patch.kind : cur?.kind ?? "broker";
  const symbols = patch.symbols ? parseSymbols(patch.symbols) : cur?.symbols ?? [];
  const peak = nextPeak(cur?.peak_equity, equity);
  if (cur) {
    await db.execute({
      sql: "UPDATE trade_accounts SET name=?, kind=?, currency=?, symbols=?, equity=?, peak_equity=?, updated_at=datetime('now') WHERE name=?",
      args: [newName, kind, currency, symbols.join(","), equity, peak, nm],
    });
  } else {
    await db.execute({
      sql: "INSERT INTO trade_accounts (name, kind, currency, symbols, equity, peak_equity) VALUES (?,?,?,?,?,?)",
      args: [newName, kind, currency, symbols.join(","), equity, peak],
    });
  }
  if (patch.symbols) await releaseSymbols(symbols, newName);
  return { name: newName, kind, currency, symbols, equity, peak_equity: peak };
}

export async function deleteAccount(name: string): Promise<boolean> {
  const r = await db.execute({ sql: "DELETE FROM trade_accounts WHERE name=?", args: [name] });
  return r.rowsAffected > 0;
}

/** Conta a que o activo está atribuído + câmbio para o cálculo do lote. */
export async function accountForSymbol(symbol: string): Promise<{ equity: number | null; usdPerAccountUnit: number; account: Account | null }> {
  const acct = accountForSymbolIn(await listAccounts(), symbol);
  const eurusd = acct?.currency === "EUR" ? await getEurUsd() : null;
  return {
    equity: acct && acct.equity > 0 ? acct.equity : null,
    usdPerAccountUnit: usdPerAccountUnit(acct?.currency, eurusd),
    account: acct,
  };
}
