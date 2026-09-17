"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  fetchOpenVisitors,
  fetchVisitorLog,
  signOutEveryone,
  signOutVisitor,
  voidVisitorEntry,
} from "@/lib/registers/load-register";
import {
  EMPTY_VISITOR_DRAFT,
  VISITING_TYPES,
  VISITOR_LOG_EMPTY_COPY,
  VISITOR_LOG_RANGE_EMPTY_COPY,
  VISITOR_TYPES,
  VOID_REASONS,
  inTheBuildingNow,
  signOutEveryoneConfirmation,
  validateVisitorSignIn,
  visitorTypeLabel,
  voidReasonLabel,
  type VisitingTypeId,
  type VisitorLogRow,
  type VisitorSignInDraft,
  type VisitorTypeId,
} from "@/lib/registers/visitor-log";
import {
  easternDateInputValue,
  easternDayEndIso,
  easternDayStartIso,
  formatElapsedSince,
  formatRegisterEventDate,
  formatRegisterEventTime,
  isCompleteDateInput,
} from "@/lib/registers/register-display-copy";

export type VisitableResident = { id: string; firstName: string; lastName: string };

type Props = {
  organizationId: string;
  facilityId: string | null;
  residents: VisitableResident[];
  /** Signs a visitor in. The insert lives with the page that owns the actor. */
  onSignIn: (draft: VisitorSignInDraft) => Promise<void>;
  /** Lets the page header say how many people are in the building. */
  onOpenCountChange?: (count: number) => void;
};

const inputCls =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground";

/**
 * Tier 1 is who is in the building right now. Tier 2 is the log for a range.
 * Tier 3 is what was voided and why. The sign in form is built for somebody
 * standing at a door on a phone: every control is labelled, the whole flow is
 * keyboard operable, and submitting returns focus to the name field for the
 * next visitor in the queue.
 */
export function VisitorLogClient({
  organizationId,
  facilityId,
  residents,
  onSignIn,
  onOpenCountChange,
}: Props) {
  const [rows, setRows] = useState<VisitorLogRow[]>([]);
  const [openNow, setOpenNow] = useState<VisitorLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<VisitorSignInDraft>(EMPTY_VISITOR_DRAFT);
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [showVoided, setShowVoided] = useState(false);
  const [from, setFrom] = useState(() => easternDateInputValue(new Date()));
  const [to, setTo] = useState(() => easternDateInputValue(new Date()));
  const nameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!facilityId || !organizationId) {
      setRows([]);
      setOpenNow([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      // Two questions, deliberately separate. Who is in the building is not a
      // date range question: somebody who signed in at 19:00 yesterday and
      // never signed out is still here this morning, and is exactly the person
      // the 04:00 exception is for. It is also the scope the end of day action
      // acts on, so the count in the confirmation is the count it closes.
      const [open, ranged] = await Promise.all([
        fetchOpenVisitors(supabase, { organizationId, facilityId }),
        isCompleteDateInput(from) && isCompleteDateInput(to)
          ? fetchVisitorLog(supabase, {
              organizationId,
              facilityId,
              from: easternDayStartIso(from),
              to: easternDayEndIso(to),
              includeVoided: true,
            })
          : Promise.resolve([] as VisitorLogRow[]),
      ]);
      setOpenNow(inTheBuildingNow(open));
      setRows(ranged);
      setError(null);
    } catch {
      setError("The visitor log could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [facilityId, organizationId, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    onOpenCountChange?.(openNow.length);
  }, [openNow.length, onOpenCountChange]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const found = validateVisitorSignIn(draft);
    setProblems(found);
    if (found.length > 0) return;
    setSaving(true);
    setNotice(null);
    try {
      await onSignIn(draft);
      setDraft(EMPTY_VISITOR_DRAFT);
      await load();
      // Back to the name field: there is usually another person behind them.
      nameRef.current?.focus();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "The visitor could not be signed in.");
    } finally {
      setSaving(false);
    }
  }

  async function act(id: string, run: () => Promise<void>, failure: string) {
    setBusyId(id);
    setNotice(null);
    try {
      await run();
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : failure);
    } finally {
      setBusyId(null);
    }
  }

  async function signOutAll() {
    if (!facilityId) return;
    if (!window.confirm(signOutEveryoneConfirmation(openNow.length))) return;
    await act(
      "all",
      async () => {
        const count = await signOutEveryone(createClient(), facilityId);
        setNotice(count === 1 ? "1 visitor signed out." : `${count} visitors signed out.`);
      },
      "The building could not be signed out.",
    );
  }

  if (!facilityId) {
    return <p className="text-sm text-muted-foreground">Choose a facility to open its visitor log.</p>;
  }

  const voided = rows.filter((row) => row.voidedAt);

  return (
    <div className="space-y-6">
      <section aria-labelledby="visitor-sign-in-heading" className="space-y-3">
        <h2 id="visitor-sign-in-heading" className="text-sm font-medium text-foreground">
          Sign in visitor
        </h2>
        <form onSubmit={submit} className="grid gap-3 rounded-[var(--radius)] border border-border bg-card p-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="visitor-name" className="text-xs text-muted-foreground">
              Visitor name
            </label>
            <input
              id="visitor-name"
              ref={nameRef}
              type="text"
              autoComplete="off"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              aria-invalid={problems.some((p) => p.includes("name")) || undefined}
              aria-describedby={problems.length > 0 ? "visitor-problems" : undefined}
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="visitor-phone" className="text-xs text-muted-foreground">
              Phone (optional)
            </label>
            <input
              id="visitor-phone"
              type="tel"
              autoComplete="off"
              value={draft.phone}
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
              aria-invalid={problems.some((p) => p.includes("phone")) || undefined}
              aria-describedby={problems.length > 0 ? "visitor-problems" : undefined}
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="visitor-type" className="text-xs text-muted-foreground">
              Visitor type
            </label>
            <select
              id="visitor-type"
              value={draft.visitorType}
              onChange={(event) => setDraft({ ...draft, visitorType: event.target.value as VisitorTypeId })}
              className={inputCls}
            >
              {VISITOR_TYPES.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-xs text-muted-foreground">Visiting</legend>
            <div className="flex gap-1" role="radiogroup" aria-label="Visiting">
              {VISITING_TYPES.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  role="radio"
                  aria-checked={draft.visitingType === type.id}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      visitingType: type.id as VisitingTypeId,
                      residentId: type.id === "resident" ? draft.residentId : "",
                    })
                  }
                  className={
                    draft.visitingType === type.id
                      ? "h-10 flex-1 rounded-md border border-foreground bg-foreground px-2 text-sm text-background"
                      : "h-10 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  }
                >
                  {type.label}
                </button>
              ))}
            </div>
          </fieldset>
          {draft.visitingType === "resident" ? (
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label htmlFor="visitor-resident" className="text-xs text-muted-foreground">
                Resident
              </label>
              <select
                id="visitor-resident"
                value={draft.residentId}
                onChange={(event) => setDraft({ ...draft, residentId: event.target.value })}
                aria-invalid={problems.some((p) => p.includes("resident")) || undefined}
                aria-describedby={problems.length > 0 ? "visitor-problems" : undefined}
                className={inputCls}
              >
                <option value="">Choose a resident…</option>
                {residents.map((resident) => (
                  <option key={resident.id} value={resident.id}>
                    {resident.lastName}, {resident.firstName}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {problems.length > 0 ? (
            <ul id="visitor-problems" className="space-y-1 text-sm text-destructive sm:col-span-2">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Sign in
            </Button>
          </div>
        </form>
      </section>

      {notice ? (
        <p className="text-sm text-foreground" role="status">
          {notice}
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <section aria-labelledby="visitor-now-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="visitor-now-heading" className="text-sm font-medium text-foreground">
            In the building now ({openNow.length})
          </h2>
          {openNow.length > 0 ? (
            <Button type="button" variant="outline" size="sm" disabled={busyId === "all"} onClick={() => void signOutAll()}>
              Sign out everyone
            </Button>
          ) : null}
        </div>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
        ) : openNow.length === 0 ? (
          <p className="text-sm text-muted-foreground">{VISITOR_LOG_EMPTY_COPY}</p>
        ) : (
          <ul className="space-y-2">
            {openNow.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-2 rounded-[9px] border border-border bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{row.visitorName}</p>
                  <p className="text-xs text-muted-foreground">
                    {visitorTypeLabel(row.visitorType)}
                    {row.visitingResidentName ? ` · visiting ${row.visitingResidentName}` : null}
                    {!row.visitingResidentName && row.visitingType ? ` · visiting ${row.visitingType}` : null}
                    {" · in "}
                    {formatRegisterEventTime(row.signedInAt)}
                    {" · "}
                    {formatElapsedSince(row.signedInAt)}
                  </p>
                  {row.leftOpen ? (
                    <p className="text-xs text-muted-foreground">
                      Still signed in from {formatRegisterEventDate(row.signedInAt)}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busyId === row.id}
                  onClick={() =>
                    void act(row.id, () => signOutVisitor(createClient(), row.id), "The visitor could not be signed out.")
                  }
                >
                  Sign out
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="visitor-range-heading" className="space-y-3">
        <h2 id="visitor-range-heading" className="text-sm font-medium text-foreground">
          Visitor log
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="visitor-from" className="text-xs text-muted-foreground">
              From
            </label>
            <input id="visitor-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="visitor-to" className="text-xs text-muted-foreground">
              To
            </label>
            <input id="visitor-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </div>
        </div>
        {rows.filter((row) => !row.voidedAt).length === 0 ? (
          <p className="text-sm text-muted-foreground">{VISITOR_LOG_RANGE_EMPTY_COPY}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Visitors signed in for the chosen range</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">Visitor</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Type</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Visiting</th>
                  <th scope="col" className="py-2 pr-3 font-medium">In</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Out</th>
                  <th scope="col" className="py-2 pr-3 font-medium">By</th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    <span className="sr-only">Correction</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((row) => !row.voidedAt)
                  .map((row) => (
                    <tr key={row.id} className="border-b border-border align-top">
                      <td className="py-2 pr-3 text-foreground">{row.visitorName}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{visitorTypeLabel(row.visitorType)}</td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {row.visitingResidentName ?? row.visitingType ?? ""}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                        {formatRegisterEventTime(row.signedInAt)}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                        {row.signedOutAt ? formatRegisterEventTime(row.signedOutAt) : ""}
                        {row.signOutMethod === "bulk_end_of_day" ? " (end of day)" : ""}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{row.signedInByName ?? ""}</td>
                      <td className="py-2 pr-3">
                        {voidingId === row.id ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <label htmlFor={`void-${row.id}`} className="sr-only">
                              Why is this entry wrong
                            </label>
                            <select
                              id={`void-${row.id}`}
                              defaultValue=""
                              onChange={(event) => {
                                const reason = event.target.value;
                                if (!reason) return;
                                setVoidingId(null);
                                void act(
                                  row.id,
                                  () => voidVisitorEntry(createClient(), row.id, reason),
                                  "The entry could not be voided.",
                                );
                              }}
                              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                            >
                              <option value="">Why is it wrong…</option>
                              {VOID_REASONS.map((reason) => (
                                <option key={reason.id} value={reason.id}>
                                  {reason.label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => setVoidingId(null)}
                              className="text-xs text-muted-foreground underline"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setVoidingId(row.id)}
                            className="text-xs text-muted-foreground underline"
                          >
                            Void
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="visitor-voided-heading" className="space-y-2">
        <button
          type="button"
          id="visitor-voided-heading"
          aria-expanded={showVoided}
          onClick={() => setShowVoided(!showVoided)}
          className="text-sm text-muted-foreground underline"
        >
          Voided entries ({voided.length})
        </button>
        {showVoided ? (
          voided.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing has been voided in this range.</p>
          ) : (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {voided.map((row) => (
                <li key={row.id}>
                  {row.visitorName} · signed in {formatRegisterEventTime(row.signedInAt)} · voided as{" "}
                  {voidReasonLabel(row.voidReason)}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>
    </div>
  );
}
