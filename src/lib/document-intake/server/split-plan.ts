import { z } from "zod";

/**
 * Early, local check of a split plan: no page may appear twice across the parts
 * and the excluded list. The RPC is the authority (it also checks that every
 * page of the document is placed); this only turns an obvious mistake into a
 * clear 400 before anything is written.
 */
export function splitPlanProblem(parts: readonly { pages: readonly number[] }[], excluded: readonly number[], pageCount?: number | null) {
  const seen = new Set<number>();
  for (const page of [...parts.flatMap((part) => part.pages), ...excluded]) {
    if (seen.has(page)) return `Page ${page} is placed more than once`;
    seen.add(page);
  }
  if (pageCount != null) {
    const outside = [...seen].find((page) => page > pageCount);
    if (outside != null) return `Page ${outside} is past the end of the document`;
    if (seen.size !== pageCount) return "Every page must be in exactly one part or excluded";
  }
  return null;
}

export const prepareSplitResultSchema = z.object({
  parent_revision: z.string().uuid(),
  children: z.array(z.object({
    item_id: z.string().uuid(),
    path: z.string().min(1),
    pages: z.array(z.number().int().positive()).min(1),
  })).min(1),
}).passthrough();
export type PrepareSplitResult = z.infer<typeof prepareSplitResultSchema>;
