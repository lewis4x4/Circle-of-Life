/**
 * Quiet Operator copy for KB seed-target rollup (`/admin/knowledge/seed-targets`).
 * Missing coverage % names the gap — never a silent em dash. Real zero stays `0%`.
 */

export const SEED_TARGETS_NO_COVERAGE_COPY = "No coverage posted";

/** Seed-target rollup coverage % — null/undefined get explicit copy; numeric zero stays `0%`. */
export function formatSeedTargetCoveragePct(coveredPct: number | null | undefined): string {
  if (coveredPct == null) return SEED_TARGETS_NO_COVERAGE_COPY;
  return `${coveredPct}%`;
}

export type SeedTargetEffectiveStatus = "uncovered" | "wip" | "covered" | "retired";

/**
 * Status buttons a topic offers (COL-710). "Covered" is never set by hand: it
 * follows from a linked published document. Global default topics carry no
 * editable status at all; only org topics can be marked in progress or
 * retired.
 */
export function seedTargetStatusActions(input: {
  isGlobal: boolean;
  storedStatus: SeedTargetEffectiveStatus;
}): Array<"uncovered" | "wip" | "retired"> {
  if (input.isGlobal) return [];
  const current = input.storedStatus === "covered" ? "uncovered" : input.storedStatus;
  return (["uncovered", "wip", "retired"] as const).filter((s) => s !== current);
}

/**
 * Published documents an owner may link to a topic: not deleted, published,
 * and not already linked to it.
 */
export function linkableDocuments<T extends { id: string; status: string; deleted_at?: string | null }>(
  documents: readonly T[],
  alreadyLinked: ReadonlySet<string>,
): T[] {
  return documents.filter((d) => d.status === "published" && !d.deleted_at && !alreadyLinked.has(d.id));
}
