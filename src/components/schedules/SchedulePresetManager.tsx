"use client";

import { useEffect, useRef, useState } from "react";
import { BackLink } from "@/design-system/components/BackLink";
import { FacilityGate, useFacilityGateScope } from "@/components/common/FacilityGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { registerRouteLeaveGuard } from "@/components/layout/navigation-pending";
import { createClient } from "@/lib/supabase/client";
import { enumLabel } from "@/lib/display/enum-label";
import { Constants } from "@/types/database";
import { canManageSchedulePresets, loadSchedulePresets, presetColorStyle, roleAllowsPreset, saveSchedulePreset, validatePresetBlocks, type SaveSchedulePresetInput, type SchedulePreset } from "@/lib/schedules/presets";

const ROLES = [...Constants.public.Enums.staff_role].sort((a, b) => enumLabel(a).localeCompare(enumLabel(b)));
const PANEL = "rounded-xl border border-border bg-card p-5";
const roleLabel = (role: string) => enumLabel(role, { case: "title" });
const newDraft = (facilityId: string): SaveSchedulePresetInput => ({ facilityId, presetId: null, expectedVersion: 0, label: "", color: "#64748B", sortOrder: 0, roundingCoverage: false, blocks: [{ start: "", end: "" }], allowedStaffRoles: [], active: true });
const editDraft = (preset: SchedulePreset): SaveSchedulePresetInput => ({ facilityId: preset.facility_id, presetId: preset.id, expectedVersion: preset.version, label: preset.label, color: preset.color, sortOrder: preset.sort_order, roundingCoverage: preset.rounding_coverage, blocks: preset.blocks.map((block) => ({ ...block })), allowedStaffRoles: [...preset.allowed_staff_roles], active: preset.active });

export function SchedulePresetManager() {
  const { facilityId } = useFacilityGateScope();
  const { user, loading } = useHavenAuth();
  return <FacilityGate title="Shift options" reason="Each facility defines its own work blocks and eligible staff roles.">{loading ? <p role="status">Loading shift options…</p> : facilityId && <FacilityPresetManager key={`${facilityId}:${user?.id}`} facilityId={facilityId} />}</FacilityGate>;
}

function FacilityPresetManager({ facilityId }: { facilityId: string }) {
  const { appRole } = useHavenAuth();
  const canEdit = canManageSchedulePresets(appRole);
  const facilityName = useFacilityStore((state) => state.availableFacilities.find((facility) => facility.id === facilityId)?.name);
  const registerFacilityGuard = useFacilityStore((state) => state.registerFacilityChangeGuard);
  const [presets, setPresets] = useState<SchedulePreset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [role, setRole] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [draft, setDraft] = useState<SaveSchedulePresetInput | null>(null);
  const [original, setOriginal] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const mounted = useRef(true);
  const dirty = !!draft && JSON.stringify(draft) !== original;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    setPresets(null); setError(null);
    void loadSchedulePresets(createClient(), facilityId, { includeInactive: true }).then((rows) => { if (!cancelled) setPresets(rows); }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load shift options."); });
    return () => { cancelled = true; };
  }, [facilityId, refresh]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const confirm = () => !busy && window.confirm("Discard unsaved shift-option changes?");
    const removeRoute = registerRouteLeaveGuard((silent) => !silent && confirm());
    const removeFacility = registerFacilityGuard(() => confirm());
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { removeRoute(); removeFacility(); window.removeEventListener("beforeunload", beforeUnload); };
  }, [dirty, busy, registerFacilityGuard]);
  const select = (next: SaveSchedulePresetInput | null) => {
    if (busy || (dirty && !window.confirm("Discard unsaved shift-option changes?"))) return;
    setDraft(next); setOriginal(JSON.stringify(next)); setSavedMessage(null); setError(null);
  };
  const reload = () => {
    if (busy || (dirty && !window.confirm("Discard unsaved shift-option changes and reload?"))) return;
    setDraft(null); setOriginal(""); setRefresh((value) => value + 1);
  };
  const update = (patch: Partial<SaveSchedulePresetInput>) => setDraft((current) => current ? { ...current, ...patch } : null);
  const validation = draft ? validatePresetBlocks(draft.blocks) : null;
  const save = async () => {
    if (!draft || !canEdit || busy || !validation?.valid) return;
    setBusy(true); setError(null); setSavedMessage(null);
    try {
      const saved = await saveSchedulePreset(createClient(), draft);
      if (!mounted.current) return;
      setPresets((rows) => [...(rows ?? []).filter((row) => row.id !== saved.id), saved].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)));
      const next = editDraft(saved); setDraft(next); setOriginal(JSON.stringify(next)); setSavedMessage(`${saved.label} saved${saved.active ? "" : " as inactive"}. Existing assignments keep their saved times and labels.`);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Could not save the shift option."); }
    finally { if (mounted.current) setBusy(false); }
  };
  const visible = presets?.filter((preset) => (showInactive || preset.active) && (!role || (preset.active ? roleAllowsPreset(preset, role) : preset.allowed_staff_roles.includes(role))));
  return <div className="space-y-6">
    <BackLink label="Schedules" href="/admin/schedules" />
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-semibold">Shift options</h1><p className="mt-2 text-muted-foreground">{facilityName ?? "This facility"} · Set the choices staff scheduling can use for each job role.</p><p className="mt-1 text-sm text-muted-foreground">One option can contain several work blocks. Gaps are excluded from planned hours. Payroll still uses actual reviewed time.</p></div>{canEdit && <Button disabled={busy || !presets} onClick={() => select(newDraft(facilityId))}>New shift option</Button>}</header>
    {!canEdit && <p className="text-sm text-muted-foreground">Facility scheduling leadership can edit these options.</p>}
    {error && <div role="alert" className={`${PANEL} text-destructive`}>{error}<Button type="button" variant="outline" className="ml-3" disabled={busy} onClick={reload}>Reload options</Button></div>}
    {savedMessage && <p role="status" className={PANEL}>{savedMessage}</p>}
    {presets === null ? !error && <p role="status">Loading shift options…</p> : <>
      <div className="flex flex-wrap items-center gap-4"><label className="flex items-center gap-2 text-sm">Job role<select className="rounded-lg border border-input bg-background px-3 py-2" value={role} onChange={(event) => setRole(event.target.value)}><option value="">All job roles</option>{ROLES.map((value) => <option key={value} value={value}>{roleLabel(value)}</option>)}</select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />Show inactive options</label></div>
      {!presets.length ? <p className={PANEL}>No shift options are configured here. Add explicit work times and eligible roles to get started.</p> : !visible?.length ? <p className={PANEL}>No options match these filters.</p> : <div className="grid gap-3 md:grid-cols-2">{visible.map((preset) => <article key={preset.id} className={PANEL}><div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-lg px-3 py-2 text-sm font-semibold" style={presetColorStyle(preset.color)}>{preset.label}</span>{canEdit && <Button type="button" variant="outline" disabled={busy} onClick={() => select(editDraft(preset))}>Edit {preset.label}</Button>}</div><p className="mt-3 text-sm">{preset.blocks.map((block) => `${block.start}–${block.end}${block.end < block.start ? " (+1 day)" : ""}`).join(" · ")}</p><p className="mt-1 text-sm text-muted-foreground">{validatePresetBlocks(preset.blocks).totalMinutes == null ? "Unknown" : (validatePresetBlocks(preset.blocks).totalMinutes! / 60).toFixed(2)} planned hours · Display order {preset.sort_order} · {preset.active ? "Active" : "Inactive"}</p><p className="mt-2 text-xs text-muted-foreground">{preset.allowed_staff_roles.map(roleLabel).join(", ")}</p></article>)}</div>}
    </>}
    {draft && canEdit && <form className={`${PANEL} space-y-5`} aria-label="Shift option editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div><h2 className="text-lg font-semibold">{draft.presetId ? `Edit ${draft.label || "shift option"}` : "New shift option"}</h2><p className="mt-1 text-sm text-muted-foreground">Saved changes apply to new selections. Existing published or draft assignments keep their saved blocks.</p></div>
      <fieldset disabled={busy} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1 text-sm"><span>Label</span><Input required maxLength={60} value={draft.label} onChange={(event) => update({ label: event.target.value })} /></label><label className="space-y-1 text-sm"><span>Display order</span><Input type="number" required min={0} max={10000} step={1} value={Number.isFinite(draft.sortOrder) ? draft.sortOrder : ""} onChange={(event) => update({ sortOrder: event.target.value === "" ? NaN : Number(event.target.value) })} /></label></div>
        <div className="flex flex-wrap items-end gap-3"><label className="space-y-1 text-sm"><span>Color</span><Input className="h-10 w-16 p-1" type="color" value={/^#[0-9a-f]{6}$/i.test(draft.color) ? draft.color : "#64748B"} onChange={(event) => update({ color: event.target.value })} /></label><label className="space-y-1 text-sm"><span>Hex color</span><Input required pattern="#[0-9a-fA-F]{6}" maxLength={7} value={draft.color} onChange={(event) => update({ color: event.target.value })} /></label><span className="rounded-lg px-3 py-2 text-sm font-semibold" style={presetColorStyle(draft.color)}>{draft.label || "Color preview"}</span></div>
        <fieldset className="space-y-3"><legend className="text-sm font-semibold">Work blocks</legend><p className="text-sm text-muted-foreground">List blocks in start-time order. Every start belongs to the schedule date; a finish earlier than its start is the next day.</p>{draft.blocks.map((block, index) => <div key={index} className="flex flex-wrap items-end gap-3"><span className="pb-2 text-sm">Block {index + 1}</span><label className="space-y-1 text-sm"><span>Start</span><Input required aria-label={`Block ${index + 1} start`} type="time" value={block.start} onChange={(event) => update({ blocks: draft.blocks.map((value, i) => i === index ? { ...value, start: event.target.value } : value) })} /></label><label className="space-y-1 text-sm"><span>Finish</span><Input required aria-label={`Block ${index + 1} finish`} type="time" value={block.end} onChange={(event) => update({ blocks: draft.blocks.map((value, i) => i === index ? { ...value, end: event.target.value } : value) })} /></label><Button variant="outline" type="button" disabled={draft.blocks.length === 1} onClick={() => update({ blocks: draft.blocks.filter((_, i) => i !== index) })}>Remove block {index + 1}</Button></div>)}<Button variant="outline" type="button" disabled={draft.blocks.length >= 8} onClick={() => update({ blocks: [...draft.blocks, { start: "", end: "" }] })}>Add work block</Button>{validation?.valid ? <p className="text-sm">{(validation.totalMinutes! / 60).toFixed(2)} typical planned hours, excluding gaps. Elapsed hours can differ across daylight-saving changes.</p> : <ul className="list-disc pl-5 text-sm text-muted-foreground">{validation?.errors.map((message) => <li key={message}>{message}</li>)}</ul>}</fieldset>
        <fieldset><legend className="text-sm font-semibold">Available to these job roles</legend><p className="mt-1 text-sm text-muted-foreground">Choose staff job titles. This does not grant application or clinical permissions.</p><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{ROLES.map((value) => <label key={value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.allowedStaffRoles.includes(value)} onChange={(event) => update({ allowedStaffRoles: event.target.checked ? [...draft.allowedStaffRoles, value] : draft.allowedStaffRoles.filter((selected) => selected !== value) })} />{roleLabel(value)}</label>)}</div>{!draft.allowedStaffRoles.length && <p className="mt-2 text-sm text-muted-foreground">Choose at least one job role.</p>}</fieldset>
        <div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.roundingCoverage} onChange={(event) => update({ roundingCoverage: event.target.checked })} />Use for resident check coverage</label><p className="mt-1 text-sm text-muted-foreground">Only staff already authorized for resident checks can be assigned. This does not grant clinical permission or change check timing.</p></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.active} onChange={(event) => update({ active: event.target.checked })} />Active — available for new schedule selections</label>
        <div className="flex gap-2"><Button type="submit" disabled={!validation?.valid || !draft.label.trim() || !/^#[0-9a-f]{6}$/i.test(draft.color) || !draft.allowedStaffRoles.length || !Number.isInteger(draft.sortOrder) || draft.sortOrder < 0 || draft.sortOrder > 10000 || (!!draft.presetId && !dirty)}>{busy ? "Saving…" : "Save shift option"}</Button><Button variant="outline" type="button" onClick={() => select(null)}>Cancel</Button></div>
      </fieldset>
    </form>}
  </div>;
}
