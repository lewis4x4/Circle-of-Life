import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readSource = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

const admissionsBootstrapSource = readSource("src/lib/admissions/admissions-hub-bootstrap.ts");
const admissionsClientSource = readSource("src/components/admissions/AdminAdmissionsPageClient.tsx");
const newAdmissionSource = readSource("src/app/(admin)/admin/admissions/new/page.tsx");
const invoiceSource = readSource("src/app/(admin)/vendors/invoices/page.tsx");
const purchaseOrderSource = readSource("src/app/(admin)/vendors/purchase-orders/page.tsx");
const referralsBootstrapSource = readSource("src/lib/referrals/referrals-hub-bootstrap.ts");
const referralsClientSource = readSource("src/components/referrals/AdminReferralsPageClient.tsx");
const dischargeMedRecHubBootstrapSource = readSource(
  "src/lib/discharge/load-discharge-hub-bootstrap.ts",
);
const dischargeMedRecHubClientSource = readSource(
  "src/components/admin/discharge/discharge-med-rec-hub-client.tsx",
);
const facilityDetailSource = readSource("src/app/(admin)/admin/facilities/[facilityId]/page.tsx");
const facilityRatesHookSource = readSource("src/hooks/useFacilityRates.ts");
const facilityBuildingProfileHookSource = readSource("src/hooks/useFacilityBuildingProfile.ts");
const facilityOverviewTabSource = readSource("src/components/admin/facilities/tabs/OverviewTab.tsx");
const operationsTodaySource = readSource("src/app/(admin)/admin/operations/page.tsx");
const incidentDetailLoaderSource = readSource("src/lib/incidents/load-incident-detail.ts");
const incidentDetailPageSource = readSource("src/app/(admin)/incidents/[id]/page.tsx");

describe("admin list query bounds", () => {
  it("bounds admissions hub preview list queries without changing head-count patterns", () => {
    expect(admissionsBootstrapSource).toContain("export const ADMISSIONS_HUB_PREVIEW_LIMIT = 100;");

    const limitMatches =
      admissionsBootstrapSource.match(/\.limit\(ADMISSIONS_HUB_PREVIEW_LIMIT\)/g) ?? [];
    expect(limitMatches).toHaveLength(5);

    expect(admissionsBootstrapSource).toContain('.select("id", { count: "exact", head: true })');
  });

  it("guards admissions async loaders from stale state writes", () => {
    expect(admissionsClientSource).toContain("void load(() => !cancelled);");
    expect(admissionsClientSource).toContain("if (!isCurrent()) return;");
    expect(admissionsClientSource).toContain("if (isCurrent()) setLoading(false);");
    expect(admissionsClientSource).toContain("cancelled = true;");
    expect(admissionsClientSource).toContain("const isCurrentLoadContext = useCallback(");
    expect(admissionsClientSource).toContain(
      "await load(() => isCurrentLoadContext(actionFacilityId, actionHubScope));",
    );

    expect(newAdmissionSource).toContain("void loadRefs(() => !cancelled);");
    expect(newAdmissionSource).toContain("if (cancelled) return;");
    expect(newAdmissionSource).toContain("if (!cancelled) setDuplicateLookupLoading(false);");
    expect(newAdmissionSource).toContain("const isCurrentRefsContext = useCallback(");
    expect(newAdmissionSource).toContain("await loadRefs(() => isCurrentRefsContext(actionFacilityId));");
    expect(newAdmissionSource).toContain("if (!cancelled) setExistingAdmissionCaseId(data?.id ?? null);");
    expect(newAdmissionSource).toContain("if (!cancelled) setExistingResidentAdmissionCaseId(data?.id ?? null);");
  });

  it("limits vendor invoices list query to rendered columns", () => {
    expect(invoiceSource).toContain("const VENDOR_INVOICE_LIST_LIMIT = 150;");
    expect(invoiceSource).toContain('.select("id, invoice_number, status, invoice_date, total_cents")');
    expect(invoiceSource).toContain(".limit(VENDOR_INVOICE_LIST_LIMIT)");
    expect(invoiceSource).not.toContain('.select("*")');
  });

  it("limits purchase orders list query to rendered columns", () => {
    expect(purchaseOrderSource).toContain("const PURCHASE_ORDER_LIST_LIMIT = 150;");
    expect(purchaseOrderSource).toContain('.select("id, po_number, status, order_date, total_cents")');
    expect(purchaseOrderSource).toContain(".limit(PURCHASE_ORDER_LIST_LIMIT)");
    expect(purchaseOrderSource).not.toContain('.select("*")');
  });

  it("caps discharge med-rec hub list loading with honest capped-cohort copy", () => {
    expect(dischargeMedRecHubBootstrapSource).toContain(
      "const DISCHARGE_MED_REC_HUB_LIST_LIMIT = 150;",
    );
    expect(dischargeMedRecHubBootstrapSource).toContain(".limit(");
    expect(dischargeMedRecHubBootstrapSource).toContain(
      "DISCHARGE_MED_REC_HUB_LIST_LIMIT + 1",
    );
    expect(dischargeMedRecHubClientSource).toContain(
      "Showing the newest {DISCHARGE_MED_REC_HUB_LIST_LIMIT} reconciliations for this time scope",
    );
    expect(dischargeMedRecHubClientSource).toContain(
      "No loaded newest rows match this filter yet.",
    );
    expect(dischargeMedRecHubClientSource).not.toContain(
      "missing meds, missing prescriber, or expected discharge date in the past",
    );
    expect(dischargeMedRecHubClientSource).toContain(
      "missing discharge target date, pending hospice planning, or nurse reconciliation notes",
    );
  });

  it("gates facility detail tab data hooks and lazy-loads tab bodies", () => {
    expect(facilityDetailSource).toContain("const needsRates = activeTab === \"rates\" || activeTab === \"audit\";");
    expect(facilityDetailSource).toContain(
      "activeTab === \"building\" || activeTab === \"emergency\" || activeTab === \"vendors\" || activeTab === \"audit\"",
    );
    expect(facilityDetailSource).toContain(
      "activeTab === \"emergency\" || activeTab === \"vendors\" || activeTab === \"audit\"",
    );
    expect(facilityDetailSource).toContain("useFacilityRates(facilityId, { enabled: needsRates })");
    expect(facilityDetailSource).toContain(
      "useFacilityBuildingProfile(facilityId, { enabled: needsBuildingProfile })",
    );
    expect(facilityDetailSource).toContain(
      "useFacilityEmergencyContacts(facilityId, { enabled: needsEmergencyContacts })",
    );
    expect(facilityDetailSource).toContain(
      "vendorFacilities.isLoading || buildingProfileApi.isLoading || emergencyApi.isLoading",
    );
    expect(facilityDetailSource).toContain("import dynamic from \"next/dynamic\"");
    expect(facilityDetailSource).toContain("const TabBodyLoading = () => (");
  });

  it("supports enabled gating in facility hooks and overview tab", () => {
    expect(facilityRatesHookSource).toContain("options?: { enabled?: boolean }");
    expect(facilityRatesHookSource).toContain("if (!enabled) {");
    expect(facilityBuildingProfileHookSource).toContain("options?: { enabled?: boolean }");
    expect(facilityBuildingProfileHookSource).toContain("if (!enabled) {");

    expect(facilityOverviewTabSource).not.toContain("const { facility, isLoading, error } = useFacility(facilityId);");
    expect(facilityOverviewTabSource).toContain("facility: FacilityDetailRow;");
    expect(facilityOverviewTabSource).toContain("enableBedAvailability?: boolean;");
    expect(facilityOverviewTabSource).toContain("useFacilityBedAvailability(facilityId, { enabled: shouldLoadBedAvailability })");
    expect(facilityOverviewTabSource).toContain("new IntersectionObserver(");
  });

  it("keeps operations adequacy loading from depending on stats and removes raw-id task placeholder", () => {
    expect(operationsTodaySource).toContain("setStats((current) =>");
    expect(operationsTodaySource).toContain("current ? { ...current, adequacy_score: data.adequacy_score } : current");
    expect(operationsTodaySource).toContain(
      "}, [selectedFacilityId, authLoading, autoShiftApplied, selectedShift]);",
    );
    expect(operationsTodaySource).toContain("const selectedTask = selectedTaskId ? tasks.find");
    expect(operationsTodaySource).toContain("<h2 className=\"text-xl font-bold mb-4\">Task details</h2>");
    expect(operationsTodaySource).not.toContain("Full task detail is deferred");
    expect(operationsTodaySource).not.toContain("Task detail modal placeholder");
  });

  it("keeps referrals roster unbounded while bounding pipeline/upcoming tours and admissions fanout", () => {
    expect(referralsClientSource).toContain("const REFERRAL_PIPELINE_DISPLAY_LIMIT = 60;");
    expect(referralsBootstrapSource).toContain("export const REFERRAL_UPCOMING_TOUR_LIMIT = 6;");
    expect(referralsClientSource).toContain(".slice(0, REFERRAL_PIPELINE_DISPLAY_LIMIT)");
    expect(referralsBootstrapSource).toContain('.gte("tour_scheduled_for", nowIso)');
    expect(referralsBootstrapSource).toContain(".limit(REFERRAL_UPCOMING_TOUR_LIMIT)");
    expect(referralsClientSource).toContain("Showing the next {REFERRAL_UPCOMING_TOUR_LIMIT} scheduled tours");

    expect(referralsBootstrapSource).not.toContain("tour_completed_at");
    expect(referralsBootstrapSource).not.toContain("const leadIds = leadRows.map");
    expect(referralsBootstrapSource).not.toContain('.in("referral_lead_id", leadIds)');

    expect(referralsBootstrapSource).toContain('.from("admission_cases")');
    expect(referralsBootstrapSource).toContain('.eq("facility_id", selectedFacilityId)');
    expect(referralsBootstrapSource).toContain('.is("deleted_at", null)');
    expect(referralsBootstrapSource).toContain('.not("status", "eq", "cancelled")');
  });

  it("server-bootstraps incident detail and parallelizes detail loader queries", () => {
    expect(incidentDetailPageSource).toContain("loadIncidentDetailBootstrap");
    expect(incidentDetailPageSource).toContain("AdminIncidentDetailPageClient");
    expect(incidentDetailLoaderSource).toContain("await Promise.all([");
    expect(incidentDetailLoaderSource.match(/await Promise\.all\(\[/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
