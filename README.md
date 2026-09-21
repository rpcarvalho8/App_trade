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

### Fontes de mercado — estado actual

| | XAUUSD (`xtb-client.ts`) | SOLUSD (`kraken-client.ts`) |
|--|--------------------------|-----------------------------|
| **Fonte** | [gold-api.com](https://gold-api.com/) — spot XAU | Kraken public REST + WS |
| **Endpoint preço** | `GET https://api.gold-api.com/price/XAU` (sem auth) | `GET https://api.kraken.com/0/public/Ticker?pair=SOLUSD` + `wss://ws.kraken.com` ticker `SOL/USD` |
| **Gratuita?** | Sim (docs: real-time sem rate limit; histórico/OHLC free capped ~10/h — **não usamos OHLC desta API**) | Sim (API pública Kraken) |
| **Latência típica** | ~300–400 ms RTT neste ambiente cloud (poll); docs afirmam resposta “instant” em memória | REST OHLC/Ticker tipicamente &lt;1 s; WS quase tempo-real |
| **Poll** | Default `XAU_POLL_MS=15000` | Default `SOL_POLL_MS=10000` (+ WS se `SOL_USE_WS≠0`) |
| **Comparado com XTB?** | **Não.** Não há calibração automática vs cotação xStation. O nome `xtb-client` é só convenção do playbook (execução manual na XTB). Spot gold-api ≠ CFDs XTB (spread/offset). | N/A (fonte = exchange Kraken) |

### Backfill de candles ao arrancar

| Cliente | Comportamento |
|---------|----------------|
| **XAU** | **Sem OHLC histórico real.** No primeiro tick com preço, chama `seedSyntheticHistory(price)` (~80 barras **sintéticas** por TF H4/M15/M5). Depois agrega ticks de poll nos buffers. Até ao 1.º preço bem-sucedido os buffers estão vazios. |
| **SOL** | **Sim — backfill REST real.** `seedSolHistory()` chama `OHLC?pair=SOLUSD&interval=15|1` e faz `buffer.seed(candles)` para `15m` e `1m` **antes** de depender só do stream. Se o seed falhar, os buffers ficam vazios até chegarem ticks. |

### Queda de ligação / restart do processo

| Cenário | Comportamento |
|---------|----------------|
| **XAU poll falha** | O intervalo continua; essa leitura é ignorada (`null`). Não há WS a “reconectar”. Buffer em memória **mantém-se** enquanto o processo Node viver. |
| **Kraken WS fecha** | Reconnect automático após **5 s** (`connectWs` no `close`). O **buffer em memória mantém-se** (não é limpo no reconnect). O poll REST continua em paralelo. |
| **Restart da app (`npm run dev` / novo processo)** | Buffers **perdem-se** (vivem em `globalThis`). XAU volta a seed sintético no 1.º preço; SOL volta a fazer backfill REST OHLC. Estado do engine (passo actual da sequência) também reinicia. |

### Persistência de `signals`

Registos em **SQLite** (`trading-os/trading.db`, tabela `signals` via `@libsql/client`). **Sobrevivem a restart** da app. Não são só memória. Buffer WS de toasts recentes é que é in-memory (máx. ~30 alertas).

Consulta: `GET /api/signals`.

Email opcional: `ALERT_EMAIL_TO` + `RESEND_API_KEY` ou `ALERT_EMAIL_WEBHOOK`.

---

## 🗄️ Base de Dados

SQLite local — `trading-os/trading.db`. Setups e princípios são seedados; **edições a setups existentes não são sobrescritas**. Inclui tabela `signals` do motor.

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
- **Vitest** — detectors + engine (`npm test`)

---

## 📈 Roadmap

- [x] Ligação Binance/Bybit/Kraken — import read-only
- [x] Screenshot upload
- [x] Alertas in-app (preço + calendário)
- [x] Mesa de Operação XAUUSD / SOLUSD
- [x] Motor de sinais alert-only (XAU London Structure + SOL SMC 3-Step)
- [ ] Backfill OHLC real para XAU (hoje: histórico sintético)
- [ ] Calibração gold-api vs cotação XTB (spread/offset)
- [ ] Módulo Prop Firms
- [ ] Export PDF de relatório mensal
- [ ] Alertas email/Telegram (email parcial via env)
- [ ] Backtesting de setups
