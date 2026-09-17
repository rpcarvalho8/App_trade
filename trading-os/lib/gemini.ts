import { readFile } from "fs/promises";
import path from "path";

export const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-2.0-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_ATTEMPTS = 5;

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
  const list = [PRIMARY_MODEL];
  if (FALLBACK_MODEL && FALLBACK_MODEL !== PRIMARY_MODEL) list.push(FALLBACK_MODEL);
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
 * generateContent with retries on 429/503/5xx and an optional lighter fallback model
 * when the primary (often gemini-flash-latest) is overloaded.
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
  let lastErr = "";

  for (let m = 0; m < models.length; m++) {
    const model = models[m];
    if (m > 0) {
      console.warn(`[${label}] modelo ${models[m - 1]} indisponível; a tentar ${model}…`);
    }
    const config: GeminiGenerationConfig = { ...opts.generationConfig };
    if (m > 0) delete config.thinkingConfig;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const result = await postGenerate(model, key, opts.parts, config, timeoutMs);
      if (result.ok) return result.json;
      lastErr = `Gemini HTTP ${result.status}: ${result.body.slice(0, 400)}`;
      const canRetry = isRetryableStatus(result.status) && attempt < MAX_ATTEMPTS;
      if (!canRetry) break;
      const wait = 3000 * attempt;
      console.warn(
        `[${label}] ${model} ${result.status}; retry ${attempt}/${MAX_ATTEMPTS - 1} em ${wait / 1000}s…`
      );
      await sleep(wait);
    }
  }

  throw new Error(
    lastErr ||
      "Gemini indisponível (503/429). A API está sobrecarregada — a app continua a funcionar; volta a gerar o relatório daqui a uns minutos."
  );
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
