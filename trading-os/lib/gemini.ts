import { readFile } from "fs/promises";
import path from "path";

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

/**
 * Reads a screenshot referenced by its public URL (e.g. "/screenshots/abc.png")
 * from the public folder and returns it as a Gemini inlineData image part.
 * Returns null if the file is missing or unreadable (graceful degradation).
 */
export async function imagePartFromUrl(url: string): Promise<GeminiPart | null> {
  if (!url) return null;
  try {
    // strip leading slash and any query string
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

/**
 * Calls Gemini generateContent with multimodal parts and returns parsed JSON.
 * Forces JSON output via responseMimeType. Throws with a clear message on failure.
 */
export async function callGeminiJSON(parts: GeminiPart[], maxOutputTokens = 8192): Promise<any> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY em falta. Adiciona ao .env.local: GEMINI_API_KEY=AIza...");
  }

  const res = await fetch(`${API_BASE}/${MODEL}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 500)}`);
  }

  const json: any = await res.json();
  const cand = json?.candidates?.[0];
  const text: string | undefined = cand?.content?.parts
    ?.map((p: any) => p.text)
    .filter(Boolean)
    .join("");

  if (!text) {
    const reason = cand?.finishReason || json?.promptFeedback?.blockReason || "resposta vazia";
    throw new Error(`Gemini sem texto de resposta (${reason}).`);
  }

  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Não foi possível fazer parse do JSON devolvido pelo Gemini.");
  }
}
