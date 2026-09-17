# Trading OS

App Next.js — journal, Mesa de Operação (XAUUSD / SOLUSD), Morning Brief e AI Coach (Gemini).

Documentação do produto: ver [README na raiz do repositório](../README.md).

```bash
npm install
echo "GEMINI_API_KEY=..." > .env.local
npm run dev
```

Abre http://localhost:3000 e começa em **/sessao**.

A Gemini (AI Coach / Morning Brief) pode devolver **HTTP 503** quando o modelo está saturado. A app **não depende** disso para o journal, a Mesa ou os alertas. O arranque tenta de novo e, se o modelo principal falhar, usa `GEMINI_FALLBACK_MODEL` (por omissão `gemini-2.0-flash`). Podes forçar no `.env.local`:

```
GEMINI_MODEL=gemini-flash-latest
GEMINI_FALLBACK_MODEL=gemini-2.0-flash
```

Se o catch-up no arranque falhar na mesma, espera uns minutos e gera o relatório em **/ai-coach** ou recarrega **/morning-brief**.
