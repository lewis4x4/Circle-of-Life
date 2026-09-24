"use client";

import { useCallback, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { FacilityGateNotice } from "@/components/common/FacilityGate";
import {
  fetchOpenVisitors,
  fetchVisitorLog,
  matchVisitorResident,
  signOutEveryone,
  signOutVisitor,
  voidVisitorEntry,
} from "@/lib/registers/load-register";
import {
  inTheBuildingNow,
  signOutEveryoneConfirmation,
  voidReasonLabel,
  type VisitorLogRow,
  type VisitorSignInDraft,
} from "@/lib/registers/visitor-log";
import {
  easternDateInputValue,
  easternDayEndIso,
  easternDayStartIso,
  formatRegisterEventTime,
  isCompleteDateInput,
} from "@/lib/registers/register-display-copy";

import { VisitorLogTable } from "./VisitorLogTable";
import { VisitorSignInForm } from "./VisitorSignInForm";
import { VisitorsInBuilding } from "./VisitorsInBuilding";

export type VisitableResident = { id: string; firstName: string; lastName: string };

type Props = {
  organizationId: string;
  facilityId: string | null;
  residents: VisitableResident[];
  /** Signs a visitor in. The insert lives with the page that owns the actor. */
  onSignIn: (draft: VisitorSignInDraft) => Promise<void>;
  /** Lets the page header say how many people are in the building. */
  /** Visitors in the building now; null while loading or when the log could not be read (COL-649). */
  onOpenCountChange?: (count: number | null) => void;
};

/**
 * Tier 1 is who is in the building right now. Tier 2 is the log for a range.
 * Tier 3 is what was voided and why. The desk's sign-in form sits above them
 * (VisitorSignInForm); kiosk entries carry a Match resident action (COL-692).
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
  const [showVoided, setShowVoided] = useState(false);
  const [from, setFrom] = useState(() => easternDateInputValue(new Date()));
  const [to, setTo] = useState(() => easternDateInputValue(new Date()));

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
    onOpenCountChange?.(loading || error ? null : openNow.length);
  }, [openNow.length, loading, error, onOpenCountChange]);

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

  const match = (id: string, residentId: string) =>
    void act(id, () => matchVisitorResident(createClient(), id, residentId), "The resident could not be matched.");

  if (!facilityId) {
    return <FacilityGateNotice reason="The visitor log is kept per building." />;
  }

  const voided = rows.filter((row) => row.voidedAt);

  return (
    <div className="space-y-6">
      <VisitorSignInForm residents={residents} onSignIn={onSignIn} onSaved={load} onNotice={setNotice} />

      {notice ? (
        <p className="text-sm text-foreground" role="status">
          {notice}
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <VisitorsInBuilding
        openNow={openNow}
        loading={loading}
        busyId={busyId}
        residents={residents}
        onSignOutAll={() => void signOutAll()}
        onSignOut={(id) => void act(id, () => signOutVisitor(createClient(), id), "The visitor could not be signed out.")}
        onMatch={match}
      />

      <VisitorLogTable
        rows={rows}
        from={from}
        to={to}
        onFrom={setFrom}
        onTo={setTo}
        busyId={busyId}
        residents={residents}
        onVoid={(id, reason) => void act(id, () => voidVisitorEntry(createClient(), id, reason), "The entry could not be voided.")}
        onMatch={match}
      />

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
