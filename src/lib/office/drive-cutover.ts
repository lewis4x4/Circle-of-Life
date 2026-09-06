/** F0-5 ratified hard cutoff — Drive goes read-only, Haven is system of record. */
export const DRIVE_CUTOFF_DATE = "2026-07-01";

export const CUTOVER_ATTEST_ROLES = ["owner", "org_admin", "facility_admin"];

export type CutoverAttestationRow = {
  id: string;
  cutoff_date: string;
  drive_set_readonly: boolean;
  notes: string | null;
  attested_by: string;
  attested_at: string;
};

export type ImportRollup = {
  batches: number;
  files: number;
  imported: number;
  verified?: number;
  pending: number;
  mapped: number;
  failed: number;
  skipped: number;
};

export type QueryError = { message: string };
export type QueryResult<T> = { data: T[] | null; error: QueryError | null };

export function canAttest(role: string | null): boolean {
  return role !== null && CUTOVER_ATTEST_ROLES.includes(role);
}

/** Whole days from today (ET-naive UTC date math) until the cutoff. */
export function daysUntilCutoff(cutoff: string = DRIVE_CUTOFF_DATE, now: Date = new Date()): number {
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`).getTime();
  const target = new Date(`${cutoff}T00:00:00Z`).getTime();
  return Math.round((target - today) / 86400000);
}

/** Bookmark status and skips cannot establish copied, verified content. */
export function migrationComplete(rollup: ImportRollup): boolean {
  return rollup.files > 0 && rollup.verified === rollup.files && rollup.skipped === 0 && rollup.pending === 0 && rollup.mapped === 0 && rollup.failed === 0;
}

export function rollupFromStatuses(statuses: string[]): Omit<ImportRollup, "batches"> {
  const r = { files: statuses.length, imported: 0, pending: 0, mapped: 0, failed: 0, skipped: 0 };
  for (const s of statuses) {
    if (s === "imported") r.imported += 1;
    else if (s === "pending") r.pending += 1;
    else if (s === "mapped") r.mapped += 1;
    else if (s === "failed") r.failed += 1;
    else if (s === "skipped") r.skipped += 1;
  }
  return r;
}
