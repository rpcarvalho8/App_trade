/**
 * DEAD CODE — referência histórica apenas. NÃO importar / NÃO executar.
 *
 * A XTB descontinuou a xAPI pública em 14 de março de 2025:
 *   · wss://ws.xtb.com/{demo|real}
 *   · wss://ws.xtb.com/{demo|real}Stream
 *   · xapi.xtb.com
 * Sem substituto oficial. Credenciais XTB_LOGIN/PASSWORD já não permitem
 * obter OHLC. O motor XAUUSD usa Twelve Data como fonte primária
 * (ver xtb-client.ts).
 *
 * Docs antigas: http://developers.xstore.pro/documentation/
 *
 * Este ficheiro preserva o esqueleto de login + getChartLastRequest +
 * getCandles para se um dia existir API sucessora ou para auditoria.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

export const XTB_XAPI_DISCONTINUED_AT = "2025-03-14";
export const XTB_XAPI_NOTE =
  "XTB xAPI (ws.xtb.com / xapi.xtb.com) discontinued 2025-03-14 — no official replacement.";

/**
 * Exemplo do payload que usávamos (não funciona):
 *
 * login → { command: "login", arguments: { userId, password, appName } }
 * chart → { command: "getChartLastRequest", arguments: { info: { period, start, symbol: "GOLD" } } }
 * stream → wss://ws.xtb.com/demoStream + { command: "getCandles", streamSessionId, symbol }
 *
 * RATE_INFO: open/10^digits; high/low/close = shifts do open (ver xtb-chart.ts).
 */
export function xtbXapiDeadStub(): never {
  throw new Error(XTB_XAPI_NOTE);
}
