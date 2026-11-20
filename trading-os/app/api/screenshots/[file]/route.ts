import { readFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * Serve capturas gravadas depois do arranque. Em `next start` a pasta public/ só conhece
 * os ficheiros que existiam no arranque; as capturas novas chegam aqui pelo rewrite em next.config.ts.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const name = path.basename(file);
  const type = TYPES[name.split(".").pop()?.toLowerCase() ?? ""];
  if (!type || name !== file) return new Response("Not found", { status: 404 });
  try {
    const buf = await readFile(path.join(process.cwd(), "public", "screenshots", name));
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
