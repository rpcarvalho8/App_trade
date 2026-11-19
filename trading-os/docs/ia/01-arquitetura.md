# Arquitetura: base de conhecimento → IA → sinais e análise com zoom

## Decisão de stack

**Fica tudo no stack atual: Next.js 16 (App Router) + TypeScript + SQLite (libsql) + Gemini.** Não há reescrita em Python/FastAPI nem base vetorial externa.

| Peça | Escolha | Porquê |
| --- | --- | --- |
| Frontend | Next.js / React (já existe) | A Mesa, sinais e journal já vivem aqui. Uma página nova (`/analise-visual`). |
| Backend | Route handlers Next (`app/api/*`) | Mesmo processo, mesma DB, mesmas regras de risco (`lib/risk.ts`). Um serviço Python só traria deploy duplo e regras de risco duplicadas. |
| Visão + raciocínio | Gemini (`lib/gemini.ts`, multimodal, já com retry/fallback) | Já pago e configurado. Agora com `systemInstruction` e `mediaResolution: HIGH` para gráficos. |
| Processamento de imagem | `sharp` (já instalado) | Recorte em resolução nativa no servidor, ampliação lanczos, composição do eixo de preço. |
| Base de conhecimento | SQLite `kb_chunks` + BM25 em TypeScript | ~40 chunks hoje. Para este volume, BM25 com sinónimos PT/EN acerta tanto como embeddings, sem custo nem latência de API. |
| Validação | `zod` + funções puras (`lib/ai/trade-plan.ts`) | A IA propõe; o código decide (lado do SL, R:R, stop por activo/horizonte, checklist). |

Quando muda: se a base passar de ~2000 chunks (livros convertidos, centenas de DRC), a fase 2 é juntar embeddings (`gemini-embedding-001`) numa coluna da mesma tabela e fazer pesquisa híbrida (BM25 + cosseno) em memória ou com `sqlite-vec`. Continua tudo no mesmo SQLite.

## Fluxo

```
            ┌───────────────────── INGESTÃO (POST /api/knowledge) ─────────────────────┐
 knowledge/  │ notas .md curadas + guia de estudo                                        │
 KNOWLEDGE_  │ vault Obsidian completo (Daily Report Cards, notas)                        │
 DIRS        │   → limpar sintaxe Obsidian → DRC: extrair só o preenchido → chunk por    │
             │     cabeçalho (≤1400 car.) → etiquetas (wyckoff/elliott/smc/liquidez/      │
             │     xauusd/solusd/…) → SQLite kb_chunks                                    │
             └───────────────────────────────────────────────────────────────────────────┘

 /analise-visual (UI)                              POST /api/chart-zoom
 ┌──────────────────────────┐   imageUrl +       ┌───────────────────────────────────────────────┐
 │ carregar / colar gráfico │   região 0..1 +    │ 1. sharp: recorte NATIVO da região             │
 │ zoom do palco 1–3×       │──── activo, tipo,──▶│    + faixa do eixo de preço à mesma altura     │
 │ arrastar → seleção       │     TF, pergunta   │    → ampliado até ≥1536 px (PNG sem perdas)    │
 │ pré-visualização nativa  │                    │    + gráfico completo com a região a amarelo   │
 └──────────────────────────┘                    │ 2. BM25 na KB (tags por horizonte + activo)    │
            ▲                                    │ 3. system = núcleo + activo + horizonte +      │
            │                                    │    limites + tarefa;  user = contexto + [KBn]  │
            │                                    │    + imagem 1 (contexto) + imagem 2 (zoom)     │
            │                                    │ 4. Gemini (JSON, mediaResolution HIGH)         │
            │                                    │ 5. zod → validateTradePlan → positionSize      │
            └──── leitura + cenários + plano ────│ 6. grava em chart_analyses                     │
                  validado + lote                └───────────────────────────────────────────────┘
```

### Porque é que o recorte vai em alta resolução
- O browser só envia **coordenadas normalizadas** (0..1). O recorte é feito no servidor a partir do ficheiro original, por isso o zoom do ecrã nunca degrada a imagem.
- Recortes pequenos são ampliados (lanczos, até 3×) para o lado maior ter ≥1536 px; o Gemini lê melhor pavios e números com mais píxeis.
- O recorte normalmente corta o eixo de preço; por isso a faixa direita do gráfico (8% da largura) à mesma altura é colada ao lado, separada por uma linha amarela. A IA lê os níveis exatos sem adivinhar.
- O gráfico completo vai junto, com a região marcada, para a leitura ser "esta zona no contexto do gráfico maior".

### Day vs Swing (lógica de decisão)
- `horizonForTimeframe`: M1–H1 → Day, H4–W1 → Swing. Com "Auto" e TF por detetar, a IA recebe os dois perfis e escolhe.
- O horizonte troca: o perfil do prompt (SMC intradiário vs Wyckoff/Elliott macro), as etiquetas da pesquisa na KB e os limites de validação (`PLAN_LIMITS`).

### Sem janela horária
- Nenhum filtro horário no motor de IA (princípio 2 do prompt).
- As estratégias determinísticas deixaram de ter `utcHours` / `allowed`: o runner avalia 24/5 no ouro e 24/7 na SOL; a adaptação faz-se pelos parâmetros em ATR e pelos limites de stop.

## Ficheiros

| Ficheiro | O que faz |
| --- | --- |
| `lib/ai/master-prompt.ts` | System prompt mestre (núcleo + perfis XAU/SOL + Day/Swing + limites). |
| `lib/ai/trade-plan.ts` | Classificação Day/Swing, limites por activo e gate matemático do plano. |
| `lib/ai/chart-image.ts` | Recorte nativo, eixo de preço, ampliação, marcação da região. |
| `lib/ai/chart-zoom.ts` | Tarefa de zoom, schema zod da resposta, validação dos cenários. |
| `lib/ai/kb-text.ts` / `lib/ai/knowledge.ts` | Ingestão, chunking, DRC, BM25, tabela `kb_chunks`. |
| `app/api/chart-zoom/route.ts` | Endpoint de visão (POST analisa, GET histórico). |
| `app/api/knowledge/route.ts` | GET pesquisa/estatísticas, POST reindexar. |
| `app/analise-visual/page.tsx` | UI de zoom e resultado. |
| `knowledge/` | Notas curadas do vault + guia de estudo (indexados). |

## Configuração (`.env.local`)

```
GEMINI_API_KEY=...                       # já existente
# GEMINI_MEDIA_RESOLUTION=MEDIA_RESOLUTION_HIGH   (default; vazio desliga)
# KNOWLEDGE_DIRS=/caminho/para/o/vault/Trade/Estudo/Trade   (opcional, várias separadas por vírgula)
```
Depois de mudar notas: `curl -X POST http://localhost:3000/api/knowledge`.

## O que fica para a fase seguinte
1. **PDFs dos livros** (Wyckoff, Elliott, Smart Money): converter uma vez para notas `.md` resumidas por capítulo (Gemini lê PDF) e pôr em `knowledge/livros/`. Não indexar o PDF bruto.
2. **Imagens de referência do vault** (esquemas Wyckoff/Elliott/SMC): já estão parcialmente em `public/methodology` e `public/smc`; podem ir como 3.ª imagem quando a pergunta é "que esquema é este?".
3. **Sinal IA sobre velas ao vivo**: o mesmo prompt + `validateTradePlan` aplicado às velas do `candle-cache` (texto OHLC + gráfico renderizado), a alimentar `emitSignalAlert` como uma estratégia a mais.
4. **DRC preenchidos**: são a única fonte dos teus erros reais. Sem eles a IA só conhece teoria.
