"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { MovementWhenFields, useMovementBackdateWindow } from "@/components/residents/MovementWhenFields";
import { enumLabel } from "@/lib/display/enum-label";
import { EMPTY_MOVEMENT_WHEN, resolveMovementWhen, type MovementWhenDraft } from "@/lib/residents/movement-effective-at";

/**
 * COL-333: arrival on the admission page. An administrator approves the
 * readiness they are shown (migration 538); the arrival can be confirmed only
 * while that approval is in force; after arrival the receiving team's
 * acknowledgment on the handoff board and the outstanding commitments show here
 * (540); an arrival recorded in error is reversed here, with a reason (539).
 * Every rule is the database's; this panel shows its answers.
 */
export type ArrivalStatus = {
  admission_case_id: string;
  status: string;
  actual_arrival_at: string | null;
  actual_arrival_precision: "instant" | "date" | null;
  ready: boolean;
  blocked_by: string[];
  fingerprint: string;
  approval: { id: string; approved_by: string; approved_by_name: string | null; approved_role: string; approved_at: string } | null;
  latest_decision: { decision: "approved" | "withdrawn"; by: string; by_name: string | null; at: string; reason: string | null } | null;
  approval_invalid_because: "withdrawn" | "readiness_changed" | "approver_no_longer_authorized" | "superseded_by_reversal" | null;
  approval_roles: string[];
  can_approve: boolean;
  receiving: { note_id: string; posted_at: string; acknowledged_at: string | null; acknowledged_by: string | null; acknowledged_by_name: string | null } | null;
  outstanding: Array<{ kind: "document" | "onboarding"; key: string; label: string }>;
  last_reversal: {
    id: string; at: string; reason: string; by_name: string | null;
    census_review_acknowledged_at: string | null; finance_review_acknowledged_at: string | null;
  } | null;
};

export const APPROVAL_INVALID_COPY: Record<NonNullable<ArrivalStatus["approval_invalid_because"]>, string> = {
  readiness_changed: "The readiness changed after it was approved. It needs approval again.",
  approver_no_longer_authorized: "The person who approved it can no longer approve arrivals here. It needs approval again.",
  withdrawn: "The approval was withdrawn.",
  superseded_by_reversal: "The arrival was reversed, so the earlier approval no longer counts. It needs approval again.",
};

/** How an approving role reads. */
export function approvalRoleLabel(role: string): string {
  return role === "facility_admin" ? "Administrator" : enumLabel(role);
}

const stamp = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso))
    : "";
const day = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));

/** Where each outstanding commitment is finished. */
export function outstandingHref(item: ArrivalStatus["outstanding"][number], residentId: string | null): string {
  if (item.kind === "document") return "#admission-documents";
  if (!residentId) return "/admin/admissions";
  switch (item.key) {
    case "care_plan":
      return `/admin/residents/${residentId}/care-plan`;
    case "medication_profile":
      return `/admin/residents/${residentId}/medications`;
    case "resident_payer":
      return `/admin/residents/${residentId}/billing`;
    default:
      return "/admin/family-portal?tab=notes";
  }
}

/** One request id per attempt, kept across a reload so a retry replays instead of acting twice. */
function useAttemptId(key: string) {
  const ref = useRef<{ key: string; id: string } | null>(null);
  const get = () => {
    if (ref.current?.key === key) return ref.current.id;
    const stored = typeof window === "undefined" ? null : window.sessionStorage.getItem(key);
    const id = stored ?? crypto.randomUUID();
    if (typeof window !== "undefined") window.sessionStorage.setItem(key, id);
    ref.current = { key, id };
    return id;
  };
  const clear = () => {
    if (typeof window !== "undefined") window.sessionStorage.removeItem(key);
    ref.current = null;
  };
  return { get, clear };
}

async function send(url: string, method: string, body?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "The request did not go through. Retry it.");
  return payload;
}

export function AdmissionArrivalPanel({
  caseId,
  facilityId,
  residentId,
  onChanged,
}: {
  caseId: string;
  facilityId: string | null;
  residentId: string | null;
  onChanged?: () => void;
}) {
  const base = `/api/admin/workflows/admission-cases/${caseId}`;
  const [status, setStatus] = useState<ArrivalStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState("");
  const [arrivalWhen, setArrivalWhen] = useState<MovementWhenDraft>(EMPTY_MOVEMENT_WHEN);
  const windowDays = useMovementBackdateWindow({ facilityId, enabled: !!facilityId });
  const approveAttempt = useAttemptId(`haven:arrival-approve:${caseId}:${status?.fingerprint ?? ""}`);
  const withdrawAttempt = useAttemptId(`haven:arrival-withdraw:${caseId}:${withdrawReason.trim()}`);
  const reverseAttempt = useAttemptId(`haven:arrival-reverse:${caseId}:${reverseReason.trim()}`);

  const load = useCallback(async () => {
    try {
      setStatus((await send(`${base}/arrival-approval`, "GET")) as ArrivalStatus);
      setLoadError(null);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "The arrival status could not be read.");
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (work: () => Promise<string>, after?: () => void) => {
    setBusy(true);
    setProblem(null);
    setMessage(null);
    try {
      const done = await work();
      after?.();
      setMessage(done);
      await load();
      onChanged?.();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "The request did not go through. Retry it.");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const approve = () =>
    act(async () => {
      await send(`${base}/arrival-approval`, "POST", { fingerprint: status!.fingerprint, request_id: approveAttempt.get() });
      return "Arrival approved for the readiness shown.";
    }, approveAttempt.clear);

  const withdraw = () =>
    act(async () => {
      await send(`${base}/arrival-approval`, "DELETE", { reason: withdrawReason.trim(), request_id: withdrawAttempt.get() });
      return "Approval withdrawn.";
    }, () => {
      withdrawAttempt.clear();
      setWithdrawReason("");
    });

  const confirmArrival = () => {
    // COL-750: the move-in is dated when the resident arrived, not when this is saved.
    const resolved = resolveMovementWhen(arrivalWhen, { windowDays: windowDays ?? null, dateRequired: true });
    if (!resolved.ok) {
      setProblem(resolved.error);
      return;
    }
    void act(async () => {
      await send(`${base}/confirm-arrival`, "POST", {
        arrival_date: arrivalWhen.date,
        arrival_time: arrivalWhen.time.trim() || undefined,
        late_entry_reason: resolved.value.reason ?? undefined,
      });
      return "Arrival confirmed. The resident is active, the bed is occupied, and the receiving team has a note on the handoff board.";
    });
  };

  const reverse = () =>
    act(async () => {
      await send(`${base}/reverse-arrival`, "POST", { reason: reverseReason.trim(), request_id: reverseAttempt.get() });
      return "Arrival reversed. Census and finance review notes are on the handoff board.";
    }, () => {
      reverseAttempt.clear();
      setReverseReason("");
      setReverseOpen(false);
    });

  if (loadError && !status) {
    return (
      <section aria-labelledby="arrival-heading" className="space-y-2 rounded-[8px] border border-border bg-card p-4">
        <h3 id="arrival-heading" className="font-semibold">Arrival</h3>
        <p role="alert" className="text-sm">{loadError}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>Try again</Button>
      </section>
    );
  }
  if (!status) {
    return <p role="status" className="text-sm text-muted-foreground">Reading the arrival status…</p>;
  }

  const arrived = !!status.actual_arrival_at;
  const approvers = status.approval_roles.map(approvalRoleLabel).join(", ");

  return (
    <section aria-labelledby="arrival-heading" className="space-y-4 rounded-[8px] border border-border bg-card p-4 text-sm">
      <h3 id="arrival-heading" className="font-semibold">Arrival</h3>

      {!arrived ? (
        <>
          <div className="space-y-1">
            <p className="font-medium">{status.ready ? "Ready for arrival." : "Not ready for arrival yet."}</p>
            {!status.ready && status.blocked_by.length > 0 ? <p>Still needed: {status.blocked_by.join(", ")}.</p> : null}
          </div>

          <div className="space-y-2">
            <h4 className="font-medium">Administrator approval</h4>
            {status.approval ? (
              <p>
                Approved by {status.approval.approved_by_name ?? "an administrator"} ({approvalRoleLabel(status.approval.approved_role)}) on {stamp(status.approval.approved_at)}.
              </p>
            ) : status.approval_invalid_because ? (
              <p>{APPROVAL_INVALID_COPY[status.approval_invalid_because]}</p>
            ) : (
              <p>Not approved yet. {approvers ? `Approved by: ${approvers}.` : null}</p>
            )}
            {status.latest_decision?.decision === "withdrawn" && status.latest_decision.reason ? (
              <p className="text-muted-foreground">Withdrawn by {status.latest_decision.by_name ?? "an administrator"}: {status.latest_decision.reason}</p>
            ) : null}
            {status.can_approve && status.ready && !status.approval ? (
              <Button type="button" disabled={busy} onClick={() => void approve()}>Approve arrival</Button>
            ) : null}
            {status.can_approve && status.approval ? (
              <div className="space-y-2">
                <label htmlFor={`withdraw-${caseId}`} className="block text-xs font-medium">
                  Why the approval is withdrawn
                  <textarea
                    id={`withdraw-${caseId}`}
                    value={withdrawReason}
                    maxLength={500}
                    onChange={(event) => setWithdrawReason(event.target.value)}
                    className="mt-1 block min-h-16 w-full rounded border border-border bg-background p-2 text-sm"
                  />
                </label>
                <Button type="button" variant="outline" size="sm" disabled={busy || !withdrawReason.trim()} onClick={() => void withdraw()}>
                  Withdraw approval
                </Button>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <h4 className="font-medium">Confirm the actual arrival</h4>
            <p className="text-muted-foreground">
              This activates the resident in census and records the bed as occupied. It needs the approval above to be in force.
            </p>
            <MovementWhenFields
              value={arrivalWhen}
              onChange={setArrivalWhen}
              windowDays={windowDays}
              idPrefix={`admission-arrival-${caseId}`}
              dateLabel="Actual arrival date"
              dateRequired
            />
            <Button type="button" disabled={busy || !status.approval || !arrivalWhen.date} onClick={confirmArrival}>
              Confirm arrival
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="font-medium">
            Arrived {status.actual_arrival_precision === "date" ? day(status.actual_arrival_at!) : stamp(status.actual_arrival_at)}.
          </p>
          <div className="space-y-1">
            <h4 className="font-medium">Receiving team</h4>
            {status.receiving ? (
              <p>
                {status.receiving.acknowledged_at
                  ? `Acknowledged by ${status.receiving.acknowledged_by_name ?? "a staff member"} on ${stamp(status.receiving.acknowledged_at)}.`
                  : "Posted to the handoff board; not yet acknowledged."}{" "}
                <Link href="/admin/handoff" className="underline underline-offset-2">Open the handoff board</Link>
              </p>
            ) : (
              <p>No receiving note is on the handoff board for this arrival.</p>
            )}
          </div>
          <div className="space-y-1">
            <h4 className="font-medium">Still outstanding</h4>
            {status.outstanding.length === 0 ? (
              <p>Nothing outstanding is recorded.</p>
            ) : (
              <ul className="list-inside list-disc space-y-1">
                {status.outstanding.map((item) => (
                  <li key={`${item.kind}:${item.key}`}>
                    <Link href={outstandingHref(item, residentId)} className="underline underline-offset-2">{item.label}</Link>
                    {item.kind === "document" ? <span className="text-muted-foreground"> (file it through the resident packet reviews on this page)</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {status.can_approve ? (
            <div className="space-y-2">
              {!reverseOpen ? (
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setReverseOpen(true)}>
                  Reverse this arrival
                </Button>
              ) : (
                <div className="space-y-2 rounded border border-border p-3">
                  <p>
                    Only for an arrival recorded in error. The resident returns to pending admission, the bed is held for this admission again,
                    the referral is set back, and the approval must be given again. Census and finance review notes go to the handoff board.
                  </p>
                  <label htmlFor={`reverse-${caseId}`} className="block text-xs font-medium">
                    Why the arrival is being reversed
                    <textarea
                      id={`reverse-${caseId}`}
                      value={reverseReason}
                      maxLength={500}
                      onChange={(event) => setReverseReason(event.target.value)}
                      className="mt-1 block min-h-16 w-full rounded border border-border bg-background p-2 text-sm"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="destructive" size="sm" disabled={busy || !reverseReason.trim()} onClick={() => void reverse()}>
                      Reverse the arrival
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setReverseOpen(false)}>Keep the arrival</Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </>
      )}

      {status.last_reversal ? (
        <div className="space-y-1 border-t border-border pt-3">
          <h4 className="font-medium">Last reversal</h4>
          <p>
            Reversed on {stamp(status.last_reversal.at)} by {status.last_reversal.by_name ?? "an administrator"}: {status.last_reversal.reason}
          </p>
          <p>
            Census review: {status.last_reversal.census_review_acknowledged_at ? `done ${stamp(status.last_reversal.census_review_acknowledged_at)}` : "not yet acknowledged"}.
            {" "}Finance review: {status.last_reversal.finance_review_acknowledged_at ? `done ${stamp(status.last_reversal.finance_review_acknowledged_at)}` : "not yet acknowledged"}.
          </p>
        </div>
      ) : null}

      {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
      {message ? <p role="status" className="text-sm">{message}</p> : null}
    </section>
  );
}
