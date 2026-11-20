# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

Run everything from `trading-os/` (the app root). The SQLite file is resolved from `process.cwd()` (`lib/db.ts`), so starting the server from another directory silently creates an empty `trading.db`.

```bash
npm run dev            # Next.js dev server (http://localhost:3000, redirects to /sessao)
npm run build / start
npm run lint           # eslint
npm test               # vitest run (node env, lib/**/*.test.ts only)
npx vitest run lib/__tests__/risk.test.ts   # single file
npx vitest run -t "name"                    # single test by name
npm run db:backup / db:restore              # scripts/db-utils.js
npm run brief                               # scripts/morning-brief.js (--schedule for recurring)
```

Env in `.env.local`: `GEMINI_API_KEY` (required for AI features), `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `RESET_TOKEN` (needed for `POST /api/reset`), `ALERT_THRESHOLD_GOLD/SOL`. AI uses Google Gemini, not Anthropic. Gemini 503/429 are transient saturation, not key problems.

## Architecture

Local-only trading journal + signal engine (Next.js App Router, React 19, Tailwind 4, libsql/SQLite). The product is **alert-only**: nothing ever sends orders to a broker. UI text, comments and docs are in Portuguese (pt-PT); keep that convention.

- **`app/`** — pages (`sessao` = Mesa de Operação checklist, `signals`, `journal`, `performance`, `ai-coach`, `morning-brief`, …) and `app/api/*` route handlers. Shared UI lives in `app/components` (there is no top-level `components/` content).
- **`lib/db.ts`** — single libsql client over `trading.db` (repo-local, file DB), `initDB()` creates tables with `CREATE TABLE IF NOT EXISTS` (no ORM migrations in use despite drizzle/prisma deps), plus `getSetting/setSetting` key-value store. Other modules own their tables (`ensureSignalsTable`, `ensureCandleCacheTable`, engine log) and create them lazily.
- **`instrumentation.ts`** — the process bootstrap. In the Node runtime it starts, in one process: node-cron jobs (AI Coach weekly Sun 09:00, Morning Brief daily 06:00) with delayed catch-up, the alert engine + WebSocket server (port 3001, `lib/alert-ws.ts`), and the signal runner. Guarded by `globalThis.__tosScheduled` against hot-reload duplication; failures are logged and never crash the app.
- **Signal engine pipeline** — `lib/marketdata/*` (XAUUSD via Twelve Data/XTB clients, SOLUSD via Kraken; `candle-buffer` multi-TF buffers, `candle-cache` persistent SQLite OHLCV) feeds `lib/marketdata/signal-runner.ts`, which evaluates strategies from `lib/strategies/` and persists via `lib/signals.ts` + `lib/signal-journal.ts`, then alerts (WS/sound/email/Telegram). Strategies are declarative JSON (`*.json`: london-structure, smc-3step, htf-rotation) interpreted by `strategies/engine.ts` using `strategies/detectors/*`; `strategies/replay.ts` replays the engine over the cached candles (`/api/signals/replay`). The engine must only read **closed** candles. Twelve Data feed ≠ broker feed, so XAUUSD signals are labelled BETA.
- **Risk/accounts** — `lib/risk.ts`, `lib/prop-rules.ts` (prop-firm daily/max drawdown), `lib/accounts*.ts` (account per symbol, EUR/USD conversion cached in settings), `lib/metrics.ts`, `lib/playbooks.ts`.
- **AI** — `lib/gemini.ts` wrapper (model fallback chain), `lib/ai/*` (master prompt, knowledge base from `knowledge/` markdown, chart images, trade plan), `lib/weekly-analysis.ts`, `lib/morning-brief.ts`. Prompt design docs in `docs/ia/`.
- Screenshots are uploaded to `public/screenshots/`.

Tests are unit tests of pure `lib/` logic (`lib/__tests__`, `lib/strategies/__tests__`, `lib/ai/__tests__`); path alias `@/` maps to the app root.
