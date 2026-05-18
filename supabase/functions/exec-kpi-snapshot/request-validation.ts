export type SnapshotRequestBody = {
  organizationId: string;
  snapshotDate?: string;
};

export type SnapshotRequestParseResult =
  | { ok: true; body: SnapshotRequestBody }
  | { ok: false; error: string };

export function parseSnapshotDate(input: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;

  const [yearStr, monthStr, dayStr] = input.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  const roundTrip = parsed.toISOString().slice(0, 10);
  return roundTrip === input ? input : null;
}

export function parseSnapshotRequestBody(input: unknown): SnapshotRequestParseResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Invalid JSON body" };
  }

  const record = input as Record<string, unknown>;
  if (typeof record.organization_id !== "string") {
    return { ok: false, error: "organization_id (uuid) is required" };
  }

  const organizationId = record.organization_id.trim();
  if (!organizationId) {
    return { ok: false, error: "organization_id (uuid) is required" };
  }

  if (record.snapshot_date == null) {
    return { ok: true, body: { organizationId } };
  }

  if (typeof record.snapshot_date !== "string") {
    return { ok: false, error: "snapshot_date must be YYYY-MM-DD" };
  }

  const snapshotDate = parseSnapshotDate(record.snapshot_date.trim());
  if (!snapshotDate) {
    return { ok: false, error: "snapshot_date must be YYYY-MM-DD" };
  }

  return { ok: true, body: { organizationId, snapshotDate } };
}
