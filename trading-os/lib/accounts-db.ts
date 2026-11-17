/**
 * Contas por corretora guardadas no servidor (SQLite) e câmbio EUR/USD automático.
 */
import { db, getSetting, setSetting } from "@/lib/db";
import { brokerForSymbol, nextPeak, usdPerAccountUnit, type Account, type AccountCurrency, type Broker } from "@/lib/accounts";

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

export async function listAccounts(): Promise<Account[]> {
  const r = await db.execute("SELECT broker, currency, equity, peak_equity, updated_at FROM accounts ORDER BY broker DESC");
  return (r.rows as unknown as Account[]).map((a) => ({
    ...a,
    equity: Number(a.equity) || 0,
    peak_equity: Number(a.peak_equity) || 0,
  }));
}

export async function updateAccount(broker: Broker, patch: { equity?: number; currency?: AccountCurrency }): Promise<Account | null> {
  const cur = (await listAccounts()).find((a) => a.broker === broker);
  if (!cur) return null;
  const equity = patch.equity != null && Number.isFinite(patch.equity) && patch.equity >= 0 ? patch.equity : cur.equity;
  const currency = patch.currency === "EUR" || patch.currency === "USD" ? patch.currency : cur.currency;
  const peak = nextPeak(cur.peak_equity, equity);
  await db.execute({
    sql: "UPDATE accounts SET equity=?, currency=?, peak_equity=?, updated_at=datetime('now') WHERE broker=?",
    args: [equity, currency, peak, broker],
  });
  return { ...cur, equity, currency, peak_equity: peak };
}

/** Conta + câmbio para o activo (ouro → XTB, SOL → Kraken). */
export async function accountForSymbol(symbol: string): Promise<{ equity: number | null; usdPerAccountUnit: number; account: Account | null }> {
  const broker = brokerForSymbol(symbol);
  const acct = broker ? (await listAccounts()).find((a) => a.broker === broker) ?? null : null;
  const eurusd = acct?.currency === "EUR" ? await getEurUsd() : null;
  return {
    equity: acct && acct.equity > 0 ? acct.equity : null,
    usdPerAccountUnit: usdPerAccountUnit(acct?.currency, eurusd),
    account: acct,
  };
}
