import type { Phase1TemplateSeed } from "@/lib/reports/templates";
import { PHASE1_TEMPLATE_SEED } from "@/lib/reports/templates";

export type HavenInsightRankedTemplate = {
  slug: string;
  name: string;
  confidence: number;
  seed: Phase1TemplateSeed;
  rawScore: number;
};

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "were",
  "been",
  "have",
  "has",
  "who",
  "what",
  "when",
  "show",
  "your",
  "into",
  "than",
  "them",
  "their",
  "would",
  "could",
  "about",
  "there",
  "want",
  "needs",
  "these",
  "those",
  "need",
  "you",
  "how",
  "many",
  "much",
  "does",
  "did",
  "are",
  "was",
  "all",
  "our",
  "any",
  "can",
  "get",
  "got",
  "not",
  "but",
  "its",
  "over",
  "per",
]);

function tokenizeQuestion(q: string): string[] {
  return Array.from(new Set(q.toLowerCase().split(/\W+/u).filter(Boolean)))
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function slugTokens(slug: string): string[] {
  return slug.split("-").flatMap((p) =>
    p
      .split(/(?=[A-Z])/g)
      .map((x) => x.toLowerCase())
      .filter((x) => x.length > 2),
  );
}

function phraseBoost(queryLower: string, template: Phase1TemplateSeed): number {
  let b = 0;
  const slug = template.slug;

  if (/\b(?:fall|falls|incident)/.test(queryLower) && slug === "incident-trend-summary") b += 18;
  if (/\b(?:occupan|census|admiss|discharge)/.test(queryLower) && slug === "occupancy-census-summary")
    b += 18;
  if (
    /\b(?:care\s*plan|plan\s*review|which\s+residents|rounding\b|rounding\s*checks?)/.test(queryLower) &&
    slug === "resident-assurance-rounding-compliance"
  )
    b += 18;
  if (
    /\b(?:labor|labour)\s+(?:cost|trend)s?\b|\b(?:labor|labour)\s+pressure\b|payroll|overtime|hours?\b/.test(queryLower) &&
    slug === "overtime-labor-pressure"
  )
    b += 18;
  if (/\b(?:staffing|coverage|shift)/.test(queryLower) && slug === "staffing-coverage-by-shift") b += 14;
  if (/\bar\b|\bag(?:e)?ing\b|receivable|billing|payer\b|collections?/.test(queryLower) && slug === "ar-aging-summary")
    b += 16;
  if (/\bm(?:ed(?:ication)?|mar)\b|\berror\b|\bexceptions?\b/.test(queryLower) && slug === "medication-exception-report")
    b += 14;
  if (/\brevenue\b|scorecard|operating/.test(queryLower) && slug === "facility-operating-scorecard") b += 12;
  if (
    /\brevenue\b|finance|\bfinancial\b|cfo\b|board\b/.test(queryLower) &&
    slug === "executive-weekly-operating-pack"
  )
    b += 10;

  return b;
}

function scoreTemplate(queryRaw: string, words: string[], template: Phase1TemplateSeed): number {
  const qNorm = queryRaw.trim().toLowerCase();
  let raw = 0;
  const nameLower = template.name.toLowerCase();
  const descLower = template.description.toLowerCase();
  const tagHay = template.tags.join(" ").toLowerCase();
  const slugPieces = slugTokens(template.slug);
  const slugHay = template.slug.replace(/-/g, " ");

  for (const w of words) {
    if (slugHay.includes(w) || slugPieces.some((s) => s.includes(w) || w.includes(s))) raw += 4;
    else if (nameLower.includes(w)) raw += 3;
    else if (descLower.includes(w)) raw += 2;
    else if (tagHay.includes(w)) raw += 1.5;
  }

  if (nameLower.includes(qNorm) || template.tags.some((tag) => qNorm.includes(tag.toLowerCase())))
    raw += 8;

  raw += phraseBoost(qNorm, template);

  return raw;
}

function normalizeConfidence(wordsLen: number, rawScores: number[]): number[] {
  const maxCandidate = Math.max(...rawScores);
  const denom = Math.max(wordsLen > 0 ? wordsLen * 8 : 12, maxCandidate || 12, 1);
  return rawScores.map((r) =>
    denom > 0 ? Math.min(100, Math.round((r / denom) * 100)) : 0,
  );
}

export type HavenInsightMatchOutcome =
  | {
      variant: "match";
      templateCount: number;
      query: string;
      best: HavenInsightRankedTemplate;
      runnersUp: HavenInsightRankedTemplate[];
    }
  | {
      variant: "no_match";
      templateCount: number;
      query: string;
      highestConfidence: number;
      closest: Pick<HavenInsightRankedTemplate, "name" | "slug" | "confidence">[];
    };

/** Strong match threshold: below this yields the no-match UX (with closest options). */
const STRONG_MATCH_MIN = 50;

export function matchHavenInsightTemplates(queryRaw: string): HavenInsightMatchOutcome {
  const q = queryRaw.trim();
  const words = tokenizeQuestion(q);

  const seedWithScores = PHASE1_TEMPLATE_SEED.map((template) => {
    const raw =
      words.length > 0 ? scoreTemplate(q, words, template) : phraseBoost(q.toLowerCase(), template);

    return { seed: template, rawScore: raw };
  });

  const rawScores = seedWithScores.map((s) => s.rawScore);
  const pct = normalizeConfidence(words.length || 1, rawScores);

  const ranked: HavenInsightRankedTemplate[] = seedWithScores.map(({ seed, rawScore }, i) => ({
    slug: seed.slug,
    name: seed.name,
    confidence: pct[i],
    seed,
    rawScore,
  }));

  ranked.sort((a, b) => b.confidence - a.confidence || b.rawScore - a.rawScore);

  const templateCount = PHASE1_TEMPLATE_SEED.length;

  if (!ranked[0] || ranked[0].rawScore <= 0) {
    const topTwo = ranked.slice(0, 2).filter((r) => r.name);
    return {
      variant: "no_match",
      templateCount,
      query: q,
      highestConfidence: ranked[0]?.confidence ?? 0,
      closest: topTwo.map((r) => ({ slug: r.slug, name: r.name, confidence: r.confidence })),
    };
  }

  const [first, ...rest] = ranked;
  if (!first) {
    return {
      variant: "no_match",
      templateCount,
      query: q,
      highestConfidence: 0,
      closest: [],
    };
  }

  if (first.confidence >= STRONG_MATCH_MIN) {
    const runnersUp = rest.filter((r) => r.confidence >= 35).slice(0, 6);
    return {
      variant: "match",
      templateCount,
      query: q,
      best: first,
      runnersUp,
    };
  }

  const closest = ranked.slice(0, 3).map((r) => ({
    slug: r.slug,
    name: r.name,
    confidence: r.confidence,
  }));

  return {
    variant: "no_match",
    templateCount,
    query: q,
    highestConfidence: first.confidence,
    closest: closest.slice(0, 2),
  };
}
