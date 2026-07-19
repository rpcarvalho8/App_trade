import { NextRequest, NextResponse } from "next/server";
import { initDB, db } from "@/lib/db";

// Exchange API integrations — read-only (positions, closed trades)
// Supports: Bybit, Binance, Kraken (XTB has no public API for retail)

async function fetchBybit(apiKey: string, apiSecret: string) {
  const crypto = await import("crypto");
  const ts = Date.now().toString();
  const recv = "5000";
  const params = `category=linear&limit=50`;
  const sign_str = ts + apiKey + recv + params;
  const sig = crypto.createHmac("sha256", apiSecret).update(sign_str).digest("hex");
  const url = `https://api.bybit.com/v5/execution/list?${params}`;
  const res = await fetch(url, { headers: { "X-BAPI-API-KEY":apiKey,"X-BAPI-TIMESTAMP":ts,"X-BAPI-RECV-WINDOW":recv,"X-BAPI-SIGN":sig } });
  const data = await res.json();
  if (data.retCode !== 0) throw new Error(data.retMsg);
  return (data.result?.list || []).map((t: any) => ({
    exchange: "Bybit",
    pair: t.symbol.replace("USDT","/USDT"),
    direction: t.side === "Buy" ? "LONG" : "SHORT",
    entry: parseFloat(t.execPrice),
    pnl: parseFloat(t.closedPnl || "0"),
    qty: parseFloat(t.execQty),
    date: new Date(parseInt(t.execTime)).toISOString().slice(0,10),
    fee: parseFloat(t.execFee || "0"),
    order_id: t.orderId,
  }));
}

async function fetchBinance(apiKey: string, apiSecret: string) {
  const crypto = await import("crypto");
  const ts = Date.now();
  const params = `limit=50&timestamp=${ts}`;
  const sig = crypto.createHmac("sha256", apiSecret).update(params).digest("hex");
  const url = `https://fapi.binance.com/fapi/v1/userTrades?${params}&signature=${sig}`;
  const res = await fetch(url, { headers: { "X-MBX-APIKEY": apiKey } });
  if (!res.ok) throw new Error(`Binance error: ${res.status}`);
  const data = await res.json();
  if (data.code) throw new Error(data.msg);
  return data.slice(0,50).map((t: any) => ({
    exchange: "Binance",
    pair: t.symbol.replace("USDT","/USDT"),
    direction: t.buyer ? "LONG" : "SHORT",
    entry: parseFloat(t.price),
    pnl: parseFloat(t.realizedPnl || "0"),
    qty: parseFloat(t.qty),
    date: new Date(t.time).toISOString().slice(0,10),
    fee: parseFloat(t.commission || "0"),
    order_id: t.id.toString(),
  }));
}

async function fetchKraken(apiKey: string, apiSecret: string) {
  const crypto = await import("crypto");
  const nonce = Date.now().toString();
  const body = `nonce=${nonce}&trades=true`;
  const path = "/0/private/TradesHistory";
  const sha256 = crypto.createHash("sha256").update(nonce + body).digest();
  const hmac = crypto.createHmac("sha512", Buffer.from(apiSecret, "base64")).update(Buffer.concat([Buffer.from(path), sha256])).digest("base64");
  const res = await fetch(`https://api.kraken.com${path}`, {
    method: "POST", body,
    headers: { "API-Key": apiKey, "API-Sign": hmac, "Content-Type": "application/x-www-form-urlencoded" }
  });
  const data = await res.json();
  if (data.error?.length) throw new Error(data.error.join(", "));
  const trades = Object.values(data.result?.trades || {}) as any[];
  return trades.slice(0,50).map((t: any) => ({
    exchange: "Kraken",
    pair: t.pair,
    direction: t.type === "buy" ? "LONG" : "SHORT",
    entry: parseFloat(t.price),
    pnl: parseFloat(t.net || "0"),
    qty: parseFloat(t.vol),
    date: new Date(t.time * 1000).toISOString().slice(0,10),
    fee: parseFloat(t.fee || "0"),
    order_id: t.ordertxid,
  }));
}

export async function POST(req: NextRequest) {
  await initDB();
  const { exchange, apiKey, apiSecret, action } = await req.json();
  
  if (action === "test") {
    // Just verify connection
    try {
      if (exchange === "bybit") await fetchBybit(apiKey, apiSecret);
      else if (exchange === "binance") await fetchBinance(apiKey, apiSecret);
      else if (exchange === "kraken") await fetchKraken(apiKey, apiSecret);
      else return NextResponse.json({ ok: false, error: "Exchange não suportada" });
      return NextResponse.json({ ok: true, message: `${exchange} conectado com sucesso` });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message });
    }
  }

  if (action === "import") {
    try {
      let rawTrades: any[] = [];
      if (exchange === "bybit") rawTrades = await fetchBybit(apiKey, apiSecret);
      else if (exchange === "binance") rawTrades = await fetchBinance(apiKey, apiSecret);
      else if (exchange === "kraken") rawTrades = await fetchKraken(apiKey, apiSecret);
      else return NextResponse.json({ ok: false, error: "Exchange não suportada" });

      let imported = 0;
      for (const t of rawTrades) {
        // Check if already imported by order_id
        const exists = await db.execute({ sql: "SELECT id FROM trades WHERE tags LIKE ?", args: [`%order:${t.order_id}%`] });
        if (exists.rows.length > 0) continue;
        await db.execute({
          sql: `INSERT INTO trades (date,pair,direction,setup,session,entry,pnl,risk_percent,outcome,notes,tags,followed_plan,mental_state) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          args: [
            t.date, t.pair, t.direction,
            "A definir", "NY",
            t.entry, t.pnl,
            1,
            t.pnl > 0 ? "WIN" : t.pnl < 0 ? "LOSS" : "BE",
            `Importado de ${t.exchange}. Fee: $${t.fee.toFixed(2)}`,
            `auto-import order:${t.order_id}`,
            1, "B"
          ],
        });
        imported++;
      }
      return NextResponse.json({ ok: true, imported, total: rawTrades.length });
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message });
    }
  }

  return NextResponse.json({ ok: false, error: "Ação inválida" });
}

export async function GET() {
  // Return exchange config info (no secrets)
  return NextResponse.json({
    supported: [
      { id: "bybit", name: "Bybit", docs: "https://www.bybit.com/app/user/api-management", features: ["futures","spot","P&L","fees"] },
      { id: "binance", name: "Binance", docs: "https://www.binance.com/en/my/settings/api-management", features: ["futures","spot","P&L","fees"] },
      { id: "kraken", name: "Kraken", docs: "https://www.kraken.com/u/security/api", features: ["spot","P&L","fees"] },
      { id: "xtb", name: "XTB", docs: "https://www.xtb.com", features: [], note: "XTB não disponibiliza API pública para retail. Importação manual por CSV." },
    ]
  });
}
