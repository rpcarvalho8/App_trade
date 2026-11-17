/**
 * Contas (prop firm ou corretora) guardadas no servidor (SQLite) e câmbio EUR/USD automático.
 */
import { db, getSetting, setSetting } from "@/lib/db";
import { propDay, rollDayStart, type MaxDdType, type PropRules } from "@/lib/prop-rules";
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
    `SELECT name, kind, currency, symbols, equity, peak_equity, updated_at, start_balance, daily_dd_pct, max_dd_pct,
            max_dd_type, profit_target_pct, day_start_equity, day_start_date, reset_hour_utc, phase
     FROM trade_accounts ORDER BY kind DESC, name`
  );
  return (r.rows as unknown as Row[]).map((a) => ({
    name: String(a.name),
    kind: isAccountKind(a.kind) ? a.kind : "broker",
    currency: a.currency === "EUR" ? "EUR" : "USD",
    symbols: parseSymbols(a.symbols),
    equity: Number(a.equity) || 0,
    peak_equity: Number(a.peak_equity) || 0,
    updated_at: a.updated_at,
    start_balance: numOrNull(a.start_balance),
    daily_dd_pct: numOrNull(a.daily_dd_pct),
    max_dd_pct: numOrNull(a.max_dd_pct),
    max_dd_type: a.max_dd_type === "trailing" ? "trailing" : "static",
    profit_target_pct: numOrNull(a.profit_target_pct),
    day_start_equity: numOrNull(a.day_start_equity),
    day_start_date: a.day_start_date ? String(a.day_start_date) : null,
    reset_hour_utc: Number.isFinite(Number(a.reset_hour_utc)) && a.reset_hour_utc != null ? Number(a.reset_hour_utc) : 22,
    phase: a.phase ? String(a.phase) : null,
  }));
}

const numOrNull = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Regras de prop firm editáveis (null limpa o campo). */
export type RulesPatch = Partial<Omit<PropRules, "day_start_date">>;
const RULE_FIELDS = [
  "start_balance",
  "daily_dd_pct",
  "max_dd_pct",
  "max_dd_type",
  "profit_target_pct",
  "day_start_equity",
  "reset_hour_utc",
  "phase",
] as const;

export interface AccountPatch {
  equity?: number;
  currency?: AccountCurrency;
  kind?: AccountKind;
  symbols?: string[];
  /** Novo nome (renomear). */
  rename?: string;
  rules?: RulesPatch;
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
  await applyRules(newName, cur ?? null, equity, patch.rules);
  return (await listAccounts()).find((a) => a.name === newName) ?? null;
}

/**
 * Regras + início do dia. Se o equity mudou num dia novo, o início do dia passa a ser o equity anterior;
 * um day_start_equity explícito (copiado do dashboard da prop firm) vale para o dia de hoje.
 */
async function applyRules(name: string, cur: Account | null, equity: number, rules: RulesPatch | undefined): Promise<void> {
  const now = Date.now();
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  const reset = rules?.reset_hour_utc ?? cur?.reset_hour_utc ?? 22;
  if (rules) {
    for (const f of RULE_FIELDS) {
      if (!(f in rules)) continue;
      let v = rules[f] as unknown;
      if (f === "max_dd_type") v = v === "trailing" ? "trailing" : "static";
      else if (f === "phase") v = v == null || v === "" ? null : String(v).slice(0, 40);
      else v = numOrNull(v);
      sets.push(`${f}=?`);
      args.push(v as string | number | null);
    }
    if ("day_start_equity" in rules) {
      sets.push("day_start_date=?");
      args.push(propDay(now, reset));
    }
  }
  if (cur && equity !== cur.equity && !(rules && "day_start_equity" in rules)) {
    const roll = rollDayStart(
      { equity: cur.equity, day_start_equity: cur.day_start_equity ?? null, day_start_date: cur.day_start_date ?? null, reset_hour_utc: reset },
      now
    );
    if (roll.day_start_date !== cur.day_start_date || roll.day_start_equity !== cur.day_start_equity) {
      sets.push("day_start_equity=?", "day_start_date=?");
      args.push(roll.day_start_equity, roll.day_start_date);
    }
  }
  if (!sets.length) return;
  await db.execute({ sql: `UPDATE trade_accounts SET ${sets.join(", ")} WHERE name=?`, args: [...args, name] });
}

export type { MaxDdType };

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
