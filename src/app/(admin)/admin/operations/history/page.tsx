"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { FacilityGateNotice } from "@/components/common/FacilityGate";
import { isOperationsViewRole } from "@/lib/operations/constants";
import type { CorporateHistoryReply } from "@/lib/operations/corporate-history";
import { OperationsViewNav } from "@/components/operations/OperationsViewNav";
import { ReceiptHistory, localTime } from "../work/_components/receipt-history";
import { HistoryReceiptSummary } from "./history-receipt-summary";
import { CONTROL } from "../work/_components/work-inputs";
import { ActivityHistoryExport } from "./activity-history-export";
import { useHeaderBoundFacility } from "../_components/use-header-bound-facility";
import { enumLabel } from "@/lib/display/enum-label";

export default function CorporateActivityHistoryPage() {
  const auth = useHavenAuth();
  const router = useRouter();
  const allowed = isOperationsViewRole(auth.appRole);
  useEffect(() => {
    if (!auth.loading && !allowed) router.replace("/dashboard");
  }, [auth.loading, allowed, router]);
  if (auth.loading) return <p role="status">Loading current person…</p>;
  if (!auth.user || !allowed)
    return <p>Corporate activity history is unavailable for this person.</p>;
  return (
    <PersonHistory
      key={`${auth.user.id}:${auth.appRole}`}
      actorId={auth.user.id}
      actorName={auth.fullName}
    />
  );
}

function PersonHistory({
  actorId,
  actorName,
}: {
  actorId: string;
  actorName: string | null;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const activityId = params.get("activity_id") ?? "";
  const cursor = params.get("cursor") ?? "";
  const navigate = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      router.replace(`/admin/operations/history?${next}`, { scroll: false });
    },
    [params, router],
  );
  const facilityId = useHeaderBoundFacility(
    useCallback(
      (next) => navigate({ facility_id: next, activity_id: null, cursor: null }),
      [navigate],
    ),
  );
  return (
    <div className="space-y-5 p-4">
      <header>
        <h1 className="text-2xl font-semibold">Corporate activity history</h1>
        <p className="text-muted-foreground">
          Review a facility&apos;s dated work, receipts and supporting files by
          activity.
        </p>
      </header>
      <OperationsViewNav />
      {facilityId ? (
        <HistoryScope
          key={`${facilityId}:${activityId}:${cursor}`}
          facilityId={facilityId}
          activityId={activityId}
          cursor={cursor}
          actorId={actorId}
          actorName={actorName}
          navigate={navigate}
        />
      ) : (
        <FacilityGateNotice reason="Activity history is recorded per site." />
      )}
    </div>
  );
}

function HistoryScope({
  facilityId,
  activityId,
  cursor,
  actorId,
  actorName,
  navigate,
}: {
  facilityId: string;
  activityId: string;
  cursor: string;
  actorId: string;
  actorName: string | null;
  navigate: (changes: Record<string, string | null>) => void;
}) {
  const [body, setBody] = useState<CorporateHistoryReply | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ facility_id: facilityId });
    if (activityId) query.set("activity_id", activityId);
    if (cursor) query.set("cursor", cursor);
    void fetch(`/api/admin/operations/activity-history?${query}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 403 || response.status === 404
              ? "This activity history is no longer accessible."
              : "Activity history unavailable.",
          );
        return (await response.json()) as CorporateHistoryReply;
      })
      .then((reply) => {
        if (!controller.signal.aborted) {
          setBody(reply);
          setError("");
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setBody(null);
          setError(
            reason instanceof Error
              ? reason.message
              : "Activity history unavailable.",
          );
        }
      });
    return () => controller.abort();
  }, [facilityId, activityId, cursor, attempt]);
  if (error)
    return (
      <div role="alert">
        {error}{" "}
        <button
          className={CONTROL}
          onClick={() => {
            setError("");
            setAttempt((n) => n + 1);
          }}
        >
          Retry history
        </button>
      </div>
    );
  if (!body) return <p role="status">Loading activity history…</p>;
  return (
    <section aria-label="Facility activity history" className="space-y-5">
      {body.partial.length > 0 ? (
        <p role="alert">
          Some history details are unavailable: {body.partial.join(", ")}.
          Loaded records remain visible; missing details are not confirmed
          empty.
        </p>
      ) : null}
      <label className="flex max-w-lg flex-col gap-1">
        Activity
        <select
          className={CONTROL}
          value={activityId}
          onChange={(event) =>
            navigate({ activity_id: event.target.value, cursor: null })
          }
        >
          <option value="">Choose an activity</option>
          {body.activities.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </label>
      {body.activities.length === 0 ? (
        <p>
          {body.partial.includes("activities")
            ? "Activities unavailable."
            : "No activities are recorded for this facility."}
        </p>
      ) : !activityId ? (
        <p>
          Choose an activity to view its history across requirement versions.
        </p>
      ) : (
        <>
          <section
            aria-label="Activity summary"
            className="grid gap-3 rounded-md border border-border bg-background p-4 sm:grid-cols-2"
          >
            <h2 className="font-semibold sm:col-span-2">
              {body.activities.find((row) => row.id === activityId)?.name ??
                "Selected activity"}{" "}
              at {body.facility_name}
            </h2>
            <p>Total occurrences: {body.total ?? "Unavailable"}</p>
            <p>Open issues: {body.open_issues ?? "Unavailable"}</p>
            <p>
              Next due:{" "}
              {body.partial.includes("schedule")
                ? "Schedule unavailable"
                : body.next_due_at
                  ? `${localTime(body.next_due_at, body.facility_timezone)} (${body.facility_timezone})`
                  : body.schedule_status === "unknown"
                    ? "Unknown — no next due date available"
                    : "No upcoming due date"}
            </p>
            <div>
              <h3 className="font-medium">Last performed</h3>
              {body.last_receipt ? (
                <HistoryReceiptSummary
                  receipt={body.last_receipt}
                  actorId={actorId}
                  actorName={actorName}
                  timezone={body.facility_timezone}
                />
              ) : (
                <p>
                  {body.partial.includes("last_receipt")
                    ? "Completion details unavailable."
                    : "No performance recorded."}
                </p>
              )}
            </div>
          </section>
          <ActivityHistoryExport facilityId={facilityId} activityId={activityId} />
          <h2 className="text-lg font-semibold">Dated history</h2>
          {body.history.length === 0 ? (
            <p>
              {cursor
                ? "No more history on this page."
                : "No occurrence history recorded for this activity."}
            </p>
          ) : (
            <ol className="space-y-4">
              {body.history.map((row) => (
                <li
                  key={row.id}
                  className="space-y-3 rounded-md border border-border bg-background p-4"
                >
                  <h3 className="font-semibold">{row.activity_name}</h3>
                  <p>
                    Due:{" "}
                    {row.due_at
                      ? `${localTime(row.due_at, body.facility_timezone)} (${body.facility_timezone})`
                      : "Unknown schedule"}
                  </p>
                  <p>
                    Created: {localTime(row.created_at, body.facility_timezone)}{" "}
                    ({body.facility_timezone})
                  </p>
                  <p>
                    Status: {enumLabel(row.status, { case: "lower" })} · Completion:{" "}
                    {(row.execution_state ? enumLabel(row.execution_state) : "Unavailable")}
                  </p>
                  {row.receipt ? (
                    <HistoryReceiptSummary
                      receipt={row.receipt}
                      actorId={actorId}
                      actorName={actorName}
                      timezone={body.facility_timezone}
                    />
                  ) : (
                    <p>
                      {body.partial.includes("receipts")
                        ? "Receipt details unavailable."
                        : "No effective receipt."}
                    </p>
                  )}
                  <OccurrenceDetails
                    occurrenceId={row.id}
                    facilityId={facilityId}
                    actorId={actorId}
                    actorName={actorName}
                    timezone={body.facility_timezone}
                    refresh={`${cursor}:${attempt}`}
                  />
                </li>
              ))}
            </ol>
          )}
          <nav aria-label="History pages" className="flex gap-2">
            {cursor ? (
              <button
                className={CONTROL}
                onClick={() => navigate({ cursor: null })}
              >
                First page
              </button>
            ) : null}
            {body.next_cursor ? (
              <button
                className={CONTROL}
                onClick={() => navigate({ cursor: body.next_cursor })}
              >
                Older history
              </button>
            ) : null}
          </nav>
        </>
      )}
    </section>
  );
}

function OccurrenceDetails(props: React.ComponentProps<typeof ReceiptHistory>) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer font-medium">
        Receipts, corrections, evidence and issues
      </summary>
      {open ? <ReceiptHistory {...props} /> : null}
    </details>
  );
}
