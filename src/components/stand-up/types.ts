import type { MetricKey, StandUpReport, StandUpValues } from '@/lib/stand-up/model';

export type RecoveryPreview = {
  facility_id: string; week_start: string; preview_id: string; expected_version: number;
  merged: StandUpValues; baseline?: StandUpValues; current?: StandUpValues; incoming?: StandUpValues;
  conflicts: MetricKey[]; clears: MetricKey[];
};
/**
 * A facility carries its own entry window. `open_week` is the meeting Monday
 * this facility may enter now, which is the organization default unless an
 * owner widened or narrowed it; `entry_open_lead_minutes` is null when the
 * facility simply uses the Haven default.
 */
export type StandUpFacility = {
  id: string; name: string;
  entry_open_lead_minutes?: number | null; open_week?: string; entry_opens_at?: string;
};
export type StandUpWorkspaceData = {
  pending_recoveries?: RecoveryPreview[]; facilities: StandUpFacility[];
  reports: StandUpReport[]; current_week: string; can_import: boolean;
  server_now?: string; actor_role?: string;
};
export type StandUpEntryWindowSaved = {
  facility_id: string; entry_open_lead_minutes: number | null; open_week: string; entry_opens_at: string;
};
