import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CarePlanReviewsDuePageClient } from "./CarePlanReviewsDuePageClient";

const HOMEWOOD = "00000000-0000-0000-0002-000000000003";

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: HOMEWOOD }),
}));
vi.mock("@/lib/care-plans/reviews-due", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/care-plans/reviews-due")>();
  const unexpected = vi.fn(async () => {
    throw new Error("not expected in this test");
  });
  return { ...original, fetchCarePlanReviewsDue: unexpected, fetchActiveCarePlanCount: unexpected };
});

function renderQueue(activePlans: number) {
  return render(
    <CarePlanReviewsDuePageClient
      initialRows={[]}
      initialError={null}
      initialActivePlanCount={activePlans}
      initialFacilityId={HOMEWOOD}
    />,
  );
}

describe("Care plan reviews due with no plans (COL-649)", () => {
  it("says no plans exist instead of 0 overdue / 0 due / 0 flagged", () => {
    renderQueue(0);
    expect(screen.queryByText("0 overdue")).toBeNull();
    expect(screen.getByText("Overdue: No active care plans")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No active care plans" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Form 1823 alignment" })).toHaveAttribute(
      "href",
      "/admin/care-plans/form-1823-alignment",
    );
  });

  it("keeps real zeros when active plans exist", () => {
    renderQueue(8);
    expect(screen.getByText("0 overdue")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No reviews due" })).toBeInTheDocument();
  });
});
