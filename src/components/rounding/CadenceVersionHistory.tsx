"use client";

/**
 * Tier 3: version history, the change log with reasons, and rollback.
 * Spec 25A section 6.11 and 6.13.
 *
 * Each entry carries who made the change, when, why they made it, why it was
 * put in force, and the rows on either side of it so the diff renders without a
 * round trip per entry.
 *
 * Rolling back creates a new forward version copying an earlier one. It never
 * deletes a version and never rewrites the dates on one that was in force, so
 * a compliance report for a past date still recomputes to the same numbers
 * after somebody undoes a mistake. The button says so.
 */

import { formatDisplayDateTime } from "@/lib/format/datetime";
import { policyText } from "@/lib/rounding/cadence-policy-diff";
import { useState } from "react";

import { RoundingEmptyNotice } from "@/components/rounding/RoundingNotices";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import type { ChangeLogEntry } from "@/lib/rounding/cadence-settings";
import {
  CHANGE_LOG_EMPTY,
  applyModeLabel,
  versionStatusLabel,
} from "@/lib/rounding/cadence-settings-copy";

function rowKey(row: Record<string, unknown>): string {
  return String(row.window_key ?? row.rung_key ?? "");
}

function rowSummary(row: Record<string, unknown>): string {
  return policyText(row);
}

/** The rows that differ between a version and the one before it. */
export function changedRows(entry: ChangeLogEntry): { key: string; before: string | null; after: string | null }[] {
  const previousRows = [...entry.previous_rows, ...(entry.previous_configuration ? [{ window_key: "facility_policy", label: "Facility policy", ...entry.previous_configuration }] : [])];
  const nextRows = [...entry.rows, ...(entry.configuration ? [{ window_key: "facility_policy", label: "Facility policy", ...entry.configuration }] : [])];
  const before = new Map(previousRows.map((row) => [rowKey(row), rowSummary(row)]));
  const after = new Map(nextRows.map((row) => [rowKey(row), rowSummary(row)]));
  const keys = Array.from(new Set([...before.keys(), ...after.keys()])).sort();
  return keys
    .filter((key) => before.get(key) !== after.get(key))
    .map((key) => ({ key, before: before.get(key) ?? null, after: after.get(key) ?? null }));
}

export function CadenceVersionHistory({
  entries,
  onRollback,
  canRollback,
  busy,
}: {
  entries: ChangeLogEntry[];
  onRollback: (entry: ChangeLogEntry) => void;
  canRollback: boolean;
  busy: boolean;
}) {
  const [openVersionId, setOpenVersionId] = useState<string | null>(null);

  if (entries.length === 0) {
    return <RoundingEmptyNotice label="Change history" copy={CHANGE_LOG_EMPTY} />;
  }

  return (
    <section aria-label="Version history and change log" className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">What has changed here</h2>

      <ol className="space-y-2">
        {entries.map((entry) => {
          const open = openVersionId === entry.version_id;
          const diff = changedRows(entry);
          return (
            <li key={entry.version_id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-foreground">
                    <span>
                      {entry.kind === "cadence" ? "Observation schedule" : "Escalation ladder"} version{" "}
                      {entry.version_number}
                    </span>
                    <StatusPill>{versionStatusLabel(entry.status)}</StatusPill>
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    Proposed by {entry.created_by_name ?? "somebody no longer on the record"} on{" "}
                    {formatDisplayDateTime(entry.created_at)}
                    {entry.activated_at
                      ? `, put in force by ${
                          entry.activated_by_name ?? "somebody no longer on the record"
                        } on ${formatDisplayDateTime(entry.activated_at)} ${applyModeLabel(
                          entry.apply_mode,
                        ).toLowerCase()}`
                      : ""}
                  </p>
                  <p className="text-[13px] leading-relaxed text-foreground">{entry.change_reason}</p>
                  {entry.activation_reason && entry.activation_reason !== entry.change_reason ? (
                    <p className="text-[13px] leading-relaxed text-muted-foreground">
                      Put in force because: {entry.activation_reason}
                    </p>
                  ) : null}
                  <p className="text-[13px] tabular-nums text-muted-foreground">
                    In force from {formatDisplayDateTime(entry.effective_from)}
                    {entry.effective_to ? ` until ${formatDisplayDateTime(entry.effective_to)}` : ", still"}
                  </p>
                </div>

                <span className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setOpenVersionId(open ? null : entry.version_id)}
                    aria-expanded={open}
                  >
                    {open ? "Hide what changed" : "What changed"}
                  </Button>
                  {canRollback && entry.status === "superseded" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onRollback(entry)}
                      disabled={busy}
                      title="Copies this version forward as a new one. Nothing is deleted and no past report changes."
                    >
                      Go back to this
                    </Button>
                  ) : null}
                </span>
              </div>

              {open ? (
                <div className="mt-3 border-t border-border pt-3">
                  {diff.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">
                      Nothing in the rows differs from the version before it. This version records a change of
                      timing or of who approved it.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {diff.map((row) => (
                        <li key={row.key} className="text-[13px] leading-relaxed">
                          {row.before ? (
                            <p className="text-muted-foreground">Was: {row.before}</p>
                          ) : (
                            <p className="text-muted-foreground">Was: not present</p>
                          )}
                          {row.after ? (
                            <p className="text-foreground">Now: {row.after}</p>
                          ) : (
                            <p className="text-foreground">Now: removed</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Going back creates a new version carrying the older schedule. Nothing is deleted, and a compliance report
        for a past date still recomputes to the same numbers afterwards.
      </p>
    </section>
  );
}
