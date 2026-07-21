/**
 * Conversor Markdown -> HTML nativo (sem dependências externas).
 *
 * Cobre exatamente o subconjunto de Markdown produzido pelo Morning Brief:
 *   - títulos # ## ###
 *   - blockquote >
 *   - listas não ordenadas (-)
 *   - tabelas GFM (| a | b |)
 *   - linha horizontal ---
 *   - inline: **negrito**, `código`, _ênfase_
 *
 * Evita a dependência `marked` (que causava "Module not found" quando o
 * node_modules não estava sincronizado após um git pull).
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Formatação inline: negrito, código e ênfase. Assume texto já escapado. */
function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])_([^_]+)_(?=$|[\s).,;:])/g, "$1<em>$2</em>");
}

function isTableSep(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

function splitRow(line: string): string[] {
  let l = line.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|")) l = l.slice(0, -1);
  return l.split("|").map((c) => c.trim());
}

export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  const flushListIfOpen = (open: boolean) => {
    if (open) out.push("</ul>");
    return false;
  };

  let listOpen = false;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // linha em branco
    if (trimmed === "") {
      listOpen = flushListIfOpen(listOpen);
      i++;
      continue;
    }

    // linha horizontal
    if (/^-{3,}$/.test(trimmed)) {
      listOpen = flushListIfOpen(listOpen);
      out.push("<hr />");
      i++;
      continue;
    }

    // títulos
    const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      listOpen = flushListIfOpen(listOpen);
      const level = h[1].length;
      out.push(`<h${level}>${inline(escapeHtml(h[2]))}</h${level}>`);
      i++;
      continue;
    }

    // blockquote (linhas consecutivas com >)
    if (/^>\s?/.test(trimmed)) {
      listOpen = flushListIfOpen(listOpen);
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${buf.map((b) => inline(escapeHtml(b))).join("<br />")}</blockquote>`);
      continue;
    }

    // tabela: linha de cabeçalho seguida de separador
    if (trimmed.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      listOpen = flushListIfOpen(listOpen);
      const header = splitRow(lines[i]);
      i += 2; // salta cabeçalho + separador
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const thead = `<thead><tr>${header.map((c) => `<th>${inline(escapeHtml(c))}</th>`).join("")}</tr></thead>`;
      const tbody = `<tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(escapeHtml(c))}</td>`).join("")}</tr>`)
        .join("")}</tbody>`;
      out.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    // itens de lista
    if (/^[-*]\s+/.test(trimmed)) {
      if (!listOpen) {
        out.push("<ul>");
        listOpen = true;
      }
      out.push(`<li>${inline(escapeHtml(trimmed.replace(/^[-*]\s+/, "")))}</li>`);
      i++;
      continue;
    }

    // parágrafo (junta linhas consecutivas "normais")
    listOpen = flushListIfOpen(listOpen);
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6})\s+/.test(lines[i].trim()) &&
      !/^>\s?/.test(lines[i].trim()) &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^-{3,}$/.test(lines[i].trim()) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]))
    ) {
      para.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${inline(escapeHtml(para.join(" ")))}</p>`);
  }

  flushListIfOpen(listOpen);
  return out.join("\n");
}
