import type { MetricKey, StandUpReport, StandUpValues } from '@/lib/stand-up/model';

export type RecoveryPreview = {
  facility_id: string; week_start: string; preview_id: string; expected_version: number;
  merged: StandUpValues; baseline?: StandUpValues; current?: StandUpValues; incoming?: StandUpValues;
  conflicts: MetricKey[]; clears: MetricKey[];
};
export type StandUpWorkspaceData = {
  pending_recoveries?: RecoveryPreview[]; facilities: { id: string; name: string }[];
  reports: StandUpReport[]; current_week: string; can_import: boolean;
  server_now?: string; actor_role?: string;
};
