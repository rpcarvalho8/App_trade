import { NextRequest, NextResponse } from "next/server";
import { initDB } from "@/lib/db";
import { getEurUsd, listAccounts, updateAccount } from "@/lib/accounts-db";
import type { Broker } from "@/lib/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Contas por corretora (capital no servidor) + EUR/USD actual. */
export async function GET() {
  await initDB();
  const [accounts, eurusd] = await Promise.all([listAccounts(), getEurUsd()]);
  return NextResponse.json({ accounts, eurusd });
}

/** Actualiza o capital e/ou a moeda de uma conta: { broker: "XTB" | "Kraken", equity?, currency? }. */
export async function PUT(req: NextRequest) {
  await initDB();
  const b = (await req.json().catch(() => ({}))) as { broker?: string; equity?: unknown; currency?: string };
  if (b.broker !== "XTB" && b.broker !== "Kraken") {
    return NextResponse.json({ error: "broker tem de ser XTB ou Kraken" }, { status: 400 });
  }
  const equity = b.equity === undefined || b.equity === "" ? undefined : Number(b.equity);
  if (equity !== undefined && (!Number.isFinite(equity) || equity < 0)) {
    return NextResponse.json({ error: "capital inválido" }, { status: 422 });
  }
  const acct = await updateAccount(b.broker as Broker, {
    equity,
    currency: b.currency === "EUR" || b.currency === "USD" ? b.currency : undefined,
  });
  return NextResponse.json({ account: acct });
}
