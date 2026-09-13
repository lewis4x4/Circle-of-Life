import { csvEscapeCell } from "@/lib/csv-export";
import type { OperationsActor } from "@/lib/operations/auth";

export type HistoryExportManifest = {
  schema_version: 1; generated_at: string; snapshot_id: string;
  filters: { facility_id: string; activity_id: string };
  total: number; receipt_total: number; evidence_total: number; complete: true; source: string; coverage: string;
};
export type HistoryExportRow = {
  id: string; subject_id: string | null; authority_class: string; activity_name: string;
  status: string; created_at: string; receipts: Record<string, unknown>[];
  evidence: Record<string, unknown>[]; source_events: Record<string, unknown>[];
  [key: string]: unknown;
};
export type HistoryExportPage = { export_id: string; manifest: HistoryExportManifest; offset: number; rows: HistoryExportRow[]; next_offset: number | null };
export class HistoryExportError extends Error {
  constructor(message: string, public status: number = 503) { super(message); }
}
export async function historyExportRpc(actor: OperationsActor, name: "create_operation_history_export" | "read_operation_history_export", args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await actor.currentActor.client.rpc(name as never, args as never);
  if (error || !data) throw new HistoryExportError(
    error?.code === "42501" ? "Export is no longer accessible" : error?.code === "23505" ? "Export request conflicts with its original filters" : "Export unavailable; retry the same request",
    error?.code === "42501" ? 403 : error?.code === "23505" ? 409 : 503);
  return data;
}
export function validManifest(value: unknown): value is HistoryExportManifest {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<HistoryExportManifest>;
  return v.schema_version === 1 && v.complete === true && typeof v.snapshot_id === "string"
    && typeof v.generated_at === "string" && Number.isFinite(Date.parse(v.generated_at))
    && typeof v.filters?.facility_id === "string" && typeof v.filters.activity_id === "string"
    && [v.total, v.receipt_total, v.evidence_total].every(n => Number.isSafeInteger(n) && Number(n) >= 0)
    && typeof v.source === "string" && typeof v.coverage === "string";
}
export async function collectHistoryExport(read: (offset: number) => Promise<unknown>, exportId: string) {
  const rows: HistoryExportRow[] = [], ids = new Set<string>();
  let manifest: HistoryExportManifest | undefined;
  let offset = 0;
  for (;;) {
    const raw = await read(offset);
    if (!raw || typeof raw !== "object") throw new HistoryExportError("Incomplete export; retry download");
    const page = raw as HistoryExportPage;
    if (page.export_id !== exportId || page.offset !== offset || !validManifest(page.manifest) || !Array.isArray(page.rows)
      || (manifest && JSON.stringify(page.manifest) !== JSON.stringify(manifest))) throw new HistoryExportError("Export manifest mismatch; retry download");
    manifest ??= page.manifest;
    for (const row of page.rows) {
      if (!row || typeof row.id !== "string" || ids.has(row.id) || !Array.isArray(row.receipts) || !Array.isArray(row.evidence)
        || !Array.isArray(row.source_events)) throw new HistoryExportError("Incomplete export; retry download");
      ids.add(row.id); rows.push(row);
    }
    offset += page.rows.length;
    if (offset > manifest.total || (page.next_offset !== null && (page.rows.length === 0 || page.next_offset !== offset))) throw new HistoryExportError("Incomplete export; retry download");
    if (page.next_offset === null) break;
  }
  if (rows.length !== manifest.total || rows.reduce((sum, row) => sum + row.receipts.length, 0) !== manifest.receipt_total
    || rows.reduce((sum, row) => sum + row.evidence.length, 0) !== manifest.evidence_total) throw new HistoryExportError("Export totals do not reconcile; retry download");
  return { manifest, rows };
}

/** A manifest row makes an authorized empty export explicit. JSON columns retain full provenance without CSV flattening loss. */
export function historyExportCsv(manifest: HistoryExportManifest, rows: HistoryExportRow[]): string {
  const cell = (value: string) => csvEscapeCell(/^[\s\u0000-\u001f]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value);
  const lines = [["row_type", "occurrence_id", "activity_name", "status", "created_at", "occurrence", "receipts", "evidence_references", "source_events", "manifest"]];
  lines.push(["manifest", "", "", "", "", "", "", "", "", JSON.stringify(manifest)]);
  for (const row of rows) {
    const { receipts, evidence, source_events, ...occurrence } = row;
    lines.push(["occurrence", row.id, row.activity_name, row.status, row.created_at, JSON.stringify(occurrence), JSON.stringify(receipts), JSON.stringify(evidence), JSON.stringify(source_events), ""]);
  }
  return lines.map(line => line.map(cell).join(",")).join("\r\n") + "\r\n";
}
