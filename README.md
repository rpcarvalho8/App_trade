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

UI: [`/signals`](http://localhost:3000/signals) — XAUUSD com badge **BETA / OBSERVAÇÃO** (Twelve Data ≠ feed da corretora).

### Fontes de mercado — estado actual

| | XAUUSD (`xtb-client.ts`) | SOLUSD (`kraken-client.ts`) |
|--|--------------------------|-----------------------------|
| **Fonte primária** | **Twelve Data** `time_series` `XAU/USD` (`TWELVE_DATA_API_KEY`) | Kraken public REST + WS |
| **XTB xAPI** | **Descontinuada 14/03/2025** (ws.xtb.com / xapi.xtb.com) — dead code em `xtb-xapi.dead.ts` | — |
| **Plano free TD** | Basic: **8 créditos/min · 800/dia**; poll fecho-alinhado ≈ **393/dia (24h)** ou **~133/dia (8h London/NY)** — margem confortável | — |
| **Sintético / gold-api?** | **Removido.** | — |
| **vs XTB xStation** | Agregador de mercado — **possível divergência de spread**; entrada manual | N/A |

### Backfill e warm-up

1. Carrega `candle_cache` (SQLite) se existir.
2. Backfill OHLC real Twelve Data: H4 (~30 dias), M15 (~5 dias), M5 (~1 dia).
3. Enquanto incompleto: `GET /api/signals` → `status: "warming_up"`; o **engine não avalia** confluences XAU.
4. Mínimos: H4≥80, M15≥200, M5≥100 barras.

### Persistência de candles

Tabela `candle_cache` em `trading.db` — restart **não** perde o histórico já carregado.

### Queda de ligação

- Twelve Data: poll periódico de `time_series` (OHLC), staggered por TF.
- Restart: rehidrata a partir de `candle_cache`, depois refresca Twelve Data.

### Persistência de `signals`

SQLite (`signals`) — sobrevivem a restart. Consulta: `GET /api/signals` ou página `/signals`.

Email opcional: `ALERT_EMAIL_TO` + `RESEND_API_KEY` ou `ALERT_EMAIL_WEBHOOK`.

Ver também `trading-os/.env.example` (`TWELVE_DATA_API_KEY` obrigatória para XAU).

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
- **WebSocket** — alertas preço / calendário / **sinais** (porta 3001)
- **Vitest** — detectors + engine + parser OHLC (`npm test`)

---

## 📈 Roadmap

- [x] Ligação Binance/Bybit/Kraken — import read-only
- [x] Screenshot upload
- [x] Alertas in-app (preço + calendário)
- [x] Mesa de Operação XAUUSD / SOLUSD
- [x] Motor de sinais alert-only (XAU London Structure + SOL SMC 3-Step)
- [x] OHLC real XAU via Twelve Data + cache + warm-up (xAPI XTB descontinuada; badge **beta**)
- [ ] Fonte OHLC alinhada à corretora (se surgir API) / calibração de spread
- [ ] Módulo Prop Firms
- [ ] Export PDF de relatório mensal
- [ ] Alertas email/Telegram (email parcial via env)
- [ ] Backtesting de setups
