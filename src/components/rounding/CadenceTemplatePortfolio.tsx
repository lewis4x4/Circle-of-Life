"use client";

import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CadencePolicyDiff } from "./CadencePolicyDiff";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { APPLY_MODES, APPLY_MODE_LABELS, rungDraftsFrom, windowDraftsFrom, type ApplyMode, type RungDraft, type WindowDraft } from "@/lib/rounding/cadence-settings";
import { fetchObservationConfigOverview } from "@/lib/rounding/cadence-settings-fetch";
import { applyObservationTemplate, fetchTemplatePortfolio, saveObservationTemplate, type PortfolioFacility, type TemplateCatalog, type TemplateOutcome } from "@/lib/rounding/cadence-template-fetch";
import { roundingCommandRefusal } from "@/lib/rounding/rounding-query-error";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";

type Target = { facility: PortfolioFacility; applyMode: ApplyMode; effectiveFrom: string; before: WindowDraft[] | RungDraft[] };

export function CadenceTemplatePortfolio({ facilityId, windows, rungs, onEditTemplate }: { facilityId: string; windows: WindowDraft[]; rungs: RungDraft[]; onEditTemplate?: (kind: "cadence" | "escalation", rows: WindowDraft[] | RungDraft[]) => void }) {
  const client = useMemo(() => createClient() as unknown as SupabaseClient, []);
  const [data, setData] = useState<{ catalog: TemplateCatalog; portfolio: PortfolioFacility[] } | null>(null);
  const [kind, setKind] = useState<"cadence" | "escalation">("cadence");
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [acknowledgment, setAcknowledgment] = useState("");
  const [targets, setTargets] = useState<Target[]>([]);
  const [results, setResults] = useState<TemplateOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const templates = data ? kind === "cadence" ? data.catalog.cadence_templates : data.catalog.escalation_templates : [];
  const selected = templates.find((row) => row.id === templateId);
  const proposed = selected ? kind === "cadence" ? selected.windows : selected.rungs : null;
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await action(); } catch (failure) { setError(roundingCommandRefusal(failure, "This template operation could not be completed. Retry.")); }
    finally { setBusy(false); }
  };
  const load = () => run(async () => { setData(await fetchTemplatePortfolio(client, facilityId)); });
  const preview = (facility: PortfolioFacility) => run(async () => {
    const overview = await fetchObservationConfigOverview(client, facility.facility_id);
    const before = kind === "cadence" ? windowDraftsFrom(overview.current.day_shape) : rungDraftsFrom(overview.current.ladder);
    setTargets((rows) => [...rows.filter((row) => row.facility.facility_id !== facility.facility_id), { facility, applyMode: "next_shift_boundary", effectiveFrom: "", before }]);
  });
  return <details className="space-y-3 rounded-lg border border-border p-4">
    <summary className="cursor-pointer text-sm font-semibold">Organization templates and portfolio drift</summary>
    <div className="mt-4 space-y-4">
      <Button variant="outline" disabled={busy} onClick={() => void load()}>{data ? "Refresh portfolio" : "Load portfolio"}</Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {data && <fieldset disabled={busy} className="space-y-4">
        <HorizontalScroll label="Cadence templates by facility"><table className="w-full text-left text-sm"><thead><tr><th>Facility</th><th>Observation template</th><th>Escalation template</th><th>Drift</th><th>Apply</th></tr></thead>
          <tbody>{data.portfolio.map((facility) => <tr key={facility.facility_id} className="border-t border-border"><td>{facility.facility_name}</td><td>{facility.cadence_template_name ?? "Custom"}</td><td>{facility.escalation_template_name ?? "Custom"}</td><td>{facility.cadence_drift_count} windows, {facility.escalation_drift_count} rungs</td><td><Button size="sm" variant="ghost" disabled={!selected || busy} onClick={() => void preview(facility)}>Preview for this facility</Button></td></tr>)}</tbody>
        </table></HorizontalScroll>
        <label className="block text-sm">Template type<Select value={kind} disabled={busy} onValueChange={(value) => { setKind(value as typeof kind); setTemplateId(""); setTargets([]); setResults([]); }}><SelectTrigger aria-label="Template type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cadence">Observation schedule</SelectItem><SelectItem value="escalation">Escalation ladder</SelectItem></SelectContent></Select></label>
        <label className="block text-sm">Template<Select value={templateId || "new"} disabled={busy} onValueChange={(value) => { setTemplateId(value === "new" ? "" : value); setName(""); setTargets([]); setResults([]); setAcknowledgment(""); }}><SelectTrigger aria-label="Template"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new">New template</SelectItem>{templates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name} · version {template.version_number}</SelectItem>)}</SelectContent></Select></label>
        {selected && proposed && onEditTemplate && <Button variant="outline" onClick={() => onEditTemplate(kind, structuredClone(proposed))}>Load selected template into the editor</Button>}
        <label className="block text-sm">Template name<Input value={name} onChange={(e) => setName(e.target.value)} placeholder={selected?.name} /></label>
        <label className="block text-sm">Reason for this change<Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <p className="text-sm text-muted-foreground">Save the facility editor&apos;s current {kind === "cadence" ? "windows" : "rungs"} as an immutable template revision. Saving does not apply it to any facility. Review each target below before applying.</p>
        <Button variant="outline" disabled={busy || !reason.trim() || !(name.trim() || selected?.name)} onClick={() => void run(async () => {
          const result = await saveObservationTemplate(client, { facilityId, kind, name: name.trim() || selected!.name, reason, rows: kind === "cadence" ? windows : rungs, templateId: templateId || null });
          setData(await fetchTemplatePortfolio(client, facilityId)); setTemplateId(result.template_id); setTargets([]); setResults([]);
        })}>Save immutable template revision</Button>
        {targets.map((target) => <div key={target.facility.facility_id} className="space-y-2 rounded border border-border p-3">
          <h3 className="text-sm font-semibold">{target.facility.facility_name}: current → {selected?.name}</h3>
          <CadencePolicyDiff before={target.before} after={proposed ?? []} />
          <label className="block text-sm">Effective timing for {target.facility.facility_name}<Select value={target.applyMode} disabled={busy} onValueChange={(value) => setTargets((rows) => rows.map((row) => row === target ? { ...row, applyMode: value as ApplyMode } : row))}><SelectTrigger aria-label={`Effective timing for ${target.facility.facility_name}`}><SelectValue /></SelectTrigger><SelectContent>{APPLY_MODES.map((mode) => <SelectItem key={mode} value={mode}>{APPLY_MODE_LABELS[mode]}</SelectItem>)}</SelectContent></Select></label>
          {target.applyMode === "scheduled" && <label htmlFor={`template-time-${target.facility.facility_id}`} className="block text-sm">Scheduled time (your local timezone)<DateTimePicker id={`template-time-${target.facility.facility_id}`} value={target.effectiveFrom} disabled={busy} onValueChange={(value) => setTargets((rows) => rows.map((row) => row === target ? { ...row, effectiveFrom: value } : row))} /></label>}
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setTargets((rows) => rows.filter((row) => row !== target))}>Remove target</Button>
        </div>)}
        {targets.length > 0 && selected && <>
          <p className="text-sm text-warning">Immediate changes cancel and rebuild pending future checks. Completed and missed checks remain unchanged. Type {selected.name} to acknowledge each selected facility&apos;s policy and timing.</p>
          <Input aria-label="Template acknowledgment" value={acknowledgment} onChange={(e) => setAcknowledgment(e.target.value)} />
          <Button disabled={busy || acknowledgment !== selected.name || !reason.trim() || targets.some((row) => row.applyMode === "scheduled" && !row.effectiveFrom)} onClick={() => void run(async () => {
            const outcomes: TemplateOutcome[] = [];
            for (const target of targets) {
              try { outcomes.push(await applyObservationTemplate(client, { facilityId: target.facility.facility_id, templateId: selected.id, expectedVersionId: selected.version_id, kind, reason, applyMode: target.applyMode, effectiveFrom: target.applyMode === "scheduled" ? new Date(target.effectiveFrom).toISOString() : null, acknowledgment })); }
              catch (failure) { outcomes.push({ facility_id: target.facility.facility_id, ok: false, reason: roundingCommandRefusal(failure, "Apply failed") }); }
              setResults([...outcomes]);
            }
            setData(await fetchTemplatePortfolio(client, facilityId));
          })}>Apply to {targets.length} selected facilities</Button>
        </>}
        {results.length > 0 && <ul aria-label="Per-facility application results" className="space-y-2 text-sm">{results.map((result) => <li key={result.facility_id}>{data.portfolio.find((row) => row.facility_id === result.facility_id)?.facility_name ?? result.facility_id}: {result.ok ? `Scheduled / applied for ${result.effective_from}` : `Failed — ${result.reason}`}</li>)}</ul>}
      </fieldset>}
    </div>
  </details>;
}
