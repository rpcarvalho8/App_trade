/**
 * Preparação das imagens para a análise com zoom.
 *
 * O recorte é feito NO SERVIDOR a partir do ficheiro original (resolução nativa), não a partir
 * do canvas do browser. Assim a IA recebe os píxeis reais do gráfico, sem a perda de escala do ecrã.
 *
 * A IA recebe 2 imagens:
 *  1. Gráfico completo (≤2048 px, JPEG q88) com a região marcada a amarelo → contexto.
 *  2. Recorte em alta resolução (PNG sem perdas, ampliado com lanczos até ≥1536 px no lado maior)
 *     + a faixa do eixo de preço à direita, à mesma altura → para ler níveis exatos.
 */
import { readFile } from "fs/promises";
import path from "path";

export interface NormRegion {
  /** Fracções 0..1 da largura/altura da imagem original. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ZoomImages {
  full: { mimeType: string; data: string };
  crop: { mimeType: string; data: string };
  /** Pré-visualização pequena do que a IA viu (para mostrar na UI). */
  cropPreview: string;
  meta: {
    sourceWidth: number;
    sourceHeight: number;
    cropPx: { left: number; top: number; width: number; height: number };
    priceAxisAppended: boolean;
    upscale: number;
    cropOutPx: { width: number; height: number };
  };
}

const SCREENSHOT_URL = /^\/screenshots\/[\w.-]+\.(png|jpe?g|webp|gif)$/i;
const FULL_MAX_EDGE = 2048;
const CROP_MIN_EDGE = 1536;
const CROP_MAX_EDGE = 3072;
const MAX_UPSCALE = 3;
const MIN_CROP_PX = 24;

/** Só aceita ficheiros carregados para public/screenshots (sem path traversal). */
export async function readScreenshot(url: string): Promise<Buffer> {
  const clean = String(url || "").split("?")[0];
  if (!SCREENSHOT_URL.test(clean)) throw new Error("Imagem inválida: carrega o gráfico primeiro.");
  return readFile(path.join(process.cwd(), "public", clean));
}

export function clampRegion(r: NormRegion): NormRegion {
  const c = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
  const x = c(r.x);
  const y = c(r.y);
  return { x, y, w: Math.min(c(r.w), 1 - x), h: Math.min(c(r.h), 1 - y) };
}

/** Converte a região normalizada em píxeis inteiros dentro da imagem. */
export function regionToPixels(r: NormRegion, width: number, height: number) {
  const n = clampRegion(r);
  const left = Math.floor(n.x * width);
  const top = Math.floor(n.y * height);
  const w = Math.max(MIN_CROP_PX, Math.round(n.w * width));
  const h = Math.max(MIN_CROP_PX, Math.round(n.h * height));
  return {
    left: Math.min(left, Math.max(0, width - w)),
    top: Math.min(top, Math.max(0, height - h)),
    width: Math.min(w, width),
    height: Math.min(h, height),
  };
}

/** Factor de ampliação: leva o lado maior a ≥CROP_MIN_EDGE, sem passar de 3× nem de CROP_MAX_EDGE. */
export function upscaleFactor(width: number, height: number): number {
  const long = Math.max(width, height);
  if (long >= CROP_MIN_EDGE) return Math.min(1, CROP_MAX_EDGE / long);
  return Math.min(MAX_UPSCALE, CROP_MIN_EDGE / long);
}

export async function buildZoomImages(
  buf: Buffer,
  region: NormRegion,
  opts: { includePriceAxis?: boolean; axisFraction?: number; axis?: { x: number; w: number } | null } = {}
): Promise<ZoomImages> {
  const sharp = (await import("sharp")).default;
  const base = sharp(buf).rotate();
  const meta = await base.metadata();
  const W = meta.width || 0;
  const H = meta.height || 0;
  if (!W || !H) throw new Error("Não foi possível ler as dimensões da imagem.");

  const px = regionToPixels(region, W, H);

  // 1) Recorte nativo (+ faixa do eixo de preço à mesma altura, se o recorte não a incluir já).
  //    Por defeito o eixo é a margem direita; em layouts com vários painéis (eixo à esquerda de cada
  //    painel) o trader marca a faixa do eixo na UI e ela chega em opts.axis.
  const axisFrac = Math.min(0.2, Math.max(0.03, opts.axisFraction ?? 0.08));
  const axisLeft = opts.axis ? Math.floor(clampRegion({ x: opts.axis.x, y: 0, w: opts.axis.w, h: 1 }).x * W) : W - Math.round(W * axisFrac);
  const axisW = opts.axis
    ? Math.max(8, Math.min(W - axisLeft, Math.round(clampRegion({ x: opts.axis.x, y: 0, w: opts.axis.w, h: 1 }).w * W)))
    : Math.round(W * axisFrac);
  const overlapsAxis = px.left < axisLeft + axisW && px.left + px.width > axisLeft + axisW * 0.5;
  const appendAxis = opts.includePriceAxis !== false && !overlapsAxis;

  let cropBuf = await sharp(buf).rotate().extract(px).png().toBuffer();
  let cw = px.width;
  if (appendAxis) {
    const axisBuf = await sharp(buf)
      .rotate()
      .extract({ left: axisLeft, top: px.top, width: axisW, height: px.height })
      .png()
      .toBuffer();
    const gap = 3;
    cropBuf = await sharp({
      create: { width: px.width + gap + axisW, height: px.height, channels: 3, background: "#facc15" },
    })
      .composite([
        { input: cropBuf, left: 0, top: 0 },
        { input: axisBuf, left: px.width + gap, top: 0 },
      ])
      .png()
      .toBuffer();
    cw = px.width + gap + axisW;
  }

  const k = upscaleFactor(cw, px.height);
  const outW = Math.round(cw * k);
  const outH = Math.round(px.height * k);
  const cropOut = await sharp(cropBuf)
    .resize({ width: outW, height: outH, kernel: "lanczos3" })
    .sharpen(k > 1 ? { sigma: 0.6 } : undefined)
    .png({ compressionLevel: 6 })
    .toBuffer();

  // 2) Gráfico completo com a região marcada.
  const s = Math.min(1, FULL_MAX_EDGE / Math.max(W, H));
  const fw = Math.round(W * s);
  const fh = Math.round(H * s);
  const stroke = Math.max(3, Math.round(Math.max(fw, fh) / 400));
  const svg = Buffer.from(
    `<svg width="${fw}" height="${fh}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${Math.round(px.left * s)}" y="${Math.round(px.top * s)}" width="${Math.round(px.width * s)}" height="${Math.round(px.height * s)}"
        fill="rgba(250,204,21,0.06)" stroke="#facc15" stroke-width="${stroke}" stroke-dasharray="${stroke * 4},${stroke * 2}"/>
    </svg>`
  );
  const fullOut = await sharp(buf)
    .rotate()
    .resize({ width: fw, height: fh })
    .composite([{ input: svg, left: 0, top: 0 }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  const preview = await sharp(cropOut).resize({ width: 900, height: 900, fit: "inside" }).jpeg({ quality: 80 }).toBuffer();

  return {
    full: { mimeType: "image/jpeg", data: fullOut.toString("base64") },
    crop: { mimeType: "image/png", data: cropOut.toString("base64") },
    cropPreview: `data:image/jpeg;base64,${preview.toString("base64")}`,
    meta: {
      sourceWidth: W,
      sourceHeight: H,
      cropPx: px,
      priceAxisAppended: appendAxis,
      upscale: Math.round(k * 100) / 100,
      cropOutPx: { width: outW, height: outH },
    },
  };
}
