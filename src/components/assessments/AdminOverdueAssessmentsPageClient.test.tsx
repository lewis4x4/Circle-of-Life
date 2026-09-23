import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AdminOverdueAssessmentsPageClient } from "./AdminOverdueAssessmentsPageClient";

const HOMEWOOD = "00000000-0000-0000-0002-000000000003";
let selectedFacilityId: string | null = HOMEWOOD;

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/care-plans/care-plan-diff-modal", () => ({ CarePlanDiffModal: () => null }));
vi.mock("@/lib/assessments/load-overdue-assessments", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/assessments/load-overdue-assessments")>();
  const unexpected = vi.fn(async () => {
    throw new Error("not expected in this test");
  });
  return {
    ...original,
    fetchOverdueAssessmentsFromSupabase: unexpected,
    fetchCarePlanReviewsDueFromSupabase: unexpected,
    fetchClinicalDeskScope: unexpected,
  };
});

function renderDesk(scope: { assessmentsOnFile: number; activeCarePlans: number } | null) {
  return render(
    <AdminOverdueAssessmentsPageClient
      initialAssessments={[]}
      initialCarePlans={[]}
      initialError={null}
      initialFacilityId={HOMEWOOD}
      initialScope={scope}
      initialSourceNotice={null}
    />,
  );
}

describe("Clinical Desk empty queues (COL-649)", () => {
  it("does not say All Clear when no resident has an assessment or a plan", () => {
    selectedFacilityId = HOMEWOOD;
    renderDesk({ assessmentsOnFile: 0, activeCarePlans: 0 });
    expect(screen.queryByText("All Clear")).toBeNull();
    expect(screen.getByText("No assessments on file")).toBeInTheDocument();
    expect(screen.getByText("No active care plans")).toBeInTheDocument();
    expect(screen.getByText("Overdue: No assessments on file")).toBeInTheDocument();
    expect(screen.queryByText(/^0 overdue$/i)).toBeNull();
  });

  it("says All Clear only over records that exist", () => {
    selectedFacilityId = HOMEWOOD;
    renderDesk({ assessmentsOnFile: 40, activeCarePlans: 12 });
    expect(screen.getAllByText("All Clear")).toHaveLength(2);
    expect(screen.getByText("0 overdue")).toBeInTheDocument();
  });
});
