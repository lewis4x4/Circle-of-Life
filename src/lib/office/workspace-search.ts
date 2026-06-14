export type SearchablePage = {
  id: string;
  title: string;
  body: string;
  updated_at: string;
};

export type RankedPage = {
  page: SearchablePage;
  score: number;
  snippet: string;
};

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "was", "were",
  "my", "me", "i", "do", "does", "what", "when", "where", "who", "how", "about", "with", "that",
  "this", "it", "be", "as", "at", "by", "from", "have", "has", "did", "any", "can",
]);

/** Tokenize into lowercase content terms (drops stop words + short tokens). */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** Build a short snippet around the first matching term. */
export function buildSnippet(body: string, terms: string[], maxLen = 200): string {
  if (!body.trim()) return "";
  const lower = body.toLowerCase();
  let idx = -1;
  for (const t of terms) {
    const found = lower.indexOf(t);
    if (found >= 0 && (idx < 0 || found < idx)) idx = found;
  }
  if (idx < 0) return body.slice(0, maxLen).trim() + (body.length > maxLen ? "…" : "");
  const start = Math.max(0, idx - 60);
  const end = Math.min(body.length, idx + maxLen - 60);
  return (start > 0 ? "…" : "") + body.slice(start, end).trim() + (end < body.length ? "…" : "");
}

/** Rank pages by term-overlap of the query against title (weighted) + body. */
export function rankPages(pages: SearchablePage[], query: string, limit = 5): RankedPage[] {
  const terms = Array.from(new Set(tokenize(query)));
  if (terms.length === 0) return [];
  const ranked: RankedPage[] = [];
  for (const page of pages) {
    const titleTokens = new Set(tokenize(page.title));
    const bodyTokens = tokenize(page.body);
    const bodyCounts = new Map<string, number>();
    for (const t of bodyTokens) bodyCounts.set(t, (bodyCounts.get(t) ?? 0) + 1);
    let score = 0;
    for (const term of terms) {
      if (titleTokens.has(term)) score += 5;
      score += bodyCounts.get(term) ?? 0;
    }
    if (score > 0) {
      ranked.push({ page, score, snippet: buildSnippet(page.body, terms) });
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}
