"use client";
import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FormLabel } from "@/components/ui/form-label";
import { StatusPill } from "@/components/ui/status-pill";
import { CARD_CLASS, CARD_HEAD_CLASS, LINK_BUTTON_CLASS } from "@/components/home/home-styles";
import type { RecheckList, RecheckRow } from "@/lib/benefits/contracts";
import { AdmissionMedicaidScreening } from "./AdmissionMedicaidScreening";
import { BenefitsRequestError, benefitsFetch, dateLabel, ErrorNotice, fieldClass, Panel } from "./benefits-ui";

const REASON_SHORT: Array<[keyof Pick<RecheckRow, "q_property_non_primary" | "q_income_over_limit" | "q_assets">, string]> = [
  ["q_property_non_primary", "property other than home"],
  ["q_income_over_limit", "income over the limit"],
  ["q_assets", "assets over the limit"],
];
/** Why this resident did not qualify last time, in a few words. */
export function recheckReason(row: RecheckRow) {
  const yes = REASON_SHORT.filter(([key]) => row[key] === "yes").map(([, text]) => text);
  return yes.length ? `Last answers: ${yes.join(", ")}` : "Last answers did not qualify";
}

type Mode = "idle" | "no_change" | "resident_left" | "changed";

function RecheckItem({ row, onDone }: { row: RecheckRow; onDone: () => Promise<void> }) {
  const id = useId();
  const [mode, setMode] = useState<Mode>("idle");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const complete = async (outcome: "no_change" | "resident_left") => {
    setBusy(true); setError(null);
    try {
      await benefitsFetch(`/api/admin/benefits/rechecks/${row.id}/complete`, { method: "POST", body: JSON.stringify({ request_id: requestId, outcome, note: note.trim() || null }) });
      setRequestId(crypto.randomUUID()); setMode("idle"); setNote("");
      await onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to record the recheck.");
    } finally { setBusy(false); }
  };
  return (
    <li className="space-y-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">{row.resident_name}</p>
          <p className="text-sm text-muted-foreground">{recheckReason(row)} · asked {dateLabel(row.last_answered_at)}</p>
        </div>
        <StatusPill tone={row.overdue ? "warning" : "muted"}>{row.overdue ? `Overdue since ${dateLabel(row.due_on)}` : `Due ${dateLabel(row.due_on)}`}</StatusPill>
      </div>
      {row.can_write && mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" variant="outline" onClick={() => setMode("no_change")}>No change</Button>
          <Button className="min-h-11" variant="outline" onClick={() => setMode("changed")}>Answers changed</Button>
          <Button className="min-h-11" variant="outline" onClick={() => setMode("resident_left")}>Resident left</Button>
        </div>
      )}
      {(mode === "no_change" || mode === "resident_left") && (
        <form className="grid gap-3 rounded-[var(--radius)] border border-border p-3 sm:grid-cols-[1fr_auto]" onSubmit={(event) => { event.preventDefault(); void complete(mode); }}>
          <div className="space-y-2">
            <FormLabel htmlFor={`${id}-note`}>{mode === "no_change" ? "Note (optional): who you asked" : "Note (optional): where they went"}</FormLabel>
            <input id={`${id}-note`} className={fieldClass} value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" className="min-h-11" disabled={busy}>{busy ? "Saving…" : mode === "no_change" ? "Confirm no change" : "Confirm resident left"}</Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => { setMode("idle"); setError(null); }}>Cancel</Button>
          </div>
          <div className="sm:col-span-2"><ErrorNotice error={error} /></div>
        </form>
      )}
      {mode === "changed" && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Record the new answers. If the resident now qualifies, the case goes to Jessica to resubmit.</p>
          <AdmissionMedicaidScreening residentId={row.resident_id} onSaved={async () => { setMode("idle"); await onDone(); }} />
          <Button variant="outline" className="min-h-11" onClick={() => setMode("idle")}>Close</Button>
        </div>
      )}
    </li>
  );
}

function useRechecks(facilityId: string | undefined, withinDays: number) {
  const [data, setData] = useState<RecheckList | null>(null);
  const [error, setError] = useState<{ message: string; noAccess: boolean } | null>(null);
  const load = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams({ within_days: String(withinDays) });
    if (facilityId) params.set("facility_id", facilityId);
    try {
      const body = await benefitsFetch<RecheckList>(`/api/admin/benefits/rechecks?${params}`);
      // An unexpected reply is an error, never "nothing due".
      if (!body || !Array.isArray(body.rechecks)) throw new Error("Rechecks could not be verified. Please try again.");
      setData(body);
    } catch (caught) {
      const noAccess = caught instanceof BenefitsRequestError && (caught.status === 403 || caught.status === 404);
      setError({ message: caught instanceof Error ? caught.message : "Unable to load rechecks.", noAccess });
    }
  }, [facilityId, withinDays]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, load };
}

/** Full list for Medicaid & benefits → Rechecks. */
export function MedicaidRechecksPanel({ facilityId }: { facilityId?: string }) {
  const [withinDays, setWithinDays] = useState(14);
  const { data, error, load } = useRechecks(facilityId, withinDays);
  return (
    <Panel title="Medicaid rechecks" description="Residents who did not qualify last time are asked the Medicaid questions again every quarter. Record what changed, or confirm nothing did.">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Show:</span>
        {[{ days: 14, label: "Due in the next 2 weeks" }, { days: 400, label: "All scheduled" }].map((option) => (
          <Button key={option.days} variant={withinDays === option.days ? "default" : "outline"} size="sm" className="min-h-11" aria-pressed={withinDays === option.days} onClick={() => setWithinDays(option.days)}>{option.label}</Button>
        ))}
      </div>
      {error && <ErrorNotice error={error.noAccess ? "Rechecks are visible to staff with Medicaid access for this facility. Ask an owner to grant access under Medicaid & benefits → Access." : error.message} />}
      {!data && !error && <p role="status">Loading rechecks…</p>}
      {data && data.rechecks.length === 0 && <p className="text-sm text-muted-foreground">{withinDays === 14 ? "No rechecks due in the next two weeks." : "No rechecks scheduled."}</p>}
      {data && data.rechecks.length > 0 && (
        <ul className="divide-y divide-border">{data.rechecks.map((row) => <RecheckItem key={row.id} row={row} onDone={load} />)}</ul>
      )}
    </Panel>
  );
}

/** Facility Operator Home card. Quiet when there is nothing due or the viewer has no Medicaid access. */
export function MedicaidRechecksHomeCard({ facilityId }: { facilityId: string }) {
  const { data, error } = useRechecks(facilityId, 14);
  if (error?.noAccess || !data || data.rechecks.length === 0) {
    return error && !error.noAccess ? (
      <section className={CARD_CLASS} aria-label="Medicaid rechecks"><p className="px-4 py-3 text-sm text-muted-foreground">Medicaid rechecks could not be loaded.</p></section>
    ) : null;
  }
  const overdue = data.rechecks.filter((row) => row.overdue).length;
  return (
    <section className={CARD_CLASS} aria-label="Medicaid rechecks">
      <div className={CARD_HEAD_CLASS}>
        <h2 className="text-sm font-semibold">Medicaid rechecks</h2>
        <StatusPill tone={overdue ? "warning" : "muted"}>{overdue ? `${overdue} overdue` : `${data.rechecks.length} due soon`}</StatusPill>
      </div>
      <ul className="divide-y divide-border/60 px-4">
        {data.rechecks.slice(0, 5).map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>{row.resident_name}</span>
            <span className="text-muted-foreground">{row.overdue ? `Overdue ${dateLabel(row.due_on)}` : `Due ${dateLabel(row.due_on)}`}</span>
          </li>
        ))}
      </ul>
      <div className="px-4 py-3">
        <Link href={`/admin/benefits?view=rechecks&facility_id=${encodeURIComponent(facilityId)}`} className={LINK_BUTTON_CLASS}>Ask the Medicaid questions again →</Link>
      </div>
    </section>
  );
}
