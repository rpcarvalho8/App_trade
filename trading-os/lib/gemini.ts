import { readFile } from "fs/promises";
import path from "path";

/**
 * gemini-flash-latest is convenient but often returns 503 under free-tier load.
 * Default to a pinned Flash model; override with GEMINI_MODEL if you prefer latest.
 */
export const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const FALLBACK_MODELS = (
  process.env.GEMINI_FALLBACK_MODEL ||
  "gemini-2.0-flash-lite,gemini-1.5-flash,gemini-flash-latest"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
/** Retries per model before moving to the next (503/429 clear faster by switching). */
const ATTEMPTS_PER_MODEL = 2;

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
 * Reads a screenshot referenced by its public URL (e.g. "/screenshots/abc.png")
 * from the public folder and returns it as a Gemini inlineData image part.
 * Returns null if the file is missing or unreadable (graceful degradation).
 */
export async function imagePartFromUrl(url: string): Promise<GeminiPart | null> {
  if (!url) return null;
  try {
    const clean = url.replace(/^\//, "").split("?")[0];
    const filepath = path.join(process.cwd(), "public", clean);
    const buf = await readFile(filepath);
    const ext = (clean.split(".").pop() || "png").toLowerCase();
    const mimeType =
      ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "webp"
        ? "image/webp"
        : "image/png";
    return { inlineData: { mimeType, data: buf.toString("base64") } };
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
 * generateContent with short retries and a chain of fallback models when
 * free-tier capacity returns 503/429.
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
    // thinkingConfig is only supported on some models / primary path
    if (m > 0 || !config.thinkingConfig) delete config.thinkingConfig;

    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      const result = await postGenerate(model, key, opts.parts, config, timeoutMs);
      if (result.ok) {
        if (m > 0) console.log(`[${label}] OK com ${model}`);
        return result.json;
      }
      lastStatus = result.status;
      lastBody = result.body;
      const canRetry = isRetryableStatus(result.status) && attempt < ATTEMPTS_PER_MODEL;
      if (!canRetry) break;
      const wait = 2000 * attempt;
      console.warn(
        `[${label}] ${model} ${result.status}; retry ${attempt}/${ATTEMPTS_PER_MODEL - 1} em ${wait / 1000}s…`
      );
      await sleep(wait);
    }
  }

  if (lastStatus === 503 || lastStatus === 429) {
    throw new Error(
      `Gemini sobrecarregada (${lastStatus}). Não é a tua chave — a API Google está com procura elevada. Espera 2–5 min e volta a gerar. Podes mudar GEMINI_MODEL no .env.local (ex.: gemini-2.0-flash-lite).`
    );
  }
  if (lastStatus === 400 || lastStatus === 401 || lastStatus === 403) {
    throw new Error(
      `Gemini HTTP ${lastStatus}: problema de chave ou pedido. Verifica GEMINI_API_KEY em .env.local (aistudio.google.com/apikey). ${lastBody.slice(0, 200)}`
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
