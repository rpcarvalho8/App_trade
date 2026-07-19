# ⚡ Trading Operating System (TOS)

Sistema profissional de gestão de trading — Journal + AI Coach + Analytics.  
Corre 100% local no teu PC. Sem cloud, sem subscrições.

---

## 🚀 Instalação Rápida

```bash
# 1. Extrai o projeto
tar -xzf trading-os.tar.gz
cd trading-os

# 2. Instala dependências
npm install

# 3. Configura a API key do Claude (para o AI Coach)
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local

# 4. Arranca o servidor
npm run dev

# 5. Abre no browser
# http://localhost:3000
```

---

## 📋 Módulos

| Página | URL | Descrição |
|--------|-----|-----------|
| Overview | `/` | Dashboard geral com métricas, equity curve e últimos trades |
| Journal | `/journal` | Registo de trades com formulário completo |
| Performance | `/performance` | Analytics avançado: equity, drawdown, setup analysis |
| Setups | `/setups` | Biblioteca de setups com regras e performance |
| AI Coach | `/ai-coach` | Análise AI dos teus padrões e plano de estudo |
| Princípios | `/principles` | As tuas regras de ouro organizadas por categoria |

---

## 🤖 AI Coach

O AI Coach usa o Claude (claude-opus-4) para:
- Detectar padrões comportamentais (FOMO, revenge, etc.)
- Identificar pontos fortes e fracos com dados concretos
- Gerar plano de estudo personalizado
- Sugerir o que evitar e em que focar

**Necessário:** API Key da Anthropic em `.env.local`
```
ANTHROPIC_API_KEY=sk-ant-api03-...
```
Obtém em: https://console.anthropic.com

---

## 🗄️ Base de Dados

SQLite local — ficheiro `trading.db` na raiz do projeto.  
Dados de exemplo são inseridos automaticamente na primeira execução.

**Backup:**
```bash
cp trading.db trading_backup_$(date +%Y%m%d).db
```

---

## 🔧 Stack Técnica

- **Next.js 14** — App Router, Server Components
- **LibSQL** — SQLite local (sem instalação adicional)
- **Recharts** — Gráficos interativos
- **Anthropic SDK** — AI Coach

---

## 📈 Roadmap (próximas versões)

- [ ] Ligação Binance/Bybit API — importar trades automaticamente
- [ ] Módulo Prop Firms (FTMO, MFF, The5ers)
- [ ] Screenshot upload e anotação de charts
- [ ] Export PDF de relatório mensal
- [ ] Alertas (email/Telegram) para violações de regras
- [ ] Backtesting de setups

---

## 📂 Estrutura

```
trading-os/
├── app/
│   ├── page.tsx              # Overview
│   ├── journal/page.tsx      # Journal de trades
│   ├── performance/page.tsx  # Analytics
│   ├── setups/page.tsx       # Setups library
│   ├── ai-coach/page.tsx     # AI Coach
│   ├── principles/page.tsx   # Princípios
│   └── api/                  # APIs REST
│       ├── trades/
│       ├── stats/
│       ├── setups/
│       ├── principles/
│       └── ai-analysis/
└── lib/
    └── db.ts                 # Base de dados SQLite
```
