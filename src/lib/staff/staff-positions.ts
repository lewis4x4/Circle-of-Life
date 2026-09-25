/**
 * Staff positions (`public.staff_role` enum) offered when creating or editing a staff record.
 * Distinct from the login role (`app_role`), which is managed under Settings → Users.
 */

import { enumLabel } from "@/lib/display/enum-label";

/** Matches `staff_role` enum in DB */
export const STAFF_POSITION_OPTIONS: { value: string; label: string }[] = [
  { value: "cna", label: "CNA" },
  { value: "lpn", label: "LPN" },
  { value: "rn", label: "RN" },
  { value: "administrator", label: "Administrator" },
  { value: "assistant_administrator", label: "Assistant administrator" },
  { value: "admin_support_coordinator", label: "Admin support coordinator" },
  { value: "medication_tech", label: "Medication tech" },
  { value: "resident_aide", label: "Resident aide" },
  { value: "resident_services_coordinator", label: "Resident services coordinator" },
  { value: "activities_director", label: "Activities director" },
  { value: "activity_aide", label: "Activity aide" },
  { value: "dietary_staff", label: "Dietary staff" },
  { value: "cook", label: "Cook" },
  { value: "dietary_manager", label: "Dietary manager" },
  { value: "dietary_aide", label: "Dietary aide" },
  { value: "maintenance", label: "Maintenance" },
  { value: "maintenance_director", label: "Maintenance director" },
  { value: "maintenance_standby", label: "Maintenance standby" },
  { value: "housekeeping", label: "Housekeeper" },
  { value: "driver", label: "Driver" },
  { value: "marketing_consultant", label: "Marketing consultant" },
  { value: "owner", label: "Owner" },
  { value: "ceo", label: "CEO" },
  { value: "coo", label: "COO" },
  { value: "cfo", label: "CFO" },
  { value: "other", label: "Other" },
];

/** Position choices for an existing record; keeps a current value that is no longer offered. */
export function staffPositionOptions(current: string): { value: string; label: string }[] {
  if (!current || STAFF_POSITION_OPTIONS.some((o) => o.value === current)) {
    return [...STAFF_POSITION_OPTIONS];
  }
  return [{ value: current, label: enumLabel(current) }, ...STAFF_POSITION_OPTIONS];
}
