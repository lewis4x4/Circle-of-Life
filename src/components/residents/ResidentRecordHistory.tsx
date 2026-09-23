"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import { RESIDENT_RECORD_FIELD_TITLES } from "@/lib/residents/resident-record-edit";
import {
  RESIDENT_RECORD_HISTORY_LIMIT,
  STALE_FACT_ACTION,
  STALE_FACT_LEAD,
  describeHistoryChange,
  describeHistorySource,
  groupResidentRecordHistory,
  historyWhen,
  intakeReviewHref,
  parseResidentRecordHistory,
  type ResidentRecordHistory as History,
} from "@/lib/residents/resident-record-history";

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; history: History };

/**
 * COL-627: the latest changes to the resident record's in-place fields — what
 * changed, who changed it, when, and whether it was typed on the record or
 * applied from an admission document. Reads `resident_record_field_history`;
 * `reloadToken` changes when the overview saves something, so a save shows up here.
 */
export function useResidentRecordHistory(residentId: string, reloadToken: number): LoadState {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    let request: Promise<{ data: unknown; error: unknown }>;
    try {
      request = createClient().rpc(
        "resident_record_field_history" as never,
        { p_resident_id: residentId, p_limit: RESIDENT_RECORD_HISTORY_LIMIT } as never,
      ) as unknown as Promise<{ data: unknown; error: unknown }>;
    } catch {
      request = Promise.reject(new Error("Record history unavailable"));
    }
    void request.then(
      ({ data, error }) => {
        if (cancelled) return;
        const history = error ? null : parseResidentRecordHistory(data);
        setState(history ? { status: "ready", history } : { status: "error" });
      },
      () => {
        if (!cancelled) setState({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [residentId, reloadToken]);
  return state;
}

export function ResidentRecordHistory({ residentId, reloadToken }: { residentId: string; reloadToken: number }) {
  const state = useResidentRecordHistory(residentId, reloadToken);

  if (state.status === "loading") {
    return <p className="text-[13px] text-muted-foreground" role="status">Loading record history…</p>;
  }
  if (state.status === "error") {
    return (
      <p className="text-[13px] text-muted-foreground" role="alert">
        Record history could not be loaded. Refresh the page to try again.
      </p>
    );
  }

  const groups = groupResidentRecordHistory(state.history);
  if (groups.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No changes recorded yet. When code status, allergies, diagnoses, the physician or a directive is recorded here or
        applied from an admission document, the change, who made it and when are listed here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.field} aria-label={`${RESIDENT_RECORD_FIELD_TITLES[group.field]} history`}>
          <p className="text-[11px] font-semibold text-muted-foreground">{RESIDENT_RECORD_FIELD_TITLES[group.field]}</p>
          {group.stale.map((fact) => (
            <p
              key={`${fact.field}-${fact.intakeId ?? fact.at}`}
              role="note"
              className="mt-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-[12px] leading-relaxed text-foreground"
            >
              {STALE_FACT_LEAD}{" "}
              {fact.intakeId ? (
                <Link
                  prefetch={false}
                  href={intakeReviewHref(fact.intakeId)}
                  className="font-medium underline underline-offset-4"
                >
                  {STALE_FACT_ACTION}
                </Link>
              ) : (
                STALE_FACT_ACTION
              )}
              {fact.documentTitle ? ` (“${fact.documentTitle}”)` : ""}.
            </p>
          ))}
          {group.entries.length > 0 ? (
            <ol className="mt-1 space-y-2" aria-label={`${RESIDENT_RECORD_FIELD_TITLES[group.field]} changes, newest first`}>
              {group.entries.map((entry) => (
                <li key={entry.id} className="text-[13px]">
                  <span className="font-medium text-foreground">{describeHistoryChange(entry)}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {describeHistorySource(entry)} · <span className="tabular-nums">{historyWhen(entry.at)}</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ))}
      <p className="text-[11px] text-muted-foreground">
        {state.history.truncated
          ? `Showing the latest ${state.history.limit} changes across these fields. Older changes are kept in the audit log.`
          : `Shows up to the latest ${state.history.limit} changes across these fields.`}
      </p>
    </div>
  );
}
