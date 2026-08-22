"use client";

import { useCallback, useEffect, useState } from "react";

import {
  classifyStaffCertification,
  isBackgroundCheckExpiringWithin30Days,
} from "@/lib/facilities/facility-staff-kpi-classification";
import {
  countUniqueActiveStaffDirectoryRecords,
  STAFF_DIRECTORY_IDENTITY_SELECT,
  type StaffDirectorySourceRow,
} from "@/lib/staff/load-staff";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

export type FacilityStaffKpiPayload = {
  activeStaff: number;
  certsCurrent: number;
  certsExpiring: number;
  certsExpired: number;
  bgChecksExpiringLt30: number;
  rosterUpdatedAt: string | null;
  rosterUpdatedByDisplayName: string | null;
  /** Shift coverage gaps in the next 7 days; null until the coverage engine posts counts. */
  coverageGapNext7Days: number | null;
};

const EMPTY: FacilityStaffKpiPayload = {
  activeStaff: 0,
  certsCurrent: 0,
  certsExpiring: 0,
  certsExpired: 0,
  bgChecksExpiringLt30: 0,
  rosterUpdatedAt: null,
  rosterUpdatedByDisplayName: null,
  coverageGapNext7Days: null,
};

export function useFacilityStaffKpis(facilityId: string | undefined, enabled: boolean) {
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FacilityStaffKpiPayload | null>(null);

  const load = useCallback(async () => {
    if (!facilityId || !isValidFacilityIdForQuery(facilityId) || !enabled) {
      setLoading(false);
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();

      const [staffActiveRes, rosterFreshRes, certsRes, bgRes] = await Promise.all([
        supabase
          .from("staff" as never)
          .select(STAFF_DIRECTORY_IDENTITY_SELECT)
          .eq("facility_id", facilityId)
          .is("deleted_at", null),
        supabase
          .from("staff" as never)
          .select("updated_at, updated_by")
          .eq("facility_id", facilityId)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("staff_certifications" as never)
          .select("expiration_date, status")
          .eq("facility_id", facilityId)
          .is("deleted_at", null),
        supabase
          .from("staff_background_checks" as never)
          .select("expires_at")
          .eq("facility_id", facilityId)
          .is("deleted_at", null)
          .not("expires_at", "is", null),
      ]);

      if (staffActiveRes.error) throw staffActiveRes.error;
      if (rosterFreshRes.error) throw rosterFreshRes.error;
      if (certsRes.error) throw certsRes.error;
      if (bgRes.error) throw bgRes.error;

      const staffRows = (staffActiveRes.data ?? []) as StaffDirectorySourceRow[];
      const activeStaff = countUniqueActiveStaffDirectoryRecords(staffRows);

      const freshRow = rosterFreshRes.data as { updated_at?: string; updated_by?: string | null } | null;
      let rosterUpdatedByDisplayName: string | null = null;
      const rosterUpdatedAt = freshRow?.updated_at ?? null;
      const ub = freshRow?.updated_by;
      if (typeof ub === "string" && ub.length > 0) {
        const prof = await supabase.from("user_profiles").select("full_name").eq("id", ub).maybeSingle();
        if (!prof.error && prof.data?.full_name) {
          rosterUpdatedByDisplayName = prof.data.full_name;
        }
      }

      let certsCurrent = 0;
      let certsExpiring = 0;
      let certsExpired = 0;
      const certRows = (certsRes.data ?? []) as { expiration_date: string | null; status: string }[];
      for (const row of certRows) {
        const bucket = classifyStaffCertification(row.expiration_date, row.status);
        if (bucket === "expired") certsExpired += 1;
        else if (bucket === "expiring") certsExpiring += 1;
        else certsCurrent += 1;
      }

      let bgChecksExpiringLt30 = 0;
      const bgRows = (bgRes.data ?? []) as { expires_at: string | null }[];
      for (const row of bgRows) {
        if (isBackgroundCheckExpiringWithin30Days(row.expires_at)) bgChecksExpiringLt30 += 1;
      }

      setData({
        activeStaff,
        certsCurrent,
        certsExpiring,
        certsExpired,
        bgChecksExpiringLt30,
        rosterUpdatedAt,
        rosterUpdatedByDisplayName,
        coverageGapNext7Days: null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load staffing KPIs");
      setData({ ...EMPTY });
    } finally {
      setLoading(false);
    }
  }, [enabled, facilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loading, error, data, refetch: load };
}
