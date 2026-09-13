"use client";

import { useEffect, useRef, useState } from "react";
import { triggerCsvDownload } from "@/lib/csv-export";
import { CONTROL } from "../work/_components/work-inputs";

type ExportSnapshot = {
  export_id: string;
  manifest: {
    complete: true;
    generated_at: string;
    total: number;
    receipt_total: number;
    evidence_total: number;
    filters: { facility_id: string; activity_id: string };
  };
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mounted per person/facility/activity; no protected export is retained in browser storage. */
export function ActivityHistoryExport({ facilityId, activityId }: {
  facilityId: string;
  activityId: string;
}) {
  const [snapshot, setSnapshot] = useState<ExportSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [downloaded, setDownloaded] = useState(false);
  const requestId = useRef<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function download(fresh = false) {
    if (pending.current && !pending.current.signal.aborted) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setDownloaded(false);
    if (fresh) {
      requestId.current = null;
      setSnapshot(null);
    }
    try {
      let current = fresh ? null : snapshot;
      const options = { cache: "no-store" as const, credentials: "same-origin" as const, signal: controller.signal };
      if (!current) {
        requestId.current ??= crypto.randomUUID();
        const response = await fetch("/api/admin/operations/activity-history/exports", {
          ...options,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ facility_id: facilityId, activity_id: activityId, request_id: requestId.current }),
        });
        if (!response.ok) throw new Error(response.status === 403 || response.status === 404 || response.status === 401
          ? "This export is no longer accessible. Sign in with an authorized account and retry."
          : "The export could not be prepared. Retry to recover the same request.");
        const result = await response.json() as ExportSnapshot;
        if (!UUID.test(result?.export_id) || result?.manifest?.complete !== true
          || result.manifest.filters?.facility_id !== facilityId || result.manifest.filters?.activity_id !== activityId
          || ![result.manifest.total, result.manifest.receipt_total, result.manifest.evidence_total].every((count) => Number.isSafeInteger(count) && count >= 0)
          || !Number.isFinite(Date.parse(result.manifest.generated_at))) {
          throw new Error("The export could not be verified. No file was saved.");
        }
        if (controller.signal.aborted) return;
        current = result;
        setSnapshot(current);
      }
      const response = await fetch(`/api/admin/operations/activity-history/exports/${current.export_id}/download`, options);
      if (!response.ok) throw new Error(response.status === 403 || response.status === 404 || response.status === 401
        ? "This export is no longer accessible. No file was saved."
        : "The complete export could not be retrieved. Retry this snapshot; no file was saved.");
      if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("text/csv")) {
        throw new Error("The download was not a verified CSV file. No file was saved.");
      }
      const csv = await response.text();
      if (!csv.trim()) throw new Error("The export manifest was missing. No file was saved.");
      if (controller.signal.aborted) return;
      triggerCsvDownload(`haven-activity-history-${current.export_id}.csv`, csv);
      setDownloaded(true);
    } catch (reason: unknown) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Export unavailable. No file was saved.");
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setBusy(false);
      }
    }
  }

  return <section aria-label="Export activity history" className="space-y-2 rounded-md border border-border bg-background p-4">
    <h2 className="font-semibold">Export complete activity history</h2>
    <p>Includes every permitted occurrence and correction for this facility and activity, across all pages. Supporting files remain protected and are referenced in the export.</p>
    <button type="button" className={CONTROL} disabled={busy} onClick={() => void download(downloaded)}>
      {busy ? "Preparing complete export…" : error ? "Retry export" : downloaded ? "Export a fresh snapshot" : "Download complete CSV"}
    </button>
    {busy ? <p role="status">Checking the full export and current access before saving the file…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {downloaded && snapshot ? <p role="status">
      Downloaded complete snapshot: {snapshot.manifest.total} occurrences, {snapshot.manifest.receipt_total} receipts and {snapshot.manifest.evidence_total} evidence references.
      {snapshot.manifest.total === 0 ? " Confirmed empty history for this selection." : ""}
      {" "}Snapshot generated {snapshot.manifest.generated_at}. Later changes require a fresh export.
    </p> : null}
  </section>;
}
