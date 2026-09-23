/**
 * COL-708: dashboard loaders must not turn a failed or missing head count into
 * 0. Each case here returned 0 before the fix.
 */
import { describe, expect, it } from "vitest";

import { fetchAdminAssistantDashboardBrief } from "@/lib/admin-assistant/dashboard-brief";
import { fetchCoordinatorDashboardBrief } from "@/lib/coordinator/dashboard-brief";
import { fetchExecutiveKpiSnapshot } from "@/lib/exec-kpi-snapshot";
import { fetchMorningHuddleData } from "@/lib/office/morning-huddle";
import { loadAdmissionRateTermCount } from "@/lib/workflows/workflow-events";

import { isHeadCountQuery, supabaseQueryDouble } from "./supabase-query-double.test-helper";

const FACILITY = "00000000-0000-4000-8000-0000000000f1";
const ORG = "00000000-0000-4000-8000-0000000000a1";

describe("front desk and coordinator briefs", () => {
  it("report a failed count as null (shown as 'No … count posted'), not 0", async () => {
    const supabase = supabaseQueryDouble((_table, calls) =>
      isHeadCountQuery(calls) ? { count: null, error: { message: "permission denied" } } : { data: [], error: null },
    );

    const assistant = await fetchAdminAssistantDashboardBrief(FACILITY, supabase);
    expect(assistant.censusCount).toBeNull();
    expect(assistant.pendingDocs).toBeNull();
    expect(assistant.staffBulletinNotes).toBeNull();

    const coordinator = await fetchCoordinatorDashboardBrief(FACILITY, supabase);
    expect(coordinator.activeCarePlans).toBeNull();
    expect(coordinator.reviewsDue14d).toBeNull();
    expect(coordinator.pendingAssessments).toBeNull();
    expect(coordinator.activeAdmissions).toBeNull();
    expect(coordinator.recentConditionChanges).toBeNull();
  });

  it("keep real zeros", async () => {
    const supabase = supabaseQueryDouble((_table, calls) =>
      isHeadCountQuery(calls) ? { count: 0, error: null } : { data: [], error: null },
    );
    expect((await fetchAdminAssistantDashboardBrief(FACILITY, supabase)).pendingDocs).toBe(0);
    expect((await fetchCoordinatorDashboardBrief(FACILITY, supabase)).reviewsDue14d).toBe(0);
  });
});

describe("loaders whose counts must exist", () => {
  const missingCount = supabaseQueryDouble((table, calls) => {
    if (table === "facilities") return { data: [{ id: FACILITY, total_licensed_beds: 36 }], error: null };
    return isHeadCountQuery(calls) ? { count: null, error: null } : { data: [], count: null, error: null };
  });

  it("morning huddle fails instead of reporting census 0", async () => {
    await expect(fetchMorningHuddleData(missingCount, FACILITY, "2026-09-23")).rejects.toThrow(/count was not returned/);
  });

  it("executive KPI snapshot fails instead of reporting 0 incidents, deficiencies, outbreaks", async () => {
    await expect(fetchExecutiveKpiSnapshot(missingCount, ORG, FACILITY)).rejects.toThrow(/count was not returned/);
  });

  it("admission rate terms fail instead of reading as none", async () => {
    await expect(
      loadAdmissionRateTermCount(missingCount as never, "00000000-0000-4000-8000-0000000000c1"),
    ).rejects.toThrow(/count was not returned/);
  });
});
