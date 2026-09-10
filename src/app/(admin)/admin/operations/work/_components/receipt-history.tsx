"use client";

import { useEffect, useRef, useState } from "react";
import { SeverityChip } from "@/design-system/components/SeverityChip";
import type { WorkspaceReceipt } from "@/lib/operations/workspace";
import { CONTROL } from "./work-inputs";

export async function readJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      typeof body.error === "string" ? body.error : "Details unavailable",
    );
  return body;
}
export function localTime(value: unknown, timezone: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)))
    return "time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
export function ReceiptSummary({
  receipt,
  actorId,
  actorName,
  timezone,
  replayed = false,
}: {
  receipt: WorkspaceReceipt;
  actorId: string;
  actorName: string | null;
  timezone: string;
  replayed?: boolean;
}) {
  const recorder =
    typeof receipt.recorder_name === "string"
      ? receipt.recorder_name
      : receipt.recorder_id === actorId && actorName
        ? actorName
        : String(receipt.recorder_id ?? "person unavailable");
  return (
    <div className="space-y-1 text-sm">
      <p>
        Recorded by {recorder} at {localTime(receipt.recorded_at, timezone)} (
        {timezone}){replayed ? " · already saved" : ""}
      </p>
      <p>
        Outcome:{" "}
        {receipt.outcome ?? String(receipt.receipt_kind ?? "unavailable")}
      </p>
      <p>
        Evidence:{" "}
        {receipt.evidence_status_current ??
          receipt.evidence_status ??
          "unavailable"}
      </p>
      <p>Receipt state: {String(receipt.completion_state ?? "unavailable")}</p>
      {receipt.performed_at ? (
        <p>
          Performed at {localTime(receipt.performed_at, timezone)} ({timezone})
        </p>
      ) : null}
      {receipt.performer_kind ? (
        <p>
          Performer: {String(receipt.performer_kind)}
          {receipt.performer_label ||
          receipt.performer_user_id ||
          receipt.performer_vendor_id
            ? ` · ${String(receipt.performer_label ?? receipt.performer_user_id ?? receipt.performer_vendor_id)}`
            : ""}
        </p>
      ) : null}
      {receipt.values && typeof receipt.values === "object" ? (
        <dl aria-label="Recorded values">
          {Object.entries(receipt.values).map(([key, value]) => (
            <div key={key}>
              <dt className="font-medium">{key}</dt>
              <dd>{String(value ?? "Not entered")}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {typeof receipt.note === "string" && receipt.note ? (
        <p>Note: {receipt.note}</p>
      ) : null}
    </div>
  );
}

function EvidenceHistory({ receiptId }: { receiptId: string }) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function download(id: string) {
    setDownloading(id);
    setDownloadError("");
    try {
      const body = await readJson(
        `/api/admin/operations/evidence/${encodeURIComponent(id)}/download`,
      );
      if (!active.current) return;
      const result = body.download as { signedUrl?: string } | undefined;
      if (!result?.signedUrl || !/^https?:\/\//.test(result.signedUrl))
        throw new Error("Download unavailable");
      window.open(result.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      if (active.current) setDownloadError("Evidence download unavailable");
    } finally {
      if (active.current) setDownloading(null);
    }
  }
  useEffect(() => {
    let active = true;
    void readJson(
      `/api/admin/operations/evidence?receipt_id=${encodeURIComponent(receiptId)}`,
    )
      .then((body) => {
        if (active) setRows(Array.isArray(body.evidence) ? body.evidence : []);
      })
      .catch(() => {
        if (active) setError("Evidence unavailable");
      });
    return () => {
      active = false;
    };
  }, [receiptId]);
  return (
    <div>
      {downloadError ? <p role="alert">{downloadError}</p> : null}
      {error ? (
        <p role="alert">{error}</p>
      ) : rows === null ? (
        <p role="status">Loading evidence…</p>
      ) : rows.length === 0 ? (
        <p>No attached evidence.</p>
      ) : (
        <ul aria-label="Attached evidence">
          {rows.map((row) => (
            <li key={String(row.id)}>
              {String(row.rule_label ?? row.evidence_kind ?? "Evidence")} ·{" "}
              {row.state === "finalized"
                ? "Attached"
                : `Not attached · ${String(row.state ?? "status unavailable")}`}
              {row.evidence_kind === "linked_record" ? (
                <p>
                  Linked record:{" "}
                  {String(row.linked_table ?? "source unavailable")} ·{" "}
                  {String(row.linked_record_id ?? "identifier unavailable")}.
                  Open it in its original workspace.
                </p>
              ) : row.state === "finalized" ? (
                <button
                  type="button"
                  className={CONTROL}
                  disabled={downloading === row.id}
                  onClick={() => void download(String(row.id))}
                >
                  {downloading === row.id
                    ? "Preparing download…"
                    : "Download evidence"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReceiptHistory({
  occurrenceId,
  facilityId,
  actorId,
  actorName,
  timezone,
  refresh,
}: {
  occurrenceId: string;
  facilityId: string;
  actorId: string;
  actorName: string | null;
  timezone: string;
  refresh: string;
}) {
  const [receipts, setReceipts] = useState<WorkspaceReceipt[] | null>(null);
  const [issues, setIssues] = useState<Record<string, unknown>[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      readJson(`/api/admin/operations/occurrences/${occurrenceId}/receipts`),
      readJson(
        `/api/admin/operations/issues?facility_id=${facilityId}&task_instance_id=${occurrenceId}`,
      ),
    ]).then(([chain, linked]) => {
      if (!active) return;
      setErrors([
        ...(chain.status === "rejected" ? ["Receipt history unavailable"] : []),
        ...(linked.status === "rejected" ? ["Issues unavailable"] : []),
      ]);
      setReceipts(
        chain.status === "fulfilled" && Array.isArray(chain.value.receipts)
          ? chain.value.receipts
          : null,
      );
      setIssues(
        linked.status === "fulfilled" && Array.isArray(linked.value.issues)
          ? linked.value.issues
          : null,
      );
    });
    return () => {
      active = false;
    };
  }, [occurrenceId, facilityId, refresh, attempt]);
  return (
    <section aria-label="Receipt chain" className="space-y-3">
      {errors.map((error) => (
        <p key={error} role="alert">
          {error}
        </p>
      ))}
      {errors.length > 0 && (
        <button
          type="button"
          className={CONTROL}
          onClick={() => setAttempt((n) => n + 1)}
        >
          Retry history
        </button>
      )}
      {!receipts && !errors.length ? (
        <p role="status">Loading receipt history…</p>
      ) : null}
      <ol className="space-y-3">
        {receipts?.map((receipt) => (
          <li key={receipt.id} className="border-l-2 border-border pl-3">
            <p>
              {String(receipt.receipt_kind)}
              {receipt.corrects_receipt_id ? " · Correction" : ""}
              {receipt.superseded_by_receipt_id ? " · Superseded" : ""}
            </p>
            <ReceiptSummary
              receipt={receipt}
              actorId={actorId}
              actorName={actorName}
              timezone={timezone}
            />
            {receipt.corrects_receipt_id ? (
              <p>
                Corrects receipt {String(receipt.corrects_receipt_id)}:{" "}
                {String(receipt.correction_reason ?? "")}
              </p>
            ) : null}
            {receipt.verifies_receipt_id ? (
              <p>Reviews receipt {String(receipt.verifies_receipt_id)}</p>
            ) : null}
            {receipt.entry_reason ? (
              <p>Reason: {String(receipt.entry_reason)}</p>
            ) : null}
            <EvidenceHistory
              key={`${receipt.id}:${String(receipt.revision ?? "")}:${refresh}`}
              receiptId={receipt.id}
            />
          </li>
        ))}
      </ol>
      <h4 className="font-medium">Issues</h4>
      {issues?.length === 0 ? (
        <p>No issues reported.</p>
      ) : (
        <ul>
          {issues?.map((issue) => (
            <li
              key={String(issue.id)}
              className="flex flex-wrap items-center gap-2"
            >
              <span>
                {String(issue.summary)} · {String(issue.status)}
              </span>
              <SeverityChip
                level={
                  issue.severity === "high"
                    ? "high"
                    : issue.severity === "low"
                      ? "low"
                      : "medium"
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
