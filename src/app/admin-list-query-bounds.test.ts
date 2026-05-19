import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readSource = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

const admissionsSource = readSource("src/app/(admin)/admin/admissions/page.tsx");
const newAdmissionSource = readSource("src/app/(admin)/admin/admissions/new/page.tsx");
const invoiceSource = readSource("src/app/(admin)/vendors/invoices/page.tsx");
const purchaseOrderSource = readSource("src/app/(admin)/vendors/purchase-orders/page.tsx");
const referralsSource = readSource("src/app/(admin)/admin/referrals/page.tsx");
const dischargeMedRecHubSource = readSource(
  "src/components/admin/discharge/discharge-med-rec-hub.tsx",
);

describe("admin list query bounds", () => {
  it("bounds admissions hub preview list queries without changing head-count patterns", () => {
    expect(admissionsSource).toContain("const ADMISSIONS_HUB_PREVIEW_LIMIT = 100;");

    const limitMatches = admissionsSource.match(/\.limit\(ADMISSIONS_HUB_PREVIEW_LIMIT\)/g) ?? [];
    expect(limitMatches).toHaveLength(5);

    expect(admissionsSource).toContain('.select("id", { count: "exact", head: true })');
  });

  it("guards admissions async loaders from stale state writes", () => {
    expect(admissionsSource).toContain("void load(() => !cancelled);");
    expect(admissionsSource).toContain("if (!isCurrent()) return;");
    expect(admissionsSource).toContain("if (isCurrent()) setLoading(false);");
    expect(admissionsSource).toContain("if (cancelled) return;");
    expect(admissionsSource).toContain("const isCurrentLoadContext = useCallback(");
    expect(admissionsSource).toContain("await load(() => isCurrentLoadContext(actionFacilityId, actionHubScope));");

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
    expect(dischargeMedRecHubSource).toContain(
      "const DISCHARGE_MED_REC_HUB_LIST_LIMIT = 150;",
    );
    expect(dischargeMedRecHubSource).toContain("api.limit(");
    expect(dischargeMedRecHubSource).toContain(
      "DISCHARGE_MED_REC_HUB_LIST_LIMIT + 1",
    );
    expect(dischargeMedRecHubSource).toContain(
      "Showing the newest {DISCHARGE_MED_REC_HUB_LIST_LIMIT} reconciliations for this time scope",
    );
    expect(dischargeMedRecHubSource).toContain(
      "No loaded newest rows match this filter yet.",
    );
    expect(dischargeMedRecHubSource).not.toContain(
      "missing meds, missing prescriber, or expected discharge date in the past",
    );
    expect(dischargeMedRecHubSource).toContain(
      "missing discharge target date, pending hospice planning, or nurse reconciliation notes",
    );
  });

  it("keeps referrals roster unbounded while bounding pipeline/upcoming tours and admissions fanout", () => {
    expect(referralsSource).toContain("const REFERRAL_PIPELINE_DISPLAY_LIMIT = 60;");
    expect(referralsSource).toContain("const REFERRAL_UPCOMING_TOUR_LIMIT = 6;");
    expect(referralsSource).toContain(".slice(0, REFERRAL_PIPELINE_DISPLAY_LIMIT)");
    expect(referralsSource).toContain(".gte(\"tour_scheduled_for\", nowIso)");
    expect(referralsSource).toContain(".limit(REFERRAL_UPCOMING_TOUR_LIMIT)");
    expect(referralsSource).toContain("Showing the next {REFERRAL_UPCOMING_TOUR_LIMIT} scheduled tours");

    expect(referralsSource).not.toContain("tour_completed_at");
    expect(referralsSource).not.toContain("const leadIds = leadRows.map");
    expect(referralsSource).not.toContain('.in("referral_lead_id", leadIds)');

    expect(referralsSource).toContain('.from("admission_cases")');
    expect(referralsSource).toContain('.eq("facility_id", selectedFacilityId)');
    expect(referralsSource).toContain('.is("deleted_at", null)');
    expect(referralsSource).toContain('.not("status", "eq", "cancelled")');
  });
});
