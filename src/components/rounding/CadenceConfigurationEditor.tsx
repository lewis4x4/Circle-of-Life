"use client";

import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { ConfigurationSnapshot } from "@/lib/rounding/cadence-settings";
import { enumLabel } from "@/lib/display/enum-label";

export function CadenceConfigurationEditor({ value, onChange, disabled, onValidityChange, severityClasses, rosterShiftTypes }: {
  value: ConfigurationSnapshot; onChange: (next: ConfigurationSnapshot) => void; disabled: boolean; onValidityChange?: (valid: boolean) => void; severityClasses?: string[]; rosterShiftTypes?: string[];
}) {
  const [intervalText, setIntervalText] = useState(value.monitoring_interval_presets_minutes.join(", "));
  useEffect(() => { setIntervalText(value.monitoring_interval_presets_minutes.join(", ")); }, [value.monitoring_interval_presets_minutes]);
  const validIntervals = intervalText.split(",").every((part) => part.trim() !== "" && Number.isInteger(Number(part)) && Number(part) > 0);
  useEffect(() => { onValidityChange?.(validIntervals); }, [validIntervals, onValidityChange]);
  return <details className="space-y-3 rounded-lg border border-border p-4">
    <summary className="cursor-pointer text-sm font-semibold">Shift, Monitoring Order and Watchlist policy</summary>
    <fieldset disabled={disabled} className="mt-4 space-y-4">
      <legend className="sr-only">Facility policy</legend>
      <p className="text-sm text-muted-foreground">These changes are saved with the schedule proposal and take effect at its approved time. Retire a shift by turning it off; move its enabled windows to another shift first.</p>
      {value.shifts.map((shift, index) => {
        const update = (patch: Partial<typeof shift>) => onChange({ ...value, shifts: value.shifts.map((row, i) => i === index ? { ...row, ...patch } : row) });
        return <div key={index} className="grid gap-3 rounded border border-border p-3 sm:grid-cols-2">
          <label className="text-sm">Shift key<Input value={shift.shift_key} onChange={(e) => update({ shift_key: e.target.value })} /></label>
          <label className="text-sm">Shift label<Input value={shift.label} onChange={(e) => update({ label: e.target.value })} /></label>
          <label className="text-sm">Starts locally<Input placeholder="HH:MM" value={shift.starts_at_local} onChange={(e) => update({ starts_at_local: e.target.value })} /></label>
          <label className="text-sm">Ends locally<Input placeholder="HH:MM" value={shift.ends_at_local} onChange={(e) => update({ ends_at_local: e.target.value })} /></label>
          <label className="text-sm">Roster mapping<Select value={shift.roster_shift_type} disabled={disabled} onValueChange={(roster_shift_type) => update({ roster_shift_type })}><SelectTrigger aria-label={`Roster mapping for ${shift.label}`}><SelectValue /></SelectTrigger><SelectContent>
            {(rosterShiftTypes ?? [...new Set(value.shifts.map((row) => row.roster_shift_type))]).map((key) => <SelectItem key={key} value={key}>{enumLabel(key)}</SelectItem>)}
          </SelectContent></Select></label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={shift.enabled} onCheckedChange={(enabled) => update({ enabled })} />Shift enabled</label>
        </div>;
      })}
      <Button type="button" variant="outline" disabled={disabled || !value.shifts.length} onClick={() => {
        const source = value.shifts[0];
        onChange({ ...value, shifts: [...value.shifts, { ...source, shift_key: `shift_${crypto.randomUUID().replaceAll("-", "_")}`, label: "New shift", enabled: false, sort_order: value.shifts.length }] });
      }}>Add shift</Button>
      <label className="block text-sm">Monitoring intervals (minutes, separated by commas)
        <Input value={intervalText} aria-invalid={!validIntervals} onChange={(e) => setIntervalText(e.target.value)} onBlur={() => { if (validIntervals) onChange({ ...value, monitoring_interval_presets_minutes: intervalText.split(",").map(Number) }); }} />
      </label>
      {!validIntervals && <p role="alert" className="text-sm text-destructive">Enter positive whole minutes separated by commas. Remove any trailing comma before saving.</p>}
      <label className="block text-sm">Monitoring grace divisor<Input type="number" min="1" value={value.monitoring_grace_divisor} onChange={(e) => onChange({ ...value, monitoring_grace_divisor: Number(e.target.value) })} /></label>
      {(["maximum_unobserved_gap_minutes", "maximum_windows_per_resident_per_day"] as const).map((key) => <label key={key} className="block text-sm">
        {key === "maximum_unobserved_gap_minutes" ? "Largest unobserved gap warning (minutes)" : "Daily windows per resident warning"}
        <Input type="number" min="1" value={value.thresholds[key]} onChange={(e) => onChange({ ...value, thresholds: { ...value.thresholds, [key]: Number(e.target.value) } })} />
      </label>)}
      <h3 className="text-sm font-semibold">Watchlist signals</h3>
      {value.watchlist_rules.map((rule, index) => {
        const update = (patch: Partial<typeof rule>) => onChange({ ...value, watchlist_rules: value.watchlist_rules.map((row, i) => i === index ? { ...row, ...patch } : row) });
        return <div key={rule.signal_key} className="space-y-2 rounded border border-border p-3">
          <label className="flex items-center gap-2 text-sm"><Switch checked={rule.enabled} onCheckedChange={(enabled) => update({ enabled })} />{rule.label}</label>
          {["threshold_count", "lookback_days", "baseline_days", "threshold_percent", "secondary_threshold_percent", "secondary_lookback_days", "severity_weight"].filter((key) => rule[key] != null).map((key) => <label key={key} className="block text-sm">{enumLabel(key, { case: "lower" })}
            <Input type="number" value={Number(rule[key])} onChange={(e) => update({ [key]: Number(e.target.value) })} />
          </label>)}
          <label className="block text-sm">Severity class<Select value={rule.severity_class} disabled={disabled} onValueChange={(severity_class) => update({ severity_class })}><SelectTrigger aria-label={`Severity for ${rule.label}`}><SelectValue /></SelectTrigger><SelectContent>
            {(severityClasses ?? [...new Set(value.watchlist_rules.map((row) => row.severity_class))]).map((key) => <SelectItem key={key} value={key}>{enumLabel(key)}</SelectItem>)}
          </SelectContent></Select></label>
        </div>;
      })}
    </fieldset>
  </details>;
}
