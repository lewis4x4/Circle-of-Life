"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { CARD_CLASS, CARD_HEAD_CLASS, LINK_BUTTON_CLASS } from "@/components/home/home-styles";
import type { SweepFacility, SweepStatus } from "@/lib/benefits/contracts";
import { AdmissionMedicaidScreening } from "./AdmissionMedicaidScreening";
import { BenefitsRequestError, benefitsFetch, dateLabel, ErrorNotice, Panel } from "./benefits-ui";

export function sweepProgress(f: Pick<SweepFacility, "total" | "answered">) {
  return `${f.answered} of ${f.total} current residents answered`;
}

function useSweep(facilityId: string | undefined) {
  const [data, setData] = useState<SweepStatus | null>(null);
  const [error, setError] = useState<{ message: string; noAccess: boolean } | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const body = await benefitsFetch<SweepStatus>(`/api/admin/benefits/sweep${facilityId ? `?facility_id=${encodeURIComponent(facilityId)}` : ""}`);
      if (!body || !Array.isArray(body.facilities)) throw new Error("The sweep could not be verified. Please try again.");
      setData(body);
    } catch (caught) {
      const noAccess = caught instanceof BenefitsRequestError && (caught.status === 403 || caught.status === 404);
      setError({ message: caught instanceof Error ? caught.message : "Unable to load the sweep.", noAccess });
    }
  }, [facilityId]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, load };
}

function StartSweep({ facility, onStarted }: { facility: SweepFacility; onStarted: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  if (!confirming) return <Button variant="outline" className="min-h-11" onClick={() => setConfirming(true)}>Start current-resident sweep</Button>;
  return (
    <div className="space-y-2 rounded-[var(--radius)] border border-border p-3 text-sm">
      <p>This asks the facility administrator to record the six Medicaid questions for all {facility.total} current residents at {facility.facility_name}. Start it once the resident records are cleaned up.</p>
      <ErrorNotice error={error} />
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" disabled={busy} onClick={async () => {
          setBusy(true); setError(null);
          try {
            await benefitsFetch("/api/admin/benefits/sweep", { method: "POST", body: JSON.stringify({ request_id: requestId, facility_id: facility.facility_id }) });
            await onStarted();
          } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to start the sweep."); } finally { setBusy(false); }
        }}>{busy ? "Starting…" : "Start the sweep"}</Button>
        <Button variant="outline" className="min-h-11" onClick={() => setConfirming(false)}>Cancel</Button>
      </div>
    </div>
  );
}

function RemainingResident({ resident, onSaved }: { resident: { resident_id: string; resident_name: string; status: string }; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-medium">{resident.resident_name}{resident.status !== "active" ? <span className="ml-2 text-sm font-normal text-muted-foreground">({resident.status === "loa" ? "leave of absence" : "hospital hold"})</span> : null}</span>
        {!open && <Button variant="outline" className="min-h-11" onClick={() => setOpen(true)}>Ask the Medicaid questions</Button>}
      </div>
      {open && (
        <div className="space-y-2">
          <AdmissionMedicaidScreening residentId={resident.resident_id} onSaved={onSaved} />
          <Button variant="outline" className="min-h-11" onClick={() => setOpen(false)}>Close</Button>
        </div>
      )}
    </li>
  );
}

/** Medicaid & benefits → Current-resident sweep. */
export function MedicaidSweepPanel({ facilityId }: { facilityId?: string }) {
  const { data, error, load } = useSweep(facilityId);
  return (
    <Panel title="Current-resident sweep" description="The Medicaid questions are asked at admission. This one-time sweep asks everyone who already lives here, so no possible candidate is missed. Progress counts residents with answers on record.">
      {error && <ErrorNotice error={error.noAccess ? "The sweep is visible to staff with Medicaid access for this facility. Ask an owner to grant access under Medicaid & benefits → Access." : error.message} />}
      {!data && !error && <p role="status">Loading the sweep…</p>}
      {data && data.facilities.length === 0 && <p className="text-sm text-muted-foreground">No facilities with Medicaid access.</p>}
      {data && (
        <ul className="divide-y divide-border">
          {data.facilities.map((f) => (
            <li key={f.facility_id} className="space-y-3 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{f.facility_name}</p>
                  <p className="text-sm text-muted-foreground">{sweepProgress(f)}{f.started_at ? ` · started ${dateLabel(f.started_at)}${f.started_by_name ? ` by ${f.started_by_name}` : ""}` : ""}</p>
                </div>
                <StatusPill tone={!f.started_at ? "muted" : f.answered >= f.total ? "success" : "warning"}>
                  {!f.started_at ? "Not started" : f.answered >= f.total ? "Complete" : `${f.total - f.answered} still to ask`}
                </StatusPill>
              </div>
              {!f.started_at && data.can_start && <StartSweep facility={f} onStarted={load} />}
              {!facilityId && f.started_at && f.answered < f.total && (
                <Link className={LINK_BUTTON_CLASS} href={`/admin/benefits?view=sweep&facility_id=${encodeURIComponent(f.facility_id)}`}>Ask the residents at {f.facility_name} →</Link>
              )}
              {facilityId && f.started_at && f.remaining && f.remaining.length > 0 && (
                f.can_write
                  ? <ul className="divide-y divide-border/60">{f.remaining.map((r) => <RemainingResident key={r.resident_id} resident={r} onSaved={load} />)}</ul>
                  : <p className="text-sm text-muted-foreground">Recording answers needs Medicaid write access for this facility.</p>
              )}
              {facilityId && !f.started_at && <p className="text-sm text-muted-foreground">The sweep has not been started for this facility.</p>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Facility Operator Home card: shown only while this facility's sweep is started and incomplete. */
export function MedicaidSweepHomeCard({ facilityId }: { facilityId: string }) {
  const { data, error } = useSweep(facilityId);
  const f = data?.facilities.find((x) => x.facility_id === facilityId);
  if (error && !error.noAccess) return <section className={CARD_CLASS} aria-label="Medicaid sweep"><p className="px-4 py-3 text-sm text-muted-foreground">The Medicaid sweep could not be loaded.</p></section>;
  if (!f || !f.started_at || f.answered >= f.total) return null;
  return (
    <section className={CARD_CLASS} aria-label="Medicaid sweep">
      <div className={CARD_HEAD_CLASS}>
        <h2 className="text-sm font-semibold">Medicaid questions: current residents</h2>
        <StatusPill tone="warning">{f.total - f.answered} still to ask</StatusPill>
      </div>
      <p className="px-4 py-2 text-sm text-muted-foreground">{sweepProgress(f)}</p>
      <div className="px-4 pb-3">
        <Link href={`/admin/benefits?view=sweep&facility_id=${encodeURIComponent(facilityId)}`} className={LINK_BUTTON_CLASS}>Ask the next resident →</Link>
      </div>
    </section>
  );
}
