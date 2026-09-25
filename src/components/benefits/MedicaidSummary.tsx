"use client";
import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FormLabel } from "@/components/ui/form-label";
import { dollars } from "@/lib/benefits/admission-screening";
import type { MedicaidSummary as SummaryData, MedicaidSummaryFacility } from "@/lib/benefits/contracts";
import { BenefitsRequestError, benefitsFetch, ErrorNotice, fieldClass, Panel } from "./benefits-ui";

/** Unknown stays unknown, never $0. */
export function moneyOrUnknown(cents: number | null, unknownLabel = "Unknown") {
  return cents == null ? unknownLabel : dollars(cents);
}
/** What-if from entered values only: N more Medicaid residents at the plan rate versus the same beds at the private rate. */
export function whatIf(beds: string, privateRate: string, planRate: string) {
  const n = Number(beds), priv = Math.round(Number(privateRate) * 100), plan = Math.round(Number(planRate) * 100);
  if (!Number.isInteger(n) || n <= 0 || !Number.isFinite(priv) || priv <= 0 || !Number.isFinite(plan) || plan <= 0) return null;
  return { plan_monthly_cents: n * plan, private_monthly_cents: n * priv, difference_cents: n * plan - n * priv };
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

function WhatIf() {
  const id = useId();
  const [beds, setBeds] = useState(""), [privateRate, setPrivateRate] = useState(""), [planRate, setPlanRate] = useState("");
  const result = whatIf(beds, privateRate, planRate);
  return (
    <details className="rounded-md border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">What if we add Medicaid-pending beds?</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><FormLabel htmlFor={`${id}-beds`}>Beds</FormLabel><input id={`${id}-beds`} inputMode="numeric" className={fieldClass} value={beds} onChange={(e) => setBeds(e.target.value)} /></div>
        <div className="space-y-1"><FormLabel htmlFor={`${id}-private`}>Private rate ($/month)</FormLabel><input id={`${id}-private`} inputMode="decimal" className={fieldClass} value={privateRate} onChange={(e) => setPrivateRate(e.target.value)} /></div>
        <div className="space-y-1"><FormLabel htmlFor={`${id}-plan`}>Plan rate ($/month)</FormLabel><input id={`${id}-plan`} inputMode="decimal" className={fieldClass} value={planRate} onChange={(e) => setPlanRate(e.target.value)} /></div>
      </div>
      <p className="mt-2 text-sm" role="status">
        {result
          ? `${dollars(result.plan_monthly_cents)} a month at the plan rate, against ${dollars(result.private_monthly_cents)} at the private rate (${result.difference_cents >= 0 ? "+" : "−"}${dollars(Math.abs(result.difference_cents))}).`
          : "Enter beds and both rates. Only the numbers you enter are used."}
      </p>
    </details>
  );
}

function GoalEditor({ card, data, onSaved }: { card: MedicaidSummaryFacility; data: SummaryData; onSaved: () => Promise<void> }) {
  const id = useId();
  const [value, setValue] = useState(card.goal_medicaid_residents == null ? "" : String(card.goal_medicaid_residents));
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const save = async () => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 1000) { setError("Enter a whole number of Medicaid residents."); return; }
    setBusy(true); setError(null);
    const goals = data.facilities.filter((f) => f.goal_medicaid_residents != null && f.facility_id !== card.facility_id).map((f) => ({ facility_id: f.facility_id, medicaid_residents: f.goal_medicaid_residents! }));
    try {
      await benefitsFetch("/api/admin/benefits/rules", { method: "POST", body: JSON.stringify({ rule_key: "summary.goals", value: [...goals, { facility_id: card.facility_id, medicaid_residents: n }], effective_from: data.as_of, reason: `Monthly Medicaid goal for ${card.facility_name} set from the owner summary` }) });
      await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the goal."); } finally { setBusy(false); }
  };
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="space-y-1"><FormLabel htmlFor={`${id}-goal`}>Goal (Medicaid residents)</FormLabel><input id={`${id}-goal`} inputMode="numeric" className={`${fieldClass} w-28`} value={value} onChange={(e) => setValue(e.target.value)} /></div>
      <Button type="submit" variant="outline" className="min-h-11" disabled={busy || !value.trim()}>{busy ? "Saving…" : "Set goal"}</Button>
      <ErrorNotice error={error} />
    </form>
  );
}

function FacilityCard({ card, data, onSaved }: { card: MedicaidSummaryFacility; data: SummaryData; onSaved: () => Promise<void> }) {
  const steps = data.steps.filter((s) => card.by_step[s.step]);
  const sweepHint = card.sweep_started_at ? `Sweep: ${card.sweep_answered} of ${card.census} answered` : "Sweep not started";
  return (
    <Panel title={card.facility_name} description={`${card.census} in census of ${card.licensed_beds} licensed beds (holds count as occupied).`}>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="On Medicaid now" value={String(card.medicaid_residents)} hint={card.goal_medicaid_residents == null ? "No goal set" : `Goal ${card.goal_medicaid_residents}`} />
        <Stat label="Open applications" value={String(card.open_cases)} hint={sweepHint} />
        <Stat label="Approved this month" value={String(card.approved_this_month)} hint={`${card.awaiting_first_payment} awaiting first payment`} />
        <Stat label="Medicaid payments this month" value={moneyOrUnknown(card.medicaid_payments_this_month_cents, "Not in Haven billing yet")} />
        <Stat label="Not yet collected" value={moneyOrUnknown(card.revenue_not_collected_cents)} hint={card.cases_without_rate ? `${card.cases_without_rate} case${card.cases_without_rate === 1 ? "" : "s"} with no rate set` : undefined} />
      </dl>
      {steps.length > 0 && (
        <p className="text-sm">Where applications are: {steps.map((s) => `${s.label} ${card.by_step[s.step]}`).join(" · ")}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Link className="text-sm underline" href={`/admin/benefits?facility_id=${card.facility_id}`}>Open the board</Link>
        {data.can_set_goals && <GoalEditor card={card} data={data} onSaved={onSaved} />}
      </div>
    </Panel>
  );
}

/** COL-775: live replacement for the hand-typed Murphy Notes owner report. */
export function MedicaidSummary() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const body = await benefitsFetch<SummaryData>("/api/admin/benefits/summary");
      if (!body || !Array.isArray(body.facilities)) throw new Error("The summary could not be verified. Please try again.");
      setData(body); setError(null);
    } catch (e) {
      setError(e instanceof BenefitsRequestError && e.status === 403 ? "The Medicaid summary is for owners and facility executives." : e instanceof Error ? e.message : "Unable to load the summary.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Medicaid summary</h1>
        <p className="text-sm text-muted-foreground">Live from the board, the census and billing. Nothing is projected from unreviewed data; unknown shows as unknown.</p>
      </div>
      <ErrorNotice error={error} />
      {!data && !error && <p role="status">Loading the summary…</p>}
      {data && data.facilities.length === 0 && <p className="text-sm text-muted-foreground">No facilities to show.</p>}
      {data?.facilities.map((card) => <FacilityCard key={card.facility_id} card={card} data={data} onSaved={load} />)}
      {data && <WhatIf />}
    </div>
  );
}
