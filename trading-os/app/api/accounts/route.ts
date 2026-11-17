import { NextRequest, NextResponse } from "next/server";
import { initDB } from "@/lib/db";
import { deleteAccount, getEurUsd, listAccounts, upsertAccount } from "@/lib/accounts-db";
import { isAccountKind, parseSymbols } from "@/lib/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Contas (prop firm ou corretora) com capital no servidor + EUR/USD actual. */
export async function GET() {
  await initDB();
  const [accounts, eurusd] = await Promise.all([listAccounts(), getEurUsd()]);
  return NextResponse.json({ accounts, eurusd });
}

/**
 * Cria ou actualiza uma conta:
 * { name, equity?, currency?: "EUR"|"USD", kind?: "prop"|"broker", symbols?: ["XAUUSD"], rename? }.
 * Atribuir um activo a uma conta tira-o da conta onde estava.
 */
export async function PUT(req: NextRequest) {
  await initDB();
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 40) return NextResponse.json({ error: "nome da conta em falta" }, { status: 400 });
  const equity = b.equity === undefined || b.equity === "" || b.equity === null ? undefined : Number(b.equity);
  if (equity !== undefined && (!Number.isFinite(equity) || equity < 0)) {
    return NextResponse.json({ error: "capital inválido" }, { status: 422 });
  }
  if (b.kind !== undefined && !isAccountKind(b.kind)) return NextResponse.json({ error: "tipo tem de ser prop ou broker" }, { status: 422 });
  if (b.currency !== undefined && b.currency !== "EUR" && b.currency !== "USD") {
    return NextResponse.json({ error: "moeda tem de ser EUR ou USD" }, { status: 422 });
  }
  const acct = await upsertAccount(name, {
    equity,
    currency: b.currency as "EUR" | "USD" | undefined,
    kind: isAccountKind(b.kind) ? b.kind : undefined,
    symbols: b.symbols === undefined ? undefined : parseSymbols(b.symbols),
    rename: typeof b.rename === "string" ? b.rename.slice(0, 40) : undefined,
  });
  if (!acct) return NextResponse.json({ error: "já existe uma conta com esse nome" }, { status: 409 });
  return NextResponse.json({ account: acct, accounts: await listAccounts() });
}

/** Apaga uma conta: ?name=… */
export async function DELETE(req: NextRequest) {
  await initDB();
  const name = new URL(req.url).searchParams.get("name") || "";
  if (!name) return NextResponse.json({ error: "nome da conta em falta" }, { status: 400 });
  const ok = await deleteAccount(name);
  return NextResponse.json({ ok, accounts: await listAccounts() }, { status: ok ? 200 : 404 });
}
