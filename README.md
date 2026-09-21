# ⚡ Trading Operating System (TOS)

Sistema local de journal, Mesa de Operação, AI Coach e analytics.  
Corre no teu PC (Next.js + SQLite). Sem execução automática no broker.

---

## 🚀 Instalação

```bash
cd trading-os
npm install

# AI Coach + Morning Brief (Google Gemini)
echo "GEMINI_API_KEY=..." > .env.local

npm run dev
# http://localhost:3000
```

Opcional em `.env.local`:

```
GEMINI_MODEL=gemini-flash-latest
RESET_TOKEN=escolhe-um-segredo   # obrigatório para POST /api/reset
ALERT_THRESHOLD_GOLD=0.15
ALERT_THRESHOLD_SOL=0.8
```

---

## 📋 Módulos

| Página | URL | Descrição |
|--------|-----|-----------|
| Overview | `/` | Dashboard: P&L, equity, por setup / par / sessão |
| **Sessão** | `/sessao` | Mesa de Operação XAUUSD / SOLUSD — checklist sequencial |
| **Sinais** | `/signals` | Motor de sinais (estado warm-up / beta XAU / lista) |
| Morning Brief | `/morning-brief` | Resumo macro diário (Gemini + APIs gratuitas) |
| Journal | `/journal` | Registo de trades (pré-preenchido a partir da sessão) |
| Journal Semanal | `/weekly-journal` | Revisão semanal manual |
| Performance | `/performance` | Analytics: equity, drawdown, por ativo e setup |
| Setups | `/setups` | Biblioteca de estudo (Wyckoff / Elliott / ICT / SMC) |
| AI Coach | `/ai-coach` | Relatório semanal Gemini (com screenshots) |
| Princípios | `/principles` | Regras globais e por ativo (XAUUSD / SOLUSD) |
| Exchanges | `/exchanges` | Importação read-only Bybit / Binance / Kraken |

---

## 🎯 Mesa de Operação

Um ativo, um playbook, gates SIM/NÃO:

- **XAUUSD — London Structure** — bias H4, sweep/MSS M15, entrada M5, R:R ≥ 2.0, máx. 2 trades, DD 1.5%
- **SOLUSD — SMC 3-Step** — sweep 15m → ChoCH 1m → FVG Golden Ratio, R:R ≥ 3.0, máx. 3 trades, DD 3%

Fluxo: marcar passos → calculadora R:R/size → **AUTORIZADO / ESPERAR / REJEITAR** → journal pré-preenchido.

---

## 🤖 AI Coach & Morning Brief

Usam **Google Gemini** (`GEMINI_API_KEY`), não Anthropic.

- Morning Brief: cron 06:00 Europe/Lisbon + catch-up ao abrir a página
- AI Coach: domingo 09:00 + geração manual

---

## 📡 Motor de Sinais (alert-only)

O runner em `lib/marketdata/signal-runner.ts` avalia as estratégias JSON e grava em `signals` + alerta (WS/som/email). **Não envia ordens** à corretora.

UI: [`/signals`](http://localhost:3000/signals) — XAUUSD com badge **BETA / OBSERVAÇÃO** até a fonte ser xAPI XTB verificada.

### Fontes de mercado — estado actual

| | XAUUSD (`xtb-client.ts`) | SOLUSD (`kraken-client.ts`) |
|--|--------------------------|-----------------------------|
| **Fonte primária** | **XTB xAPI** WebSocket — `getChartLastRequest` + stream `getCandles` ([docs](http://developers.xstore.pro/documentation/)) | Kraken public REST + WS |
| **Endpoints** | `wss://ws.xtb.com/{demo\|real}` + `{demo\|real}Stream` | `api.kraken.com` + `wss://ws.kraken.com` |
| **Credenciais** | `XTB_LOGIN`, `XTB_PASSWORD`, `XTB_ACCOUNT_TYPE=demo\|real`, `XTB_SYMBOL=GOLD` | Nenhuma (público) |
| **Fallback OHLC** | **Twelve Data** `time_series` `XAU/USD` (`TWELVE_DATA_API_KEY`) — nunca spot único | — |
| **Sintético / gold-api?** | **Removido.** Já não se sintetizam mechas a partir de um preço pontual. | — |
| **Comparado com XTB?** | Parser validado com fixture RATE_INFO + amostra GOLD M15; teste live opcional se houver creds (`npm test`) | N/A |

### Backfill e warm-up

1. Carrega `candle_cache` (SQLite) se existir.
2. Backfill OHLC real: H4 (~30 dias), M15 (~5 dias), M5 (~1 dia) via xAPI ou TwelveData.
3. Enquanto incompleto: `GET /api/signals` → `status: "warming_up"` e o **engine não avalia** confluences XAU.
4. Mínimos: H4≥80, M15≥200, M5≥100 barras.

### Persistência de candles

Tabela `candle_cache` em `trading.db` — restart **não** perde o histórico já carregado (evita backfill completo sempre).

### Queda de ligação

- xAPI stream: reconnect ~8 s; buffer + cache DB mantêm-se.
- TwelveData: poll periódico de `time_series` (OHLC), não spot.
- Restart do processo: rehidrata a partir de `candle_cache`, depois refresca a fonte live.

### Persistência de `signals`

SQLite (`signals`) — sobrevivem a restart. Consulta: `GET /api/signals` ou página `/signals`.

Email opcional: `ALERT_EMAIL_TO` + `RESEND_API_KEY` ou `ALERT_EMAIL_WEBHOOK`.

Ver também `trading-os/.env.example`.

---

## 🗄️ Base de Dados

SQLite local — `trading-os/trading.db`. Setups e princípios são seedados; **edições a setups existentes não são sobrescritas**. Inclui tabelas `signals` e `candle_cache`.

**Backup:**

```bash
cd trading-os
npm run db:backup
```

`POST /api/reset` apaga trades/logs/análises **apenas** se `RESET_TOKEN` estiver definido e for enviado (`x-reset-token` ou `{ "token": "..." }`).

---

## 🔧 Stack

- **Next.js 16** — App Router
- **React 19**
- **LibSQL** — SQLite local
- **Recharts** — gráficos
- **Gemini API** — brief e coach
- **WebSocket** — alertas preço / calendário / **sinais** (porta 3001) + XTB xAPI
- **Vitest** — detectors + engine + parser OHLC (`npm test`)

---

## 📈 Roadmap

- [x] Ligação Binance/Bybit/Kraken — import read-only
- [x] Screenshot upload
- [x] Alertas in-app (preço + calendário)
- [x] Mesa de Operação XAUUSD / SOLUSD
- [x] Motor de sinais alert-only (XAU London Structure + SOL SMC 3-Step)
- [x] OHLC real XAU (xAPI / TwelveData) + cache + warm-up (XAU ainda **beta** na UI)
- [ ] Calibração tick-a-tick gold/XTB em produção (tirar badge beta)
- [ ] Módulo Prop Firms
- [ ] Export PDF de relatório mensal
- [ ] Alertas email/Telegram (email parcial via env)
- [ ] Backtesting de setups
