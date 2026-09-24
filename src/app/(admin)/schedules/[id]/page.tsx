"use client";

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
import { scheduleCellTone, scheduleToneStyle, SCHEDULE_TONE_ORDER, SCHEDULE_TONES } from "@/lib/schedules/schedule-colors";
import { assignmentDefinitionId, COOK_SPLIT, COOK_SPLIT_BLOCKS, COOK_SPLIT_LABEL, describeScheduleCell, formatScheduleTimes, isCookSplitCell, isCookStaffRole, nextScheduleCellValue, scheduleCellKey, scheduledHours, scheduleWeekDates, type ScheduleAssignment, type ScheduleCellChange, type ScheduleShiftDefinition } from "@/lib/schedules/week-grid";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

const CustomShiftDialog = dynamic(() => import("@/components/schedules/CustomShiftDialog"));

type ScheduleRow = Database["public"]["Tables"]["schedules"]["Row"];
type StaffRow = { id: string; first_name: string; last_name: string; staff_role: string; employment_status: string };

export default function AdminScheduleWeekDetailPage() {
  const params = useParams();
  const scheduleId = typeof params?.id === "string" ? params.id : "";
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const { appRole } = useHavenAuth();
  const { refresh: refreshWorkforce } = useWorkforce();
  const canEdit = ["owner", "org_admin", "facility_admin", "manager"].includes(appRole ?? "");
  const [schedule, setSchedule] = useState<ScheduleRow | null>(null);
  const [people, setPeople] = useState<StaffRow[]>([]);
  const [assignments, setAssignments] = useState<ScheduleAssignment[]>([]);
  const [definitions, setDefinitions] = useState<ScheduleShiftDefinition[]>([]);
  const [changes, setChanges] = useState<Record<string, ScheduleCellChange>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const customTrigger = useRef<HTMLButtonElement | null>(null);
  const [customEditor, setCustomEditor] = useState<{ person: StaffRow; date: string; start: string; end: string } | null>(null);
  const [timeZone, setTimeZone] = useState("America/New_York");
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
      const [staffResult, assignmentResult, definitionResult, facilityResult] = await Promise.all([
        readAllPages((from, to) => supabase.from("staff").select("id, first_name, last_name, staff_role, employment_status", { count: "exact" }).eq("facility_id", week.facility_id).is("deleted_at", null).order("last_name").order("id").range(from, to)),
        readAllPages((from, to) => supabase.from("shift_assignments").select("*", { count: "exact" }).eq("schedule_id", week.id).is("deleted_at", null).order("shift_date").order("id").range(from, to)),
        readAllPages((from, to) => supabase.from("facility_shift_definitions").select("id, label, roster_shift_type, starts_at_local, ends_at_local", { count: "exact" }).eq("facility_id", week.facility_id).eq("active", true).is("deleted_at", null).order("sort_order").order("id").range(from, to)),
        supabase.from("facilities").select("timezone").eq("id", week.facility_id).single(),
      ]);
      if (facilityResult.error) throw facilityResult.error;
      if (!isCurrent()) return;
      setSchedule(week);
      setPeople(staffResult.data);
      setAssignments(assignmentResult.data);
      setDefinitions(definitionResult.data);
      setTimeZone(facilityResult.data.timezone || "America/New_York");
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
  const pendingCount = Object.keys(changes).length;
  useEffect(() => {
    if (!pendingCount) return;
    const unbind = registerRouteLeaveGuard((silent) => !silent && window.confirm("Discard unsaved schedule changes?"));
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => { unbind(); window.removeEventListener("beforeunload", prevent); };
  }, [pendingCount]);

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
  for (const id of assignedIds) if (!gridPeople.some((person) => person.id === id)) gridPeople.push({ id, first_name: "Staff record", last_name: "unavailable", staff_role: "", employment_status: "inactive" });
  const visiblePeople = gridPeople.filter((person) => `${person.first_name} ${person.last_name} ${person.staff_role}`.toLowerCase().includes(search.toLowerCase().trim()));

  /** Several assignments in one cell need review below, unless they are the cook split. */
  function isMultipleCell(personId: string, date: string): boolean {
    const existing = byCell.get(scheduleCellKey(personId, date)) ?? [];
    return existing.length > 1 && !isCookSplitCell(existing);
  }

  function cellValue(personId: string, date: string): string | null {
    const key = scheduleCellKey(personId, date);
    const change = changes[key];
    if (change) return change.custom_blocks ? COOK_SPLIT : change.custom_start_time ? "custom" : change.shift_definition_id;
    const existing = byCell.get(key) ?? [];
    if (isCookSplitCell(existing)) return COOK_SPLIT;
    const assignment = existing[0];
    if (!assignment) return null;
    return assignment.shift_type === "custom" && !assignment.shift_definition_id
      ? "custom" : assignmentDefinitionId(assignment, definitions);
  }

  function setCellChange(person: StaffRow, date: string, value: string | null, start?: string, end?: string) {
    if (!editable || busy || person.employment_status !== "active") return;
    const key = scheduleCellKey(person.id, date);
    const existing = byCell.get(key) ?? [];
    if (isMultipleCell(person.id, date)) return;
    const original = existing[0];
    const unchanged = value === COOK_SPLIT ? isCookSplitCell(existing)
      : isCookSplitCell(existing) ? false
      : value === "custom"
      ? original?.shift_type === "custom" && !original.shift_definition_id
        && original.custom_start_time?.slice(0, 5) === start && original.custom_end_time?.slice(0, 5) === end
      : value === null ? !original : !!original && assignmentDefinitionId(original, definitions) === value;
    setChanges((previous) => {
      const updated = { ...previous };
      if (unchanged) delete updated[key];
      else updated[key] = {
        staff_id: person.id, shift_date: date, shift_definition_id: value === "custom" || value === COOK_SPLIT ? null : value,
        ...(value === "custom" ? { custom_start_time: start, custom_end_time: end } : {}),
        ...(value === COOK_SPLIT ? { custom_blocks: COOK_SPLIT_BLOCKS.map((block) => ({ ...block })) } : {}),
      };
      return updated;
    });
    setNotice(null);
  }

  function openCustomEditor(person: StaffRow, date: string, trigger: HTMLButtonElement) {
    if (!editable || busy || person.employment_status !== "active" || isMultipleCell(person.id, date)) return;
    const shift = cellValue(person.id, date) === "custom" ? effectiveCell(person.id, date)[0] : null;
    customTrigger.current = trigger;
    setCustomEditor({ person, date, start: shift?.start?.slice(0, 5) ?? "", end: shift?.end?.slice(0, 5) ?? "" });
  }

  function cycleCell(person: StaffRow, date: string, trigger: HTMLButtonElement) {
    if (!editable || busy || isMultipleCell(person.id, date) || person.employment_status !== "active") return;
    const next = nextScheduleCellValue(cellValue(person.id, date), definitions, { cookSplit: isCookStaffRole(person.staff_role) });
    if (next === "custom") openCustomEditor(person, date, trigger);
    else setCellChange(person, date, next);
  }

  async function mutate(action: "save" | "copy" | "publish" | "remove", assignmentId?: string) {
    if (!schedule || !editable || busy) return;
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

  function effectiveCell(personId: string, date: string): { label: string; shiftType: string | null; start: string | null; end: string | null }[] {
    const key = scheduleCellKey(personId, date);
    const existing = byCell.get(key) ?? [];
    const change = changes[key];
    if (!change) {
      const split = isCookSplitCell(existing);
      return [...existing].sort((a, b) => (a.custom_start_time ?? "").localeCompare(b.custom_start_time ?? "")).map((assignment) => ({ label: split ? COOK_SPLIT_LABEL : definitions.find((definition) => definition.id === assignmentDefinitionId(assignment, definitions))?.label ?? enumLabel(assignment.shift_type), shiftType: assignment.shift_type, start: assignment.custom_start_time, end: assignment.custom_end_time }));
    }
    if (change.custom_blocks) return change.custom_blocks.map((block) => ({ label: COOK_SPLIT_LABEL, shiftType: "custom", start: block.start_time, end: block.end_time }));
    if (change.custom_start_time && change.custom_end_time) return [{ label: "Custom", shiftType: "custom", start: change.custom_start_time, end: change.custom_end_time }];
    const definition = definitions.find((item) => item.id === change.shift_definition_id);
    return definition ? [{ label: definition.label, shiftType: definition.roster_shift_type, start: definition.starts_at_local, end: definition.ends_at_local }] : [];
  }


  function personHours(personId: string): string {
    const hours = days.flatMap((date) => effectiveCell(personId, date).map((shift) => scheduledHours(date, shift.start, shift.end, timeZone)));
    if (hours.some((value) => value === null)) return "Unknown";
    return `${hours.reduce<number>((sum, value) => sum + (value ?? 0), 0).toFixed(1)} h`;
  }

  function exportAssignments() {
    if (!schedule) return;
    const fields = ["Employee", "Date", "Shift", "Start", "End", "Status", "Notes"];
    const rows = assignments.map((assignment) => [formatScheduleAssignmentStaffLabel(people.find((person) => person.id === assignment.staff_id)), assignment.shift_date, enumLabel(assignment.shift_type), assignment.custom_start_time ?? "", assignment.custom_end_time ?? "", assignment.status, assignment.notes ?? ""]);
    triggerCsvDownload(`schedule-${schedule.week_start_date}.csv`, [fields, ...rows].map((row) => row.map(csvEscapeCell).join(",")).join("\r\n"));
  }

  return <div className="space-y-5">
    {customEditor && editable && !loading && <CustomShiftDialog
      key={`${customEditor.person.id}:${customEditor.date}`}
      personName={formatScheduleAssignmentStaffLabel(customEditor.person)} date={customEditor.date} dateLabel={formatDate(customEditor.date)} timeZone={timeZone}
      initialStart={customEditor.start} initialEnd={customEditor.end}
      onClose={() => setCustomEditor(null)} onRestoreFocus={() => customTrigger.current?.focus()}
      onApply={(start, end) => { setCellChange(customEditor.person, customEditor.date, "custom", start, end); setCustomEditor(null); }}
    />}
    <Link href="/admin/schedules" className="text-sm text-muted-foreground underline">All schedule weeks</Link>
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        <div className="flex items-center gap-3"><h1 className="text-3xl font-semibold tracking-tight">Schedule</h1>{schedule && <Badge variant={schedule.status === "published" ? "default" : "secondary"}>{enumLabel(schedule.status)}</Badge>}</div>
        <p className="text-sm text-muted-foreground">{schedule ? `${formatDate(schedule.week_start_date)} – ${formatDate(days[6])} · ${timeZone}` : "Weekly shifts"}</p>
        {schedule?.published_at && <p className="text-xs text-muted-foreground">{formatSchedulePublishedSubtitle(schedule.published_at, schedule.notes)}</p>}
      </div>
      {editable && <div className="flex flex-wrap gap-2" data-print-hide>
        <Button variant="outline" disabled={busy || pendingCount > 0 || assignments.length > 0} title={assignments.length ? "Copy last week is available for an empty draft." : undefined} onClick={() => void mutate("copy")}><Copy className="mr-2 h-4 w-4" />Copy last week</Button>
        <Button variant="outline" disabled={busy || pendingCount === 0} onClick={() => void mutate("save")}><Save className="mr-2 h-4 w-4" />{busy ? "Saving…" : `Save${pendingCount ? ` ${pendingCount} changes` : " draft"}`}</Button>
        <Button disabled={busy || pendingCount > 0 || assignments.length === 0} onClick={() => void mutate("publish")}><Send className="mr-2 h-4 w-4" />Publish week</Button>
      </div>}
    </header>
    {!scopeMatches && <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">This schedule belongs to another facility. Select its facility to edit it.</p>}
    {loading && <AdminTableLoadingState />}
    {error && <AdminLiveDataFallbackNotice message={error} onRetry={() => void load()} />}
    {notice && <p role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm">{notice}</p>}
    {!loading && schedule && <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{editable ? `Click a cell to cycle: Off${definitions.length ? ` → ${definitions.map((definition) => definition.label).join(" → ")}` : ""} → ${gridPeople.some((person) => isCookStaffRole(person.staff_role)) ? `${COOK_SPLIT_LABEL} (cooks, ${COOK_SPLIT_BLOCKS.map((block) => formatScheduleTimes(block.start_time, block.end_time)).join(" + ")}) → ` : ""}Custom → Off. Save changes before publishing.` : schedule.status === "published" ? "Published shifts are visible to assigned staff." : "Review the schedule below."}</p>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto" data-print-hide>
          <Button type="button" variant="outline" size="sm" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print</Button>
          <Input aria-label="Find a person on the schedule" placeholder="Find a person…" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full sm:w-56" />
        </div>
      </div>
      <ul aria-label="Schedule color key" className="flex flex-wrap items-center gap-2 text-xs">{SCHEDULE_TONE_ORDER.map((tone) => <li key={tone} className="rounded-md border px-2 py-1 font-medium" style={scheduleToneStyle(tone)}>{SCHEDULE_TONES[tone].label}</li>)}</ul>
      {definitions.length === 0 && <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">No preset shifts are configured for this facility. Click a cell to enter Custom times, or configure presets in facility settings.</p>}
      {pendingCount > 0 && <div className="flex items-center gap-3 text-sm" role="status"><span>{pendingCount} unsaved cell {pendingCount === 1 ? "change" : "changes"}.</span><Button size="sm" variant="ghost" disabled={busy} onClick={() => setChanges({})}>Discard changes</Button></div>}
      {visiblePeople.length === 0 ? <AdminEmptyState title={search ? "No matching people" : "No active staff in this facility"} description={search ? "Try another name or clear the search." : "Add staff to People before planning their shifts."} /> : <HorizontalScroll label="Seven-day employee schedule" className="overflow-hidden rounded-xl border border-border bg-card" viewportClassName="rounded-xl">
        <table className="w-full min-w-[1040px] border-collapse text-sm print:min-w-0"><caption className="sr-only">Seven-day employee schedule. Hours use the facility time zone and do not deduct unrecorded meals.</caption>
          <thead><tr className="border-b border-border text-left"><th scope="col" className="sticky left-0 z-10 min-w-48 bg-card p-4 font-medium">Person</th>{days.map((date) => <th scope="col" key={date} className="min-w-28 p-3 text-center font-medium">{formatDate(date)}</th>)}<th scope="col" className="p-4 text-right font-medium">Hours</th></tr></thead>
          <tbody>{visiblePeople.map((person) => <tr key={person.id} className="border-b border-border/60 last:border-b-0">
            <th scope="row" className="sticky left-0 z-10 bg-card p-4 text-left font-medium"><Link href={`/admin/staff/${person.id}`} className="hover:underline">{formatScheduleAssignmentStaffLabel(person)}</Link><span className="mt-1 block text-xs font-normal text-muted-foreground">{enumLabel(person.staff_role)}{person.employment_status !== "active" ? " · Inactive" : ""}</span></th>
            {days.map((date) => { const key = scheduleCellKey(person.id, date); const shifts = effectiveCell(person.id, date); const multiple = isMultipleCell(person.id, date); const tone = scheduleCellTone({ staffRole: person.staff_role, cellValue: cellValue(person.id, date), shift: shifts[0] }); return <td key={date} className="p-1.5"><button type="button" onClick={(event) => cycleCell(person, date, event.currentTarget)} disabled={!editable || busy || multiple || person.employment_status !== "active"} data-schedule-tone={tone ?? undefined} style={tone ? scheduleToneStyle(tone) : undefined} aria-label={`${formatScheduleAssignmentStaffLabel(person)}, ${formatDate(date)}: ${describeScheduleCell(shifts) || "Off"}${tone ? ` (${SCHEDULE_TONES[tone].label} color)` : ""}${changes[key] ? ", unsaved" : ""}. ${multiple ? "Review multiple assignments below." : "Cycle shift."}`} className={`min-h-16 w-full rounded-lg border px-2 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default ${changes[key] ? "outline-2 outline-offset-2 outline-dashed outline-primary" : ""} ${tone ? "" : changes[key] ? "border-primary bg-primary/10" : shifts.length ? "border-border bg-muted/50" : "border-transparent text-muted-foreground hover:border-border"}`}>
              {shifts.length ? shifts.map((shift, index) => <span key={index} className="block">{index === 0 || shifts[index - 1].label !== shift.label ? <span className="font-semibold">{shift.label}</span> : null}<span className={`mt-1 block text-[11px] ${tone ? "" : "text-muted-foreground"}`}>{formatScheduleTimes(shift.start, shift.end)}</span></span>) : <span>Off</span>}
            </button>{editable && !multiple && person.employment_status === "active" && cellValue(person.id, date) === "custom" && <Button type="button" variant="ghost" size="sm" className="mt-1 h-7 w-full text-xs" data-print-hide disabled={busy} aria-label={`Edit custom times for ${formatScheduleAssignmentStaffLabel(person)}, ${formatDate(date)}`} onClick={(event) => openCustomEditor(person, date, event.currentTarget)}>Edit times</Button>}</td>; })}
            <td className="p-4 text-right font-medium tabular-nums">{personHours(person.id)}</td>
          </tr>)}</tbody>
          <tfoot><tr className="border-t border-border"><th scope="row" className="sticky left-0 bg-card p-4 text-left font-medium">Assigned shifts</th>{days.map((date) => <td key={date} className="p-3 text-center tabular-nums">{gridPeople.reduce((sum, person) => sum + effectiveCell(person.id, date).length, 0)}</td>)}<td /></tr></tfoot>
        </table>
      </HorizontalScroll>}
      <p className="text-xs text-muted-foreground">Hours are scheduled elapsed time, before meal deductions. Assignment counts are not a staffing minimum or credential check. {schedule.status === "draft" ? "This draft is hidden from staff until you publish it." : "Published assignments are available in My schedule."}</p>
      <div className="flex flex-wrap items-center gap-4 text-sm"><Link href="/admin/shift-swaps" className="underline">Review shift swap requests</Link><Button variant="ghost" size="sm" disabled={!assignments.length || pendingCount > 0} onClick={exportAssignments}><Download className="mr-2 h-4 w-4" />Download assignments</Button></div>
      {assignments.length > 0 && <details className="rounded-lg border border-border p-4"><summary className="cursor-pointer text-sm font-medium">Assignment details ({assignments.length})</summary><div className="mt-3 space-y-2">{assignments.map((assignment) => <div key={assignment.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-sm"><div><span className="font-medium">{formatScheduleAssignmentStaffLabel(people.find((person) => person.id === assignment.staff_id))}</span> · {formatDate(assignment.shift_date)} · {formatScheduleTimes(assignment.custom_start_time, assignment.custom_end_time)}<span className="ml-2 text-xs text-muted-foreground">{enumLabel(assignment.status)}</span></div>{editable && <Button size="sm" variant="outline" disabled={busy || pendingCount > 0} onClick={() => void mutate("remove", assignment.id)}>Remove shift</Button>}</div>)}</div></details>}
    </>}
  </div>;
}

function formatDate(date: string): string {
  return formatDateTimeWith(date, { weekday: "short", month: "short", day: "numeric" }, { fallback: date });
}
