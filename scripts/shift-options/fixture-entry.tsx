import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/app/globals.css";
import ScheduleWeekEditor from "../../src/components/schedules/ScheduleWeekEditor";
import { SchedulePresetManager } from "../../src/components/schedules/SchedulePresetManager";
import CaregiverSchedulesPage from "../../src/app/(caregiver)/caregiver/schedules/page";
import { PlannedScheduleContext } from "../../src/components/timeclock/PlannedScheduleContext";
import { SwapWorkContext } from "../../src/components/staffing/SwapWorkContext";
import { StaffActions } from "../../src/components/kiosk/StaffActions";
import type { KioskIdentifyResponse } from "../../src/lib/timeclock/kiosk-contract";
import { useFacilityStore } from "../../src/hooks/useFacilityStore";
const facilityId = "11111111-1111-4111-8111-111111111111";
useFacilityStore.setState({ selectedFacilityId: facilityId, facilitiesCacheUserId: "44444444-4444-4444-8444-444444444444", availableFacilities: [{ id: facilityId, name: "Synthetic east facility" }] });
function Attendance() {
  const [identified, setIdentified] = useState<KioskIdentifyResponse | null>(null);
  useEffect(() => { void fetch("/__fixture/attendance").then((r) => r.json()).then(setIdentified); }, []);
  return <div className="space-y-5"><h1 className="text-2xl font-semibold">Attendance and payroll comparison</h1><p>Actual worked time remains 4 hours 12 minutes in this synthetic example.</p>{identified && <StaffActions identified={identified} offline={false} busy={false} time="10:12 AM" timeZone="America/New_York" onPunch={() => {}} onStartOver={() => {}}/>}<PlannedScheduleContext facilityIds={[facilityId]} staffId="22222222-2222-4222-8222-222222222222" from="2026-09-28T00:00:00Z" to="2026-10-05T00:00:00Z" payroll /></div>;
}
function SwapPreview() {
  const [blocks, setBlocks] = useState([]);
  useEffect(() => { void fetch("/__fixture/proof").then((r) => r.json()).then((data) => setBlocks(data.assignments.filter((a: { staff_id: string }) => a.staff_id.endsWith("2222")).map((a: Record<string, unknown>) => ({ assignment_id: a.id, group_id: a.schedule_group_id, block_index: a.schedule_block_index, block_count: a.schedule_block_count, service_date: a.shift_date, starts_at: a.schedule_starts_at, ends_at: a.schedule_ends_at, label: a.schedule_preset_name, color: a.schedule_preset_color, time_zone: a.schedule_time_zone, staff_role: a.schedule_role_snapshot, rounding_coverage: a.schedule_rounding_coverage })))); }, []);
  return <div className="space-y-5"><h1 className="text-2xl font-semibold">Review shift coverage</h1><SwapWorkContext row={{ swap_scope: "group", group_context_hash: "synthetic-browser-context", requesting_group_snapshot: blocks, covering_group_snapshot: [] }}/></div>;
}
const url = window.location.pathname;
createRoot(document.getElementById("root")!).render(<div className="min-h-screen bg-background text-foreground"><header className="flex flex-wrap items-center gap-5 border-b p-5"><strong>Haven</strong><span>Synthetic east facility</span><strong>Workforce</strong><span className="ml-auto text-xs text-muted-foreground">Synthetic component verification</span></header><main className="mx-auto max-w-[1500px] p-5">{url.endsWith("/options") ? <SchedulePresetManager/> : url.includes("/caregiver/") ? <CaregiverSchedulesPage/> : url.endsWith("/swaps") ? <SwapPreview/> : url.endsWith("/attendance") ? <Attendance/> : <ScheduleWeekEditor/>}</main></div>);
