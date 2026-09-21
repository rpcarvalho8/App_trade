# Trading OS

App Next.js — journal, Mesa de Operação (XAUUSD / SOLUSD), Morning Brief e AI Coach (Gemini).

Documentação do produto: ver [README na raiz do repositório](../README.md).

```bash
npm install
echo "GEMINI_API_KEY=..." > .env.local
npm run dev
```

Abre http://localhost:3000 e começa em **/sessao**.

## Gemini (AI Coach / Morning Brief)

HTTP **503/429** = saturação temporária da Google (**não** é a chave). Journal, Mesa e alertas continuam.

Modelos por omissão (Set 2026):

```
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-3.6-flash
GEMINI_FALLBACK_MODEL=gemini-3.1-flash-lite,gemini-flash-latest
```

- `gemini-2.0-flash` / `-lite` — **shut down** (não usar)
- `gemini-2.5-flash` — shutdown ~16 Out 2026 (não usar como primário)
- `gemini-3.6-flash` — multimodal (texto + imagens) — **primário**
- Screenshots do Coach são comprimidos (JPEG ≤1280px) antes do envio

Se o 503 continuar: espera 2–5 min e gera de novo em **/ai-coach**.
