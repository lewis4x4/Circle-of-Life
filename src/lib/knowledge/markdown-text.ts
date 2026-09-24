/**
 * Knowledge-base text arrives as Markdown written in Obsidian: headings, lists, **bold**,
 * links and `[[wikilinks]]`. Screens showed that syntax as literal characters (COL-689).
 * This module parses it into a small block/inline tree the KB viewer renders as React
 * elements (never HTML strings), and flattens it to plain text for one-line excerpts.
 */

export type MarkdownInline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: MarkdownInline[] }
  | { kind: "em"; children: MarkdownInline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: MarkdownInline[] };

export type MarkdownBlock =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: MarkdownInline[] }
  | { kind: "paragraph"; children: MarkdownInline[] }
  | { kind: "list"; ordered: boolean; items: MarkdownInline[][] }
  | { kind: "quote"; children: MarkdownInline[] }
  | { kind: "code"; text: string };

/** `[[Target]]` -> "Target", `[[Target|Shown]]` -> "Shown", `[[Target#Heading]]` -> "Target". */
export function replaceWikilinks(text: string): string {
  return text.replace(/!?\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) =>
    (alias ?? target).trim(),
  );
}

/** Only web links and in-app paths become links; anything else stays text. */
function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^https?:\/\//i.test(href) || /^\/(?!\/)/.test(href)) return href;
  return null;
}

// 1 strong, 2 em, 3 code, 4 link label, 5 link href, 6+7 __strong__, 8+9 _em_ (6/8 keep the
// character before the underscore so snake_case words are not read as emphasis).
const INLINE =
  /\*\*(.+?)\*\*|\*(\S(?:.*?\S)?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(^|[^\w])__(.+?)__(?!\w)|(^|[^\w])_(\S(?:.*?\S)?)_(?!\w)/;

export function parseInline(source: string): MarkdownInline[] {
  const text = replaceWikilinks(source);
  const out: MarkdownInline[] = [];
  let rest = text;
  while (rest.length > 0) {
    const match = INLINE.exec(rest);
    if (!match) {
      out.push({ kind: "text", text: rest });
      break;
    }
    const prefix = match[6] ?? match[8] ?? "";
    const before = rest.slice(0, match.index) + prefix;
    if (before) out.push({ kind: "text", text: before });
    const strong = match[1] ?? match[7];
    const em = match[2] ?? match[9];
    if (strong !== undefined) out.push({ kind: "strong", children: parseInline(strong) });
    else if (em !== undefined) out.push({ kind: "em", children: parseInline(em) });
    else if (match[3] !== undefined) out.push({ kind: "code", text: match[3] });
    else {
      const href = safeHref(match[5] ?? "");
      const children = parseInline(match[4] ?? "");
      if (href) out.push({ kind: "link", href, children });
      else out.push(...children);
    }
    rest = rest.slice(match.index + match[0].length);
  }
  return out;
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  // Obsidian front matter (`---` ... `---` at the top) is metadata, not content.
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, idx) => idx > 0 && l.trim() === "---");
    if (end > 0) lines.splice(0, end + 1);
  }
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", children: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    if (trimmed === "") {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(trimmed);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6, children: parseInline(heading[2]) });
      continue;
    }
    const bullet = /^[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      flush();
      const ordered = Boolean(numbered);
      const items: MarkdownInline[][] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        const m = ordered ? /^\d+[.)]\s+(.*)$/.exec(t) : /^[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(t);
        if (!m) break;
        items.push(parseInline(m[1]));
        i++;
      }
      i--;
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    if (trimmed.startsWith(">")) {
      flush();
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) quote.push(lines[i++].trim().replace(/^>\s?/, ""));
      i--;
      blocks.push({ kind: "quote", children: parseInline(quote.join(" ")) });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      continue;
    }
    paragraph.push(trimmed);
  }
  flush();
  return blocks;
}

function inlineText(nodes: MarkdownInline[]): string {
  return nodes
    .map((node) => (node.kind === "text" || node.kind === "code" ? node.text : inlineText(node.children)))
    .join("");
}

/** One-line plain text for excerpts and summaries: no `#`, `**`, `[[ ]]` or link syntax. */
export function markdownToPlainText(source: string | null | undefined): string {
  if (!source) return "";
  return parseMarkdown(source)
    .map((block) => {
      if (block.kind === "code") return block.text;
      if (block.kind === "list") return block.items.map(inlineText).join("; ");
      return inlineText(block.children);
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
