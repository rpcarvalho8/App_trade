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

## 🗄️ Base de Dados

SQLite local — `trading-os/trading.db`. Setups e princípios são seedados; **edições a setups existentes não são sobrescritas**.

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
- **WebSocket** — alertas de preço / calendário (porta 3001)

---

## 📈 Roadmap

- [x] Ligação Binance/Bybit/Kraken — import read-only
- [x] Screenshot upload
- [x] Alertas in-app (preço + calendário)
- [x] Mesa de Operação XAUUSD / SOLUSD
- [ ] Módulo Prop Firms
- [ ] Export PDF de relatório mensal
- [ ] Alertas email/Telegram
- [ ] Backtesting de setups
