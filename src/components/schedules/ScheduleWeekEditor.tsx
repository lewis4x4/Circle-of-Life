"use client";

import "@/components/schedules/schedule-print.css";
import { formatDateTimeWith } from "@/lib/format/datetime";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { Copy, Download, Printer, Save, Send } from "lucide-react";
import { AdminEmptyState, AdminLiveDataFallbackNotice, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { useLatestLoad } from "@/hooks/useLatestLoad";
import { registerRouteLeaveGuard } from "@/components/layout/navigation-pending";
import { useWorkforce } from "@/components/workforce/WorkforceContext";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { csvEscapeCell, triggerCsvDownload } from "@/lib/csv-export";
import { enumLabel } from "@/lib/display/enum-label";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { formatScheduleAssignmentStaffLabel } from "@/lib/schedules/schedule-assignment-display-copy";
import { formatSchedulePublishedSubtitle } from "@/lib/schedules/schedules-display-copy";
import { formatScheduleTimes, isManagedScheduleGroup, nextScheduleCellValue, scheduleCellKey, scheduledHours, scheduleWeekDates, type ScheduleAssignment, type ScheduleCellChange } from "@/lib/schedules/week-grid";
import { assignmentIntervalSpan, assignmentLabel } from "@/lib/schedules/assignment-context";
import { loadSchedulePresets, presetColorStyle, roleAllowsPreset, type PresetBlock, type SchedulePreset } from "@/lib/schedules/presets";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

const CustomShiftDialog = dynamic(() => import("@/components/schedules/CustomShiftDialog"));

type ScheduleRow = Database["public"]["Tables"]["schedules"]["Row"];
type RoleAssignment = { role_at_facility: string | null; start_date: string; end_date: string | null };
type StaffRow = { id: string; facility_id: string; first_name: string; last_name: string; staff_role: string; employment_status: string; role_assignments?: RoleAssignment[] };
type CellBlock = { label: string; start: string | null; end: string | null; color: string | null; hours: number | null; timeZone: string; roundingCoverage: boolean; incomplete?: boolean };

export default function ScheduleWeekEditor() {
  const params = useParams();
  const scheduleId = typeof params?.id === "string" ? params.id : "";
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const registerFacilityGuard = useFacilityStore((state) => state.registerFacilityChangeGuard);
  const previousFacilityId = useRef(selectedFacilityId);
  const { appRole } = useHavenAuth();
  const { refresh: refreshWorkforce } = useWorkforce();
  const canEdit = ["owner", "org_admin", "facility_admin", "manager"].includes(appRole ?? "");
  const [schedule, setSchedule] = useState<ScheduleRow | null>(null);
  const [people, setPeople] = useState<StaffRow[]>([]);
  const [assignments, setAssignments] = useState<ScheduleAssignment[]>([]);
  const [presets, setPresets] = useState<SchedulePreset[]>([]);
  const [changes, setChanges] = useState<Record<string, ScheduleCellChange>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const customTrigger = useRef<HTMLButtonElement | null>(null);
  const [customEditor, setCustomEditor] = useState<{ person: StaffRow; date: string; blocks: PresetBlock[]; roundingCoverage: boolean } | null>(null);
  const [timeZone, setTimeZone] = useState("");
  const [facilityName, setFacilityName] = useState("");
  const beginLoad = useLatestLoad();

  const load = useCallback(async () => {
    const isCurrent = beginLoad();
    setLoading(true);
    setCustomEditor(null);
    setError(null);
    try {
      const result = await supabase.from("schedules").select("*").eq("id", scheduleId).is("deleted_at", null).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("Schedule unavailable. It may have been removed or you may not have access.");
      const week = result.data;
      const [staffResult, assignmentResult, presetResult, facilityResult] = await Promise.all([
        readAllPages<StaffRow>(async (from, to) => {
          const page = await supabase.rpc("schedule_people_for_week" as never, { p_schedule_id: week.id } as never, { count: "exact" }).order("last_name").order("id").range(from, to);
          return { data: page.data as unknown as StaffRow[] | null, count: page.count, error: page.error };
        }),
        readAllPages((from, to) => supabase.from("shift_assignments").select("*", { count: "exact" }).eq("schedule_id", week.id).is("deleted_at", null).order("shift_date").order("id").range(from, to)),
        loadSchedulePresets(supabase, week.facility_id),
        supabase.from("facilities").select("name, timezone").eq("id", week.facility_id).single(),
      ]);
      if (facilityResult.error) throw facilityResult.error;
      if (!facilityResult.data.timezone) throw new Error("Configure this facility’s time zone before planning shifts.");
      new Intl.DateTimeFormat("en", { timeZone: facilityResult.data.timezone }).format();
      if (!isCurrent()) return;
      setSchedule(week);
      setPeople(staffResult.data);
      setAssignments(assignmentResult.data as ScheduleAssignment[]);
      setPresets(presetResult);
      setTimeZone(facilityResult.data.timezone);
      setFacilityName(facilityResult.data.name);
      setChanges({});
    } catch (cause) {
      if (!isCurrent()) return;
      setError(formatLiveDataLoadError(cause, "Could not load the schedule."));
      setSchedule(null);
      setPeople([]);
      setAssignments([]);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [beginLoad, scheduleId, supabase]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (previousFacilityId.current === selectedFacilityId) return;
    previousFacilityId.current = selectedFacilityId;
    // A successful facility switch has passed the guard; discard only then.
    // Security-driven scope resets intentionally bypass navigation guards.
    setChanges({});
    setCustomEditor(null);
    setNotice(null);
  }, [selectedFacilityId]);
  const pendingCount = Object.keys(changes).length;
  useEffect(() => {
    if (!pendingCount && !busy && !customEditor) return;
    const confirmDiscard = () => !busy && window.confirm("Discard unsaved schedule changes?");
    const unbindRoute = registerRouteLeaveGuard((silent) => !silent && confirmDiscard());
    const unbindFacility = registerFacilityGuard(() => confirmDiscard());
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => { unbindRoute(); unbindFacility(); window.removeEventListener("beforeunload", prevent); };
  }, [pendingCount, busy, customEditor, registerFacilityGuard]);

  const scopeMatches = !schedule || !isValidFacilityIdForQuery(selectedFacilityId) || schedule.facility_id === selectedFacilityId;
  const editable = canEdit && scopeMatches && schedule?.status === "draft";
  const days = schedule ? scheduleWeekDates(schedule.week_start_date) : [];
  const byCell = new Map<string, ScheduleAssignment[]>();
  for (const assignment of assignments) {
    const key = scheduleCellKey(assignment.staff_id, assignment.shift_date);
    byCell.set(key, [...(byCell.get(key) ?? []), assignment]);
  }
  const assignedIds = new Set(assignments.map((assignment) => assignment.staff_id));
  const gridPeople = people.filter((person) => person.employment_status === "active" || assignedIds.has(person.id));
  // Keep assignments visible even if their historical staff record is unavailable.
  for (const id of assignedIds) if (!gridPeople.some((person) => person.id === id)) gridPeople.push({ id, first_name: "Staff record", last_name: "unavailable", facility_id: schedule?.facility_id ?? "", staff_role: "", employment_status: "inactive" });
  const visiblePeople = gridPeople.filter((person) => `${person.first_name} ${person.last_name} ${person.staff_role}`.toLowerCase().includes(search.toLowerCase().trim()));

  function roleFor(person: StaffRow, date: string): string | null {
    const links = (person.role_assignments ?? []).filter((link) => link.start_date <= date && (!link.end_date || link.end_date >= date));
    const roles = [...new Set(links.map((link) => link.role_at_facility || person.staff_role))];
    if (roles.length > 1) return null;
    return roles[0] ?? (person.facility_id === schedule?.facility_id ? person.staff_role : null);
  }
  function choicesFor(person: StaffRow, date: string) { return presets.filter((preset) => roleAllowsPreset(preset, roleFor(person, date))); }
  function protectedCell(personId: string, date: string) {
    const rows = byCell.get(scheduleCellKey(personId, date)) ?? [];
    return ((rows.length > 1 || rows.some((row) => row.schedule_group_id)) && !isManagedScheduleGroup(rows)) || rows.some((row) => !["assigned", "confirmed"].includes(row.status));
  }
  function cellValue(personId: string, date: string): string | null {
    const change = changes[scheduleCellKey(personId, date)];
    if (change) return change.custom_start_time || change.custom_blocks ? "custom" : change.preset_id ?? null;
    const assignment = byCell.get(scheduleCellKey(personId, date))?.[0];
    if (!assignment) return null;
    if (assignment.schedule_preset_id) return assignment.schedule_preset_id;
    if (assignment.shift_type === "custom" && !assignment.shift_definition_id) return "custom";
    return presets.find((preset) => preset.source_shift_definition_id === assignment.shift_definition_id)?.id ?? "custom";
  }

  function setCellChange(person: StaffRow, date: string, value: string | null, blocks: PresetBlock[] = [], roundingCoverage = false) {
    if (!editable || busy || person.employment_status !== "active" || !roleFor(person, date) || protectedCell(person.id, date)) return;
    const key = scheduleCellKey(person.id, date);
    const existing = (byCell.get(key) ?? []).slice().sort((a, b) => (a.schedule_block_index ?? 0) - (b.schedule_block_index ?? 0));
    const preset = value && value !== "custom" ? choicesFor(person, date).find((item) => item.id === value) : null;
    if (value && value !== "custom" && !preset) return;
    const unchanged = value === "custom"
      ? blocks.length > 0 && existing.length === blocks.length && existing.every((row, index) => !row.schedule_preset_id && row.shift_type === "custom"
        && row.custom_start_time?.slice(0, 5) === blocks[index].start && row.custom_end_time?.slice(0, 5) === blocks[index].end
        && (row.schedule_rounding_coverage ?? false) === roundingCoverage)
      : value === null ? existing.length === 0
        : !!preset && existing.length === preset.blocks.length && existing.every((row) => row.schedule_preset_id === preset.id && row.schedule_preset_version === preset.version);
    setChanges((previous) => {
      const updated = { ...previous };
      if (unchanged) delete updated[key];
      else updated[key] = {
        staff_id: person.id, shift_date: date, shift_definition_id: null,
        ...(preset ? { preset_id: preset.id, expected_preset_version: preset.version } : {}),
        ...(value === "custom" ? { ...(blocks.length === 1 ? { custom_start_time: blocks[0].start, custom_end_time: blocks[0].end } : { custom_blocks: blocks }), custom_rounding_coverage: roundingCoverage } : {}),
      };
      return updated;
    });
    setNotice(null);
  }

  function openCustomEditor(person: StaffRow, date: string, trigger: HTMLButtonElement) {
    if (!editable || busy || person.employment_status !== "active" || !roleFor(person, date) || protectedCell(person.id, date)) return;
    const shifts = effectiveCell(person.id, date);
    customTrigger.current = trigger;
    setCustomEditor({ person, date,
      blocks: cellValue(person.id, date) === "custom" ? shifts.map((shift) => ({ start: shift.start?.slice(0, 5) ?? "", end: shift.end?.slice(0, 5) ?? "" })) : [{ start: "", end: "" }],
      roundingCoverage: cellValue(person.id, date) === "custom" && shifts.every((shift) => shift.roundingCoverage),
    });
  }

  function cycleCell(person: StaffRow, date: string) {
    if (!editable || busy || protectedCell(person.id, date) || person.employment_status !== "active" || !roleFor(person, date)) return;
    const next = nextScheduleCellValue(cellValue(person.id, date), choicesFor(person, date));
    setCellChange(person, date, next);
  }

  async function mutate(action: "save" | "copy" | "publish" | "remove", assignmentId?: string) {
    if (!schedule || !editable || busy || (action === "save" && invalidChanges)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const rpc = action === "save" ? "schedule_bulk_upsert" : action === "copy" ? "schedule_copy_week" : action === "publish" ? "schedule_publish" : "edit_draft_schedule";
      const args = action === "remove"
        ? { p_schedule_id: schedule.id, p_action: "remove", p_shift_id: assignmentId }
        : { p_schedule_id: schedule.id, p_expected_updated_at: schedule.updated_at, ...(action === "save" ? { p_cells: Object.values(changes) } : {}) };
      const result = await supabase.rpc(rpc as never, args as never);
      if (result.error) throw new Error(result.error.message);
      await load();
      refreshWorkforce();
      setNotice(action === "publish" ? "Published. Assigned staff can now see this week in My schedule." : action === "copy" ? "Last week's assignments copied into this draft. Review the grid before publishing." : "Draft saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The schedule was not changed. Try again.");
    } finally { setBusy(false); }
  }

  function effectiveCell(personId: string, date: string): CellBlock[] {
    const key = scheduleCellKey(personId, date);
    const existing = (byCell.get(key) ?? []).slice().sort((a, b) => (a.schedule_block_index ?? 0) - (b.schedule_block_index ?? 0));
    const change = changes[key];
    if (!change) return existing.map((assignment) => {
      const span = assignmentIntervalSpan(assignment, timeZone);
      return { label: assignmentLabel(assignment), start: assignment.custom_start_time, end: assignment.custom_end_time,
        color: assignment.schedule_preset_color ?? null, hours: span ? (span.end.getTime() - span.start.getTime()) / 3_600_000 : null,
        timeZone: span?.timeZone ?? timeZone, roundingCoverage: assignment.schedule_rounding_coverage ?? false };
    });
    const preset = presets.find((item) => item.id === change.preset_id);
    const blocks = preset?.blocks ?? change.custom_blocks ?? (change.custom_start_time && change.custom_end_time ? [{ start: change.custom_start_time, end: change.custom_end_time }] : []);
    // A selected Custom cell is a draft choice until the operator explicitly edits its times.
    if (change.custom_blocks?.length === 0) return [{ label: "Custom", start: null, end: null, color: null, hours: null, timeZone, roundingCoverage: false, incomplete: true }];
    return blocks.map((block) => ({ label: preset?.label ?? "Custom", start: block.start, end: block.end,
      color: preset?.color ?? null, hours: scheduledHours(date, block.start, block.end, timeZone), timeZone,
      roundingCoverage: preset?.rounding_coverage ?? change.custom_rounding_coverage ?? false }));
  }

  function personHours(personId: string): string {
    const hours = days.flatMap((date) => effectiveCell(personId, date).map((shift) => shift.hours));
    if (hours.some((value) => value === null)) return "Unknown";
    return `${hours.reduce<number>((sum, value) => sum + (value ?? 0), 0).toFixed(1)} h`;
  }
  const invalidChanges = Object.values(changes).some((change) => effectiveCell(change.staff_id, change.shift_date).some((block) => block.hours === null));

  function exportAssignments() {
    if (!schedule) return;
    const fields = ["Employee", "Role", "Date", "Shift", "Block", "Start", "End", "Time zone", "Scheduled hours", "Color", "Status", "Notes"];
    const rows = assignments.map((assignment) => {
      const span = assignmentIntervalSpan(assignment, timeZone);
      return [formatScheduleAssignmentStaffLabel(people.find((person) => person.id === assignment.staff_id)), enumLabel(assignment.schedule_role_snapshot ?? people.find((person) => person.id === assignment.staff_id)?.staff_role), assignment.shift_date,
        assignmentLabel(assignment), (assignment.schedule_block_index ?? 0) + 1, assignment.custom_start_time ?? "", assignment.custom_end_time ?? "", span?.timeZone ?? "", span ? ((span.end.getTime() - span.start.getTime()) / 3_600_000).toFixed(2) : "Unknown", assignment.schedule_preset_color ?? "", enumLabel(assignment.status), assignment.notes ?? ""];
    });
    triggerCsvDownload(`schedule-${schedule.week_start_date}.csv`, [fields, ...rows].map((row) => row.map((value) => csvEscapeCell(String(value))).join(",")).join("\r\n"));
  }

  return <div className="space-y-5 schedule-week-print">
    {customEditor && editable && !loading && <CustomShiftDialog
      key={`${customEditor.person.id}:${customEditor.date}`}
      personName={formatScheduleAssignmentStaffLabel(customEditor.person)} date={customEditor.date} dateLabel={formatDate(customEditor.date)} timeZone={timeZone}
      initialBlocks={customEditor.blocks} initialRoundingCoverage={customEditor.roundingCoverage}
      onClose={() => setCustomEditor(null)} onRestoreFocus={() => customTrigger.current?.focus()}
      onSetOff={() => {
        // The Edit times trigger disappears when its cell becomes Off.
        customTrigger.current = customTrigger.current?.closest("td")?.querySelector("button") ?? customTrigger.current;
        setCellChange(customEditor.person, customEditor.date, null);
        setCustomEditor(null);
      }}
      onApply={(blocks, roundingCoverage) => { setCellChange(customEditor.person, customEditor.date, "custom", blocks, roundingCoverage); setCustomEditor(null); }}
    />}
    <div className="flex flex-wrap gap-4 print:hidden"><Link href="/admin/schedules" className="text-sm text-muted-foreground underline">All schedule weeks</Link>{canEdit && scopeMatches && <Link href="/admin/schedules/options" className="text-sm text-primary underline">Manage shift options</Link>}</div>
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        <div className="flex items-center gap-3"><h1 className="text-3xl font-semibold tracking-tight">Schedule</h1>{schedule && <Badge variant={schedule.status === "published" ? "default" : "secondary"}>{enumLabel(schedule.status)}</Badge>}</div>
        <p className="text-sm text-muted-foreground">{schedule ? `${facilityName} · ${formatDate(schedule.week_start_date)} – ${formatDate(days[6])} · ${timeZone}` : "Weekly shifts"}</p>
        {schedule?.published_at && <p className="text-xs text-muted-foreground">{formatSchedulePublishedSubtitle(schedule.published_at, schedule.notes)}</p>}
      </div>
      {editable && <div className="flex flex-wrap gap-2 print:hidden">
        <Button variant="outline" disabled={busy || pendingCount > 0 || assignments.length > 0} title={assignments.length ? "Copy last week is available for an empty draft." : undefined} onClick={() => void mutate("copy")}><Copy className="mr-2 h-4 w-4" />Copy last week</Button>
        <Button variant="outline" disabled={busy || pendingCount === 0 || invalidChanges} onClick={() => void mutate("save")}><Save className="mr-2 h-4 w-4" />{busy ? "Saving…" : `Save${pendingCount ? ` ${pendingCount} changes` : " draft"}`}</Button>
        <Button disabled={busy || pendingCount > 0 || assignments.length === 0} onClick={() => void mutate("publish")}><Send className="mr-2 h-4 w-4" />Publish week</Button>
      </div>}
    </header>
    {!scopeMatches && <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">This schedule belongs to another facility. Select its facility to edit it.</p>}
    {loading && <AdminTableLoadingState />}
    {error && <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />}
    {notice && <p role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm">{notice}</p>}
    {!loading && schedule && <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{editable ? "Click a cell to cycle through this person’s facility role options → Custom → Off. Save changes before publishing." : schedule.status === "published" ? "Published shifts are visible to assigned staff." : "Review the schedule below."}</p>
        <Input aria-label="Find a person on the schedule" placeholder="Find a person…" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full sm:w-56" />
      </div>
      {presets.length === 0 && <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">No preset shifts are configured for this facility. Click a cell to select Custom, then Edit times, or use Manage shift options to create role-specific choices.</p>}
      {invalidChanges && <p role="alert" className="text-sm text-destructive">Complete each Custom cell with valid times using Edit times before saving, or click the cell again to choose Off.</p>}
      {pendingCount > 0 && <div className="flex items-center gap-3 text-sm" role="status"><span>{pendingCount} unsaved cell {pendingCount === 1 ? "change" : "changes"}.</span><Button size="sm" variant="ghost" disabled={busy} onClick={() => setChanges({})}>Discard changes</Button></div>}
      {visiblePeople.length === 0 ? <AdminEmptyState title={search ? "No matching people" : "No active staff in this facility"} description={search ? "Try another name or clear the search." : "Add staff to People before planning their shifts."} /> : <HorizontalScroll label="Seven-day employee schedule" className="overflow-hidden rounded-xl border border-border bg-card" viewportClassName="rounded-xl">
        <table className="w-full min-w-[1040px] border-collapse text-sm"><caption className="sr-only">Seven-day employee schedule. Hours use the facility time zone and do not deduct unrecorded meals.</caption>
          <thead><tr className="border-b border-border text-left"><th scope="col" className="sticky left-0 z-10 min-w-48 bg-card p-4 font-medium">Person</th>{days.map((date) => <th scope="col" key={date} className="min-w-28 p-3 text-center font-medium">{formatDate(date)}</th>)}<th scope="col" className="p-4 text-right font-medium">Hours</th></tr></thead>
          <tbody>{visiblePeople.map((person) => <tr key={person.id} className="border-b border-border/60 last:border-b-0">
            <th scope="row" className="sticky left-0 z-10 bg-card p-4 text-left font-medium"><Link href={`/admin/staff/${person.id}`} className="hover:underline">{formatScheduleAssignmentStaffLabel(person)}</Link><span className="mt-1 block text-xs font-normal text-muted-foreground">{[...new Set(days.map((date) => roleFor(person, date)).filter(Boolean))].map((role) => enumLabel(role)).join(" / ") || enumLabel(person.staff_role)}{person.employment_status !== "active" ? " · Inactive" : ""}</span></th>
            {days.map((date) => { const key = scheduleCellKey(person.id, date); const shifts = effectiveCell(person.id, date); const multiple = protectedCell(person.id, date); const role = roleFor(person, date); const color = shifts[0]?.color; return <td key={date} className="p-1.5"><button type="button" onClick={() => cycleCell(person, date)} disabled={!editable || busy || multiple || !role || person.employment_status !== "active"} aria-label={`${formatScheduleAssignmentStaffLabel(person)}, ${formatDate(date)}: ${shifts.map((shift) => `${shift.label} ${(shift.incomplete ? "Choose times" : formatScheduleTimes(shift.start, shift.end))}`).join(", ") || "Off"}. ${multiple ? "Review multiple assignments below." : "Cycle shift."}`} style={color ? presetColorStyle(color) : undefined} className={`min-h-16 w-full rounded-lg border px-2 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default ${changes[key] ? "border-primary bg-primary/10" : shifts.length ? "border-border bg-muted/50" : "border-transparent text-muted-foreground hover:border-border"}`}>
              {shifts.length ? shifts.map((shift, index) => <span key={index} className="block"><span className="font-semibold">{shift.label}</span><span className={`mt-1 block text-[11px] ${color ? "" : "text-muted-foreground"}`}>{(shift.incomplete ? "Choose times" : formatScheduleTimes(shift.start, shift.end))}{shift.timeZone !== timeZone ? ` · ${shift.timeZone}` : ""}</span></span>) : <span>{role ? "Off" : "Not assigned here"}</span>}
            </button>{editable && !multiple && role && person.employment_status === "active" && cellValue(person.id, date) === "custom" && <Button type="button" variant="ghost" size="sm" className="mt-1 h-7 w-full text-xs schedule-screen-only" disabled={busy} aria-label={`Edit custom times for ${formatScheduleAssignmentStaffLabel(person)}, ${formatDate(date)}`} onClick={(event) => openCustomEditor(person, date, event.currentTarget)}>Edit times</Button>}</td>; })}
            <td className="p-4 text-right font-medium tabular-nums">{personHours(person.id)}</td>
          </tr>)}</tbody>
          <tfoot><tr className="border-t border-border"><th scope="row" className="sticky left-0 bg-card p-4 text-left font-medium">People scheduled</th>{days.map((date) => <td key={date} className="p-3 text-center tabular-nums">{gridPeople.reduce((sum, person) => sum + (effectiveCell(person.id, date).length ? 1 : 0), 0)}</td>)}<td /></tr></tfoot>
        </table>
      </HorizontalScroll>}
      <p className="text-xs text-muted-foreground">Hours are scheduled elapsed time, before meal deductions. People counts are not a staffing minimum or credential check. Split gaps are excluded from scheduled hours. {schedule.status === "draft" ? "This draft is hidden from staff until you publish it." : "Published assignments are available in My schedule."}</p>
      <div className="flex flex-wrap items-center gap-4 text-sm schedule-screen-only"><Link href="/admin/shift-swaps" className="underline">Review shift swap requests</Link><Button variant="ghost" size="sm" disabled={!assignments.length || pendingCount > 0} onClick={exportAssignments}><Download className="mr-2 h-4 w-4" />Download assignments</Button><Button variant="outline" size="sm" disabled={pendingCount > 0} onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print schedule</Button></div>
      {assignments.length > 0 && <details className="rounded-lg border border-border p-4"><summary className="cursor-pointer text-sm font-medium">Assignment details ({assignments.length})</summary><div className="mt-3 space-y-2">{assignments.map((assignment) => <div key={assignment.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-sm"><div><span className="font-medium">{formatScheduleAssignmentStaffLabel(people.find((person) => person.id === assignment.staff_id))}</span> · {formatDate(assignment.shift_date)} · {formatScheduleTimes(assignment.custom_start_time, assignment.custom_end_time)}<span className="ml-2 text-xs text-muted-foreground">{enumLabel(assignment.status)}</span></div>{editable && !assignment.schedule_group_id && <Button size="sm" variant="outline" disabled={busy || pendingCount > 0} onClick={() => void mutate("remove", assignment.id)}>Remove shift</Button>}</div>)}</div></details>}
    </>}
  </div>;
}

function formatDate(date: string): string {
  return formatDateTimeWith(date, { weekday: "short", month: "short", day: "numeric" }, { fallback: date });
}
