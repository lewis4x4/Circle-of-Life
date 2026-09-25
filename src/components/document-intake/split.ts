/**
 * Split pages: every page goes into exactly one part or is explicitly
 * excluded; nothing is silently dropped (mirrors document_intake_prepare_split).
 */

/** Page number → part index (0-based), or "excluded". Unplaced pages are absent. */
export type PageAssignment = Record<number, number | "excluded">;

export type SplitPart = { title: string };

export type SplitPlan = {
  parts: Array<{ pages: number[]; title?: string }>;
  excluded_pages: number[];
};

export type SplitCheck = { ok: true; plan: SplitPlan } | { ok: false; problems: string[] };

/** A reader-proposed segmentation as the starting point, or an empty plan. */
export function assignmentFromSegments(pageCount: number, segments: ReadonlyArray<{ pages: number[] }>): PageAssignment {
  const assignment: PageAssignment = {};
  segments.forEach((segment, index) => {
    for (const page of segment.pages) {
      if (page >= 1 && page <= pageCount && assignment[page] === undefined) assignment[page] = index;
    }
  });
  return assignment;
}

export function checkSplit(pageCount: number, parts: readonly SplitPart[], assignment: PageAssignment): SplitCheck {
  const problems: string[] = [];
  if (pageCount < 2) problems.push("Only documents with two or more pages can be split.");
  const unplaced: number[] = [];
  const pagesByPart = parts.map(() => [] as number[]);
  const excluded: number[] = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const target = assignment[page];
    if (target === undefined) unplaced.push(page);
    else if (target === "excluded") excluded.push(page);
    else if (target >= 0 && target < parts.length) pagesByPart[target].push(page);
    else unplaced.push(page);
  }
  if (unplaced.length) problems.push(`Place every page. Not placed: ${unplaced.join(", ")}.`);
  const emptyParts = pagesByPart.map((pages, index) => (pages.length ? null : index + 1)).filter((n): n is number => n != null);
  if (emptyParts.length) problems.push(`Every part needs at least one page. Empty: part ${emptyParts.join(", part ")}.`);
  if (parts.length < 1) problems.push("Add at least one part.");
  if (parts.length > 50) problems.push("A document can be split into at most 50 parts.");
  if (parts.length === 1 && excluded.length === 0) problems.push("One part with every page is the same document. Add a part or exclude a page.");
  if (parts.some((part) => part.title.trim().length > 200)) problems.push("Part titles must be 200 characters or fewer.");
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    plan: {
      parts: parts.map((part, index) => {
        const title = part.title.trim();
        return title ? { pages: pagesByPart[index], title } : { pages: pagesByPart[index] };
      }),
      excluded_pages: excluded,
    },
  };
}

/** Removing a part unplaces its pages and shifts later parts down by one. */
export function removePart(assignment: PageAssignment, partIndex: number): PageAssignment {
  const next: PageAssignment = {};
  for (const [key, target] of Object.entries(assignment)) {
    const page = Number(key);
    if (target === "excluded") next[page] = target;
    else if (target < partIndex) next[page] = target;
    else if (target > partIndex) next[page] = target - 1;
  }
  return next;
}
