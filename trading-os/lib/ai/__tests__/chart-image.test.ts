import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildZoomImages, regionToPixels, upscaleFactor, readScreenshot } from "../chart-image";

describe("chart-image", () => {
  it("converte região normalizada em píxeis dentro da imagem", () => {
    expect(regionToPixels({ x: 0.5, y: 0.5, w: 0.25, h: 0.25 }, 2000, 1000)).toEqual({ left: 1000, top: 500, width: 500, height: 250 });
    const edge = regionToPixels({ x: 0.99, y: 0.99, w: 0.5, h: 0.5 }, 1000, 1000);
    expect(edge.left + edge.width).toBeLessThanOrEqual(1000);
    expect(edge.width).toBeGreaterThanOrEqual(10);
  });

  it("amplia recortes pequenos até 1536 px (máx 3×) e não amplia os grandes", () => {
    expect(upscaleFactor(768, 400)).toBe(2);
    expect(upscaleFactor(300, 200)).toBe(3);
    expect(upscaleFactor(2000, 1000)).toBe(1);
  });

  it("recorta em resolução nativa, junta o eixo de preço e marca a região no gráfico completo", async () => {
    const src = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#101820" } }).png().toBuffer();
    const out = await buildZoomImages(src, { x: 0.2, y: 0.3, w: 0.3, h: 0.3 });
    expect(out.meta.cropPx).toEqual({ left: 320, top: 270, width: 480, height: 270 });
    expect(out.meta.priceAxisAppended).toBe(true);
    const crop = await sharp(Buffer.from(out.crop.data, "base64")).metadata();
    expect(crop.format).toBe("png");
    expect(Math.max(crop.width!, crop.height!)).toBeGreaterThanOrEqual(1536);
    expect(out.full.mimeType).toBe("image/jpeg");
    expect(out.cropPreview.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("não junta o eixo quando o recorte já chega à margem direita", async () => {
    const src = await sharp({ create: { width: 1000, height: 600, channels: 3, background: "#000" } }).png().toBuffer();
    const out = await buildZoomImages(src, { x: 0.6, y: 0, w: 0.4, h: 0.5 });
    expect(out.meta.priceAxisAppended).toBe(false);
  });

  it("recusa caminhos fora de /screenshots", async () => {
    await expect(readScreenshot("/../lib/db.ts")).rejects.toThrow();
    await expect(readScreenshot("/screenshots/../../.env.local")).rejects.toThrow();
  });
});

describe("eixo de preço marcado pelo trader", () => {
  it("usa a faixa indicada (ex.: eixo à esquerda de um painel) e não duplica quando o recorte já a contém", async () => {
    const src = await sharp({ create: { width: 1800, height: 1000, channels: 3, background: "#000" } }).png().toBuffer();
    const a = await buildZoomImages(src, { x: 0.7, y: 0.3, w: 0.2, h: 0.2 }, { axis: { x: 0.51, w: 0.04 } });
    expect(a.meta.priceAxisAppended).toBe(true);
    const b = await buildZoomImages(src, { x: 0.5, y: 0.3, w: 0.2, h: 0.2 }, { axis: { x: 0.51, w: 0.04 } });
    expect(b.meta.priceAxisAppended).toBe(false);
  });
});
