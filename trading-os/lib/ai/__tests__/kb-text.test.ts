import { describe, expect, it } from "vitest";
import { bm25Search, chunkMarkdown, extractDailyReportCard, markdownToChunks, tokenize } from "../kb-text";

const EMPTY_DRC = `---
Title: Daily Report Card
Date:
Grade:
---
- [ ] Trade ONLY from Playbook;

| **Segment** | **Grade** | **PTD Only** |
| ----------- | --------- | ------------ |
| Temp        |           |              |

WHAT I LEARNED / IMPROVED UPON TODAY:

CHANGES I NEED TO MAKE FROM TODAY:

OVERVIEW:

EASIEST 100€:

| Name | Time | Entry setup | Type | Average | Size | Profit | Comments |
| ---- | ---- | ----------- | ---- | ------- | ---- | ------ | -------- |
|      |      |             |      |         |      |        |          |
`;

describe("Daily Report Card", () => {
  it("ignora templates vazios", () => {
    expect(extractDailyReportCard(EMPTY_DRC)).toBeNull();
    expect(markdownToChunks("vault/2025-01-16.md", EMPTY_DRC)).toEqual([]);
  });

  it("extrai aprendizagens e trades de um DRC preenchido", () => {
    const filled = EMPTY_DRC.replace("Grade:", "Grade: B")
      .replace("WHAT I LEARNED / IMPROVED UPON TODAY:\n", "WHAT I LEARNED / IMPROVED UPON TODAY:\nEntrei antes do CHoCH no M5.\n")
      .replace("|      |      |             |      |         |      |        |          |", "| XAUUSD | 09:40 | Sweep PDL + OB | Day | 2381 | 0.1 | -50 | cedo |");
    const txt = extractDailyReportCard(filled)!;
    expect(txt).toMatch(/Nota: B/);
    expect(txt).toMatch(/Entrei antes do CHoCH/);
    expect(txt).toMatch(/XAUUSD \| 09:40 \| Sweep PDL \+ OB/);
    const chunks = markdownToChunks("vault/2025-01-17.md", filled);
    expect(chunks[0].kind).toBe("drc");
  });
});

describe("chunking e pesquisa", () => {
  it("divide por cabeçalhos e limpa sintaxe Obsidian", () => {
    const md = "# Acumulação\nTexto sobre Spring e SC ![[acumulação.png]] ver [[Fundos válidos]].\n\n# Distribuição\nUTAD e LPSY no topo do range.";
    const chunks = markdownToChunks("knowledge/wyckoff.md", md);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].images).toEqual(["acumulação.png"]);
    expect(chunks[0].text).toContain("(imagem: acumulação.png)");
    expect(chunks[0].text).toContain("Fundos válidos");
    expect(chunks[0].tags).toContain("wyckoff");
  });

  it("corta secções longas sem partir parágrafos", () => {
    const para = "palavra ".repeat(100).trim();
    const out = chunkMarkdown(`# T\n${[para, para, para].join("\n\n")}`, 1000);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) expect(c.text.length).toBeLessThanOrEqual(1100);
  });

  it("tokeniza sem acentos e encontra por sinónimo", () => {
    expect(tokenize("Acumulação e Distribuição")).toEqual(["acumulacao", "distribuicao"]);
    const docs = [
      { title: "Order Blocks", text: "Última vela contrária antes do deslocamento.", tags: ["smc"] },
      { title: "Volume", text: "Esforço vs resultado.", tags: ["volume"] },
    ];
    const hits = bm25Search(docs, "OB");
    expect(hits[0].item.title).toBe("Order Blocks");
  });
});
