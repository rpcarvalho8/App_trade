/**
 * Parser RSS 2.0 / Atom mínimo, sem dependências.
 * Só extrai o que o motor de notícias precisa: título, link, id e data.
 */
export interface FeedItem {
  id: string;
  title: string;
  link: string;
  /** epoch ms; NaN se a data não for legível */
  publishedAt: number;
  summary: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

export function decodeText(raw: string): string {
  let s = raw.trim();
  const cdata = s.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) s = cdata[1];
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith("#") && k !== "#39") return String.fromCodePoint(parseInt(k.slice(1), 10));
    return ENTITIES[k] ?? m;
  });
  return s.replace(/\s+/g, " ").trim();
}

function tag(block: string, name: string): string | null {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
  const m = block.match(re);
  return m ? m[1] : null;
}

function atomLink(block: string): string | null {
  const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (alt) return alt[1];
  const any = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return any ? any[1] : null;
}

export function parseFeed(xml: string): FeedItem[] {
  const out: FeedItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const b of blocks) {
    const title = decodeText(tag(b, "title") ?? "");
    if (!title) continue;
    const linkRaw = tag(b, "link");
    const link = decodeText(linkRaw && linkRaw.trim() ? linkRaw : atomLink(b) ?? "");
    const guid = decodeText(tag(b, "guid") ?? tag(b, "id") ?? "");
    const dateRaw = tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date") ?? "";
    const summary = decodeText(tag(b, "description") ?? tag(b, "summary") ?? "").slice(0, 400);
    out.push({
      id: guid || link || title,
      title,
      link,
      publishedAt: Date.parse(decodeText(dateRaw)),
      summary,
    });
  }
  return out;
}
