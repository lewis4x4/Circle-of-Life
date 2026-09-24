"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PayrollPolicy, PayrollPolicyRecord } from "@/lib/payroll-packets/types";
import { fieldClass, panelClass, request, useDraftGuard } from "./shared";

type Props = { facilityId: string; policy: PayrollPolicyRecord | null; facilities: Array<{ id: string; name: string }>; onSaved: () => void };
export default function PolicyForm({ facilityId, policy, facilities, onSaved }: Props) {
  const [config, setConfig] = useState<Partial<PayrollPolicy>>(policy?.config ?? {});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attested, setAttested] = useState(false);
  useDraftGuard(dirty, busy);
  const change = <K extends keyof PayrollPolicy>(key: K, value: PayrollPolicy[K] | undefined) => {
    setConfig((old) => ({ ...old, [key]: value })); setDirty(true); setAttested(false);
  };
  const select = (label: string, key: keyof PayrollPolicy, choices: Array<[string, string]>) => <label className="space-y-1 text-sm"><span>{label}</span><select className={fieldClass} value={String(config[key] ?? "")} onChange={(event) => change(key, event.target.value || undefined)}><option value="">Choose…</option>{choices.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>;
  const input = (label: string, key: "employerName" | "anchorDate" | "workweekTime" | "timeZone", type = "text") => <label className="space-y-1 text-sm"><span>{label}</span><input className={fieldClass} type={type} value={config[key] ?? ""} onChange={(event) => change(key, event.target.value)} /></label>;
  async function save(confirm: boolean) {
    setBusy(true); setError(null);
    try {
      await request("/api/admin/payroll-packets/policy", { method: "PUT", body: JSON.stringify({ facilityId, config: Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0))), confirm, expectedRevision: policy?.revision ?? 0 }) });
      setDirty(false); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save payroll rules."); }
    finally { setBusy(false); }
  }
  return <section className={panelClass} aria-labelledby="payroll-policy-heading">
    <h2 id="payroll-policy-heading" className="text-lg font-semibold">Payroll rules</h2>
    <p className="mt-1 text-sm text-muted-foreground">Save incomplete rules as a draft. Confirm only after the payroll owner verifies all choices. Changing confirmed rules requires confirmation again.</p>
    <fieldset disabled={busy} className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {input("Legal employer name", "employerName")}
      {select("Pay frequency", "payFrequency", [["weekly", "Weekly"], ["biweekly", "Every two weeks"]])}
      {input("First day of a known pay period", "anchorDate", "date")}
      <label className="space-y-1 text-sm"><span>Workweek starts on</span><select className={fieldClass} value={config.workweekDay ?? ""} onChange={(e) => change("workweekDay", e.target.value === "" ? undefined : Number(e.target.value))}><option value="">Choose…</option>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, i) => <option key={day} value={i}>{day}</option>)}</select></label>
      {input("Workweek starts at", "workweekTime", "time")}
      {input("Time zone (for example America/New_York)", "timeZone")}
      <label className="space-y-1 text-sm"><span>Weekly overtime threshold (hours)</span><input className={fieldClass} type="number" min="1" step="0.25" value={config.overtimeThresholdMinutes == null ? "" : config.overtimeThresholdMinutes / 60} onChange={(e) => change("overtimeThresholdMinutes", e.target.value === "" ? undefined : Math.round(Number(e.target.value) * 60))} /></label>
      {select("Hours allocation", "calculationMode", [["automatic", "Calculate from kiosk timecards"], ["reviewed", "Enter payroll-reviewed hours"]])}
      {select("Meal treatment", "mealPolicy", [["punched_unpaid", "Deduct recorded meal punches"], ["paid", "Meals are paid"]])}
      <label className="space-y-1 text-sm"><span>Punch rounding</span><select className={fieldClass} value={config.roundingMinutes ?? ""} onChange={(e) => change("roundingMinutes", e.target.value === "" ? undefined : Number(e.target.value) as PayrollPolicy["roundingMinutes"])}><option value="">Choose…</option>{[0, 5, 6, 15].map((value) => <option key={value} value={value}>{value === 0 ? "No punch rounding (whole completed minutes)" : `Nearest ${value} minutes`}</option>)}</select></label>
      {select("Salary presentation", "salaryTreatment", [["hours", "Show hours"], ["amount", "Show dollar amount"], ["unchanged", "Salary — unchanged"]])}
      {select("Who may approve", "approvalRole", [["central", "Owner / organization administrator"], ["facility", "Facility administrator or central office"]])}
      {select("Usual reporting method", "defaultMethod", [["phone", "Phone call"], ["run", "RUN online entry"]])}
      <fieldset className="space-y-2 sm:col-span-2 lg:col-span-3"><legend className="mb-2 text-sm font-medium">Facilities that share this employer’s overtime calculation</legend>{facilities.map((facility) => <label key={facility.id} className="mr-5 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={config.overtimeFacilityIds?.includes(facility.id) ?? false} onChange={(e) => change("overtimeFacilityIds", e.target.checked ? [...(config.overtimeFacilityIds ?? []), facility.id] : (config.overtimeFacilityIds ?? []).filter((id) => id !== facility.id))} />{facility.name}</label>)}</fieldset>
      <label className="space-y-1 text-sm sm:col-span-2 lg:col-span-3"><span>Payroll owner’s rule notes / source</span><textarea className={fieldClass} rows={3} value={config.policyNote ?? ""} onChange={(e) => change("policyNote", e.target.value)} /></label>
    </fieldset>
    <p className="mt-4 text-sm text-muted-foreground">Automatic calculation treats training as part of worked hours, not additional hours. Holiday and personal leave do not contribute to worked overtime. Use reviewed hours for other arrangements, with a reason for each allocation.</p>
    <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={attested} onChange={(e) => setAttested(e.target.checked)} /><span>I have verified these choices with the payroll owner and confirm they apply to this facility.</span></label>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void save(false)}>Save rules draft</Button><Button disabled={busy || !attested} onClick={() => void save(true)}>Confirm payroll rules</Button></div>
  </section>;
}
