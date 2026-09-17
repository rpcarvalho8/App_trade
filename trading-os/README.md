# Trading OS

App Next.js — journal, Mesa de Operação (XAUUSD / SOLUSD), Morning Brief e AI Coach (Gemini).

Documentação do produto: ver [README na raiz do repositório](../README.md).

```bash
npm install
echo "GEMINI_API_KEY=..." > .env.local
npm run dev
```

Abre http://localhost:3000 e começa em **/sessao**.

A Gemini (AI Coach / Morning Brief) pode devolver **HTTP 503** quando o modelo está saturado. **Não é a tua chave.** A app (journal, Mesa, alertas) continua. Por omissão usa `gemini-2.0-flash` e, se falhar, tenta `gemini-2.0-flash-lite`, `gemini-1.5-flash`, etc. No `.env.local`:

```
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-2.0-flash
GEMINI_FALLBACK_MODEL=gemini-2.0-flash-lite,gemini-1.5-flash
```

Se o 503 continuar: espera 2–5 min e gera de novo em **/ai-coach** (não precisas de reiniciar a app).
