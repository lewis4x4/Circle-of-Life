"use client";

import { useEffect } from "react";

import { useFacilityStore } from "@/hooks/useFacilityStore";

import { AdminStaffingConsolePageClient } from "./AdminStaffingConsolePageClient";
import type {
  AttendanceEventRow,
  CertWarning,
  RequisitionRow,
  ShiftGap,
  SnapshotRow,
  StaffOption,
} from "@/lib/staffing/load-staffing-console";

const previewFacilityId = "11111111-1111-1111-1111-111111111111";

const previewProps = {
  initialSnapshots: [
    {
      id: "snap-1",
      snapshotAt: "2026-05-26T12:00:00.000Z",
      shift: "Day",
      residentsPresent: 42,
      staffOnDuty: 5,
      ratio: 8.4,
      requiredRatio: 6.0,
      isCompliant: false,
    },
    {
      id: "snap-2",
      snapshotAt: "2026-05-26T08:00:00.000Z",
      shift: "Night",
      residentsPresent: 39,
      staffOnDuty: 6,
      ratio: 6.5,
      requiredRatio: 6.0,
      isCompliant: true,
    },
  ] satisfies SnapshotRow[],
  initialCertWarnings: [
    {
      id: "cert-1",
      staffName: "Jordan Blake",
      role: "CNA",
      certName: "Medication aide",
      daysExpired: 4,
    },
  ] satisfies CertWarning[],
  initialShiftGaps: [
    {
      id: "gap-1",
      date: "May 26",
      shift: "Night",
      role: "CNA",
      shortage: 2,
      urgency: "critical",
    },
  ] satisfies ShiftGap[],
  initialStaffOptions: [{ id: "staff-1", label: "Ava Lopez" }] satisfies StaffOption[],
  initialRequisitions: [
    {
      id: "req-1",
      role_title: "Caregiver",
      status: "open",
      target_hire_date: "2026-05-30",
      department: "Enhanced ALF",
    },
  ] satisfies RequisitionRow[],
  initialAttendance: [
    {
      id: "att-1",
      event_type: "callout",
      occurred_at: "2026-05-26T09:00:00.000Z",
      reason: "Vehicle trouble",
      staff: { first_name: "Ava", last_name: "Lopez" },
    },
  ] satisfies AttendanceEventRow[],
  initialError: null,
  initialFacilityId: previewFacilityId,
};

export function AdminStaffingConsolePageClientPreview() {
  useEffect(() => {
    const previousFacilityId = useFacilityStore.getState().selectedFacilityId;
    useFacilityStore.setState({ selectedFacilityId: previewFacilityId });
    return () => {
      useFacilityStore.setState({ selectedFacilityId: previousFacilityId });
    };
  }, []);

  return <AdminStaffingConsolePageClient {...previewProps} />;
}
