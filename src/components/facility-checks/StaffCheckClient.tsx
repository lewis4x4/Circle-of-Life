"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { formatFacilityTimestampEt } from "@/lib/facility-wall-clock";
import {
  DUPLICATE_BADGE_TEXT,
  duplicateTargetChoices,
  duplicateTargetRequired,
  hasDuplicateCandidates,
  isStaffCheckResult,
  lastSignInLabel,
  STAFF_CHECK_RESULTS,
  staffCheckClosedSummary,
  staffCheckFixDetail,
  staffCheckProgress,
  staffCheckProgressLine,
  staffCheckResultInsert,
  staffCheckResultLabel,
  staffCheckSubjectKey,
  staffCloseRefusalMessage,
  staffGrantReassignmentNote,
  type StaffCheckResult,
  type StaffCheckStateRow,
} from "@/lib/facility-checks/staff-check";
import type {
  StaffCheckHistoryEntry,
  StaffCheckSession,
} from "@/lib/facility-checks/load-staff-check";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";

/**
 * Staff Check — every identity with live access to this facility, resolved one
 * at a time.
 *
 * Same three tiers as the Board Check, and the same rule underneath: an item
 * closes when the identity really cannot act any more, which the database
 * recomputes on every read. Naming a duplicate records a decision and lists the
 * grants to move; it never moves a record between identities.
 */
export function StaffCheckClient({
  session,
  initialRows,
  initialHistory,
  closedByName,
  loadError,
  facilityId,
  organizationId,
  actorId,
  staffHref,
  grantsHref,
  onRefresh,
}: {
  session: StaffCheckSession | null;
  initialRows: StaffCheckStateRow[];
  initialHistory: StaffCheckHistoryEntry[];
  closedByName: string | null;
  loadError: string | null;
  facilityId: string | null;
  organizationId: string | null;
  actorId: string | null;
  staffHref: string;
  grantsHref: string;
  onRefresh: () => Promise<void> | void;
}) {
  const [rows, setRows] = useState(initialRows);
  const [history] = useState(initialHistory);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pickerKey, setPickerKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [closing, setClosing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const closed = Boolean(session?.closedAt);
  const progress = useMemo(() => staffCheckProgress(rows), [rows]);
  const openItems = useMemo(() => rows.filter((row) => row.fix_open), [rows]);

  const refresh = useCallback(async (): Promise<StaffCheckStateRow[] | null> => {
    if (!session) return null;
    const supabase = createClient();
    const { data, error } = await supabase.rpc("staff_check_state", { p_session_id: session.id });
    if (error) {
      setProblem("The identity list could not be reloaded. Refresh the page to see the current state.");
      return null;
    }
    const next = (data ?? []) as StaffCheckStateRow[];
    setRows(next);
    startTransition(() => {
      void onRefresh();
    });
    return next;
  }, [onRefresh, session]);

  async function startSession() {
    if (!facilityId || !organizationId || !actorId) return;
    setStarting(true);
    setProblem(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("staff_check_sessions")
        .insert({ organization_id: organizationId, facility_id: facilityId, started_by: actorId } as never);
      if (error) throw error;
      startTransition(() => {
        void onRefresh();
      });
    } catch {
      setProblem("The check could not be started. Another staff check may already be open for this facility.");
    } finally {
      setStarting(false);
    }
  }

  async function record(
    row: StaffCheckStateRow,
    result: StaffCheckResult,
    duplicateOf: StaffCheckStateRow | null = null,
  ) {
    if (!session || !actorId || closed) return;
    if (duplicateTargetRequired(result, duplicateOf)) {
      setPickerKey(staffCheckSubjectKey(row));
      return;
    }
    setBusyKey(staffCheckSubjectKey(row));
    setProblem(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("staff_check_results").insert(
        staffCheckResultInsert({
          organizationId: session.organizationId,
          sessionId: session.id,
          row,
          result,
          duplicateOf,
          recordedBy: actorId,
        }) as never,
      );
      if (error) throw error;
      setPickerKey(null);
      setSearch("");
      await refresh();
    } catch {
      setProblem("That decision was not recorded. Try it again.");
    } finally {
      setBusyKey(null);
    }
  }

  async function closeCheck() {
    if (!session) return;
    setClosing(true);
    setProblem(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("close_staff_check_session", { p_session_id: session.id });
      if (error) {
        const reloaded = await refresh();
        setProblem(staffCloseRefusalMessage(staffCheckProgress(reloaded ?? rows)));
        return;
      }
      toast.success("Staff check closed.");
      startTransition(() => {
        void onRefresh();
      });
    } catch {
      setProblem("The check could not be closed. Refresh and try again.");
    } finally {
      setClosing(false);
    }
  }

  if (loadError) {
    return (
      <section aria-labelledby="staff-check-heading" className="space-y-3">
        <h1 id="staff-check-heading" className="text-base font-medium text-foreground">
          Staff check
        </h1>
        <p className="text-sm text-muted-foreground">
          The identity list is not available right now. Try again in a moment.
        </p>
      </section>
    );
  }

  if (!session) {
    return (
      <section aria-labelledby="staff-check-heading" className="space-y-3">
        <h1 id="staff-check-heading" className="text-base font-medium text-foreground">
          Staff check
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Go through everyone with access to this facility and decide: keep, deactivate, or duplicate of
          someone already on the list. The check closes only when every identity is resolved and every
          deactivation has actually gone through.
        </p>
        <Button
          type="button"
          disabled={starting || !facilityId || !organizationId}
          onClick={() => void startSession()}
        >
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start staff check"}
        </Button>
        {problem ? (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section aria-labelledby="staff-check-heading" className="space-y-6">
      <header className="space-y-1">
        <h1 id="staff-check-heading" className="text-base font-medium text-foreground">
          Staff check
        </h1>
        <p className="text-sm text-muted-foreground" data-testid="staff-check-progress">
          {closed && session.closedAt
            ? staffCheckClosedSummary({
                closedAt: session.closedAt,
                closedByName,
                total: rows.length,
                formatDateTime: formatFacilityTimestampEt,
              })
            : staffCheckProgressLine(progress)}
        </p>
      </header>

      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}

      <div>
        <HorizontalScroll label="Staff check">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <caption className="sr-only">
              Everyone with live access to this facility, with their role, grants, last sign in and decision.
            </caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Name
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Role
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Facilities
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Last sign in
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Active
                </th>
                <th scope="col" className="py-2 font-medium">
                  Decision
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const key = staffCheckSubjectKey(row);
                return (
                  <tr key={key} className="border-b border-border align-top">
                    <th scope="row" className="py-2.5 pr-3 text-left font-normal text-foreground">
                      <span className="block font-medium">{row.display_name ?? "Unnamed identity"}</span>
                      {hasDuplicateCandidates(row) ? (
                        <Badge variant="outline" className="mt-1 text-[11px]">
                          {DUPLICATE_BADGE_TEXT}
                        </Badge>
                      ) : null}
                    </th>
                    <td className="py-2.5 pr-3 text-muted-foreground">{row.role_label ?? "Not set"}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{row.facility_grant_count}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">
                      {lastSignInLabel(row.last_sign_in_at, formatFacilityTimestampEt)}
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{row.is_active ? "Yes" : "No"}</td>
                    <td className="py-2.5">
                      <fieldset disabled={closed || busyKey === key} className="flex flex-wrap gap-1.5">
                        <legend className="sr-only">
                          Decision for {row.display_name ?? "this identity"}
                        </legend>
                        {STAFF_CHECK_RESULTS.map((result) => (
                          <Button
                            key={result}
                            type="button"
                            size="sm"
                            variant={row.latest_result === result ? "default" : "outline"}
                            aria-pressed={row.latest_result === result}
                            className="text-[12px]"
                            onClick={() => void record(row, result)}
                          >
                            {staffCheckResultLabel(result)}
                          </Button>
                        ))}
                      </fieldset>
                      {pickerKey === key ? (
                        <div className="mt-2 space-y-2">
                          <label className="block space-y-1">
                            <span className="block text-xs text-muted-foreground">
                              Which identity is this a duplicate of?
                            </span>
                            <Input
                              value={search}
                              onChange={(event) => setSearch(event.target.value)}
                              aria-label="Search identities in this organization"
                              placeholder="Search by name"
                              className="h-8 text-[12px]"
                            />
                          </label>
                          <ul className="space-y-1">
                            {duplicateTargetChoices(row, rows, search).map((choice) => (
                              <li key={staffCheckSubjectKey(choice)}>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="text-[12px]"
                                  onClick={() => void record(row, "duplicate_of", choice)}
                                >
                                  {choice.display_name ?? "Unnamed identity"}
                                </Button>
                              </li>
                            ))}
                            {duplicateTargetChoices(row, rows, search).length === 0 ? (
                              <li className="text-xs text-muted-foreground">
                                No suggestions. Search by name to pick another identity.
                              </li>
                            ) : null}
                          </ul>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </HorizontalScroll>
      </div>

      {openItems.length > 0 ? (
        <section aria-labelledby="staff-check-open" className="space-y-3">
          <h3 id="staff-check-open" className="text-sm font-medium text-foreground">
            Still outstanding
          </h3>
          <ul className="space-y-3">
            {openItems.map((row) => {
              const detail = staffCheckFixDetail(row);
              const grants = staffGrantReassignmentNote(row);
              return (
                <li key={staffCheckSubjectKey(row)} className="space-y-1 border-b border-border pb-3">
                  <p className="text-sm font-medium text-foreground">
                    {row.display_name ?? "Unnamed identity"}
                  </p>
                  {detail ? <p className="max-w-prose text-sm text-muted-foreground">{detail}</p> : null}
                  <div className="flex flex-wrap gap-4">
                    {row.subject_staff_id ? (
                      <Link
                        href={`${staffHref}/${row.subject_staff_id}`}
                        className="text-sm text-foreground underline underline-offset-4"
                      >
                        Open deactivate
                      </Link>
                    ) : null}
                    {row.latest_result === "duplicate_of" && row.facility_grant_count > 0 ? (
                      <Link href={grantsHref} className="text-sm text-foreground underline underline-offset-4">
                        Reassign facility grants
                      </Link>
                    ) : null}
                  </div>
                  {grants ? <p className="text-xs text-muted-foreground">{grants}</p> : null}
                </li>
              );
            })}
          </ul>
          <p className="max-w-prose text-xs text-muted-foreground">
            Each item clears when the identity can no longer act. Nothing here is ticked off by hand.
          </p>
        </section>
      ) : null}

      {!closed ? (
        <div className="space-y-2">
          <Button type="button" disabled={!progress.canClose || closing} onClick={() => void closeCheck()}>
            {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Close check"}
          </Button>
          {!progress.canClose ? (
            <p className="text-xs text-muted-foreground">{staffCloseRefusalMessage(progress)}</p>
          ) : null}
        </div>
      ) : null}

      <details className="text-sm">
        <summary className="cursor-pointer text-foreground">Session history</summary>
        <ul className="mt-3 space-y-2">
          {history.map((entry) => (
            <li key={entry.id} className="text-muted-foreground">
              {entry.subjectName ?? "Unnamed identity"} ·{" "}
              {isStaffCheckResult(entry.result) ? staffCheckResultLabel(entry.result) : entry.result}
              {entry.duplicateOfName ? ` ${entry.duplicateOfName}` : ""} ·{" "}
              {formatFacilityTimestampEt(entry.recordedAt)}
              {entry.recordedByName ? ` · ${entry.recordedByName}` : ""}
            </li>
          ))}
          {history.length === 0 ? (
            <li className="text-muted-foreground">No identities resolved yet.</li>
          ) : null}
        </ul>
      </details>
    </section>
  );
}

export default StaffCheckClient;
