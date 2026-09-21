import { readFile } from "fs/promises";
import path from "path";

/**
 * Model chain (Sep 2026):
 *   - gemini-2.0-flash / -lite: shut down
 *   - gemini-2.5-flash: shutdown ~16 Oct 2026 — do NOT use as primary
 *   - gemini-3.6-flash: current stable multimodal (text+image) — primary
 *   - gemini-3.1-flash-lite: lighter multimodal fallback
 *   - gemini-flash-latest: Google's moving alias
 */
export const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const FALLBACK_MODELS = (
  process.env.GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite,gemini-flash-latest"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
/** Retries per model: delays ~1s, 2s, 4s (+jitter) before switching model. */
const ATTEMPTS_PER_MODEL = 4;
const MAX_IMAGE_EDGE = 1280;
const JPEG_QUALITY = 72;

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export type GeminiGenerationConfig = {
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  thinkingConfig?: { thinkingBudget: number };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function backoffMs(attempt: number): number {
  // attempt 1→1s, 2→2s, 3→4s, 4→8s + up to 400ms jitter
  const base = 1000 * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * 400);
  return base + jitter;
}

function isRetryableStatus(status: number) {
  return status === 429 || status === 503 || status >= 500;
}

function modelsToTry(): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const m of [PRIMARY_MODEL, ...FALLBACK_MODELS]) {
    if (!m || seen.has(m)) continue;
    seen.add(m);
    list.push(m);
  }
  return list;
}

/**
 * Reads a screenshot, optionally compresses/resizes with sharp (JPEG ≤1280px),
 * and returns a Gemini inlineData part. Falls back to raw bytes if sharp fails.
 */
export async function imagePartFromUrl(url: string): Promise<GeminiPart | null> {
  if (!url) return null;
  try {
    const clean = url.replace(/^\//, "").split("?")[0];
    const filepath = path.join(process.cwd(), "public", clean);
    const buf = await readFile(filepath);

    try {
      const sharp = (await import("sharp")).default;
      const out = await sharp(buf)
        .rotate()
        .resize({
          width: MAX_IMAGE_EDGE,
          height: MAX_IMAGE_EDGE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toBuffer();
      return { inlineData: { mimeType: "image/jpeg", data: out.toString("base64") } };
    } catch {
      const ext = (clean.split(".").pop() || "png").toLowerCase();
      const mimeType =
        ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : ext === "webp"
          ? "image/webp"
          : "image/png";
      return { inlineData: { mimeType, data: buf.toString("base64") } };
    }
  } catch {
    return null;
  }
}

async function postGenerate(
  model: string,
  key: string,
  parts: GeminiPart[],
  generationConfig: GeminiGenerationConfig,
  timeoutMs: number
): Promise<{ ok: true; json: any } | { ok: false; status: number; body: string }> {
  const res = await fetch(`${API_BASE}/${model}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, body };
  }
  return { ok: true, json: await res.json() };
}

function textFromResponse(json: any): string | undefined {
  const cand = json?.candidates?.[0];
  return cand?.content?.parts
    ?.map((p: any) => p.text)
    .filter(Boolean)
    .join("");
}

/**
 * generateContent with exponential backoff + jitter on 429/503/5xx and a
 * fallback model chain when free-tier capacity or a retired model fails.
 */
export async function generateContent(opts: {
  parts: GeminiPart[];
  generationConfig: GeminiGenerationConfig;
  timeoutMs?: number;
  logLabel?: string;
}): Promise<any> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY em falta. Adiciona ao .env.local: GEMINI_API_KEY=AIza...");
  }

  const timeoutMs = opts.timeoutMs ?? 90_000;
  const label = opts.logLabel || "Gemini";
  const models = modelsToTry();
  let lastStatus = 0;
  let lastBody = "";

  for (let m = 0; m < models.length; m++) {
    const model = models[m];
    if (m > 0) {
      console.warn(`[${label}] a mudar para modelo ${model}…`);
    }
    const config: GeminiGenerationConfig = { ...opts.generationConfig };
    if (m > 0 || !config.thinkingConfig) delete config.thinkingConfig;

    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      const result = await postGenerate(model, key, opts.parts, config, timeoutMs);
      if (result.ok) {
        if (m > 0) console.log(`[${label}] OK com ${model}`);
        return result.json;
      }
      lastStatus = result.status;
      lastBody = result.body;
      // 404 on model id → try next model immediately (retired / typo)
      if (result.status === 404) {
        console.warn(`[${label}] modelo ${model} não encontrado (404); a saltar…`);
        break;
      }
      const canRetry = isRetryableStatus(result.status) && attempt < ATTEMPTS_PER_MODEL;
      if (!canRetry) break;
      const wait = backoffMs(attempt);
      console.warn(
        `[${label}] ${model} ${result.status}; retry ${attempt}/${ATTEMPTS_PER_MODEL - 1} em ${Math.round(wait / 100) / 10}s…`
      );
      await sleep(wait);
    }
  }

  if (lastStatus === 503 || lastStatus === 429) {
    throw new Error(
      `Serviço Gemini temporariamente indisponível (${lastStatus}). Não é a tua API key — a Google está com procura elevada. Espera 2–5 min e volta a gerar (botão em /ai-coach).`
    );
  }
  if (lastStatus === 401 || lastStatus === 403) {
    throw new Error(
      `Autenticação Gemini falhou (${lastStatus}). Verifica GEMINI_API_KEY em .env.local (aistudio.google.com/apikey).`
    );
  }
  if (lastStatus === 404) {
    throw new Error(
      `Modelo Gemini não encontrado (404). Actualiza GEMINI_MODEL no .env.local (recomendado: gemini-3.6-flash). ${lastBody.slice(0, 200)}`
    );
  }
  if (lastStatus === 400) {
    throw new Error(
      `Pedido Gemini inválido (400). ${lastBody.slice(0, 300)}`
    );
  }
  throw new Error(`Gemini HTTP ${lastStatus}: ${lastBody.slice(0, 400)}`);
}

export function geminiResponseText(json: any): string {
  const text = textFromResponse(json);
  if (text) return text;
  const cand = json?.candidates?.[0];
  const reason = cand?.finishReason || json?.promptFeedback?.blockReason || "resposta vazia";
  throw new Error(`Gemini sem texto de resposta (${reason}).`);
}

/**
 * Calls Gemini generateContent with multimodal parts and returns parsed JSON.
 * Forces JSON output via responseMimeType. Throws with a clear message on failure.
 */
export async function callGeminiJSON(parts: GeminiPart[], maxOutputTokens = 8192): Promise<any> {
  const json = await generateContent({
    parts,
    logLabel: "AI Coach",
    timeoutMs: 120_000,
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens,
      responseMimeType: "application/json",
    },
  });

  const text = geminiResponseText(json);

  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Não foi possível fazer parse do JSON devolvido pelo Gemini.");
  }
}
