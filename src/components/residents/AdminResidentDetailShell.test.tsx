import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResidentOverviewDetail } from "@/lib/residents/resident-detail-overview-load";

const shellMocks = vi.hoisted(() => ({
  selectedSegment: "assessments" as string | null,
  loadResidentOverviewDetail: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
  useSelectedLayoutSegment: () => shellMocks.selectedSegment,
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: "facility-1" }),
}));

vi.mock("@/lib/residents/resident-detail-overview-load", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/lib/residents/resident-detail-overview-load")
  >();
  return {
    ...original,
    loadResidentOverviewDetail: shellMocks.loadResidentOverviewDetail,
  };
});

vi.mock("@/components/admin/resident-log-modals", () => ({
  BehaviorLogModal: () => null,
  ConditionLogModal: () => null,
  GeneralNoteModal: () => null,
}));

vi.mock("@/components/residents/ResidentDetailTabStrip", () => ({
  ResidentDetailTabStrip: () => <div data-testid="resident-tabs" />,
}));

vi.mock("@/design-system/components/record-detail", () => ({
  RecordDetailHeader: ({ subtitle }: { subtitle: string }) => (
    <div data-testid="resident-subtitle">{subtitle}</div>
  ),
}));

import { AdminResidentDetailShell } from "./AdminResidentDetailShell";

function residentDetail(gender: string | null): ResidentOverviewDetail {
  return {
    id: "resident-1",
    fullName: "Mary Johnson",
    ageYears: 82,
    gender,
    roomLabel: "101 A",
    admissionLabel: "Aug 1, 2026",
    rawStatus: "active",
    status: "active",
  } as ResidentOverviewDetail;
}

describe("AdminResidentDetailShell", () => {
  beforeEach(() => {
    shellMocks.selectedSegment = "assessments";
    shellMocks.loadResidentOverviewDetail.mockReset();
    shellMocks.loadResidentOverviewDetail.mockImplementation(
      () => new Promise<ResidentOverviewDetail | null>(() => undefined),
    );
  });

  it("keeps child tab content available when the profile header fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    shellMocks.loadResidentOverviewDetail.mockRejectedValueOnce(
      new Error("profile unavailable"),
    );

    render(
      <AdminResidentDetailShell
        initialDetail={null}
        initialError="Live resident profile is unavailable right now."
        initialFacilityId="facility-1"
      >
        <div>Independent assessment content</div>
      </AdminResidentDetailShell>,
    );

    expect(screen.getByText("Independent assessment content")).toBeInTheDocument();
    expect(screen.getByTestId("resident-tabs")).toBeInTheDocument();
    expect(
      await screen.findByText("Live resident profile is unavailable right now."),
    ).toBeInTheDocument();
  });

  it("uses the overview gender copy in the shared header", () => {
    render(
      <AdminResidentDetailShell
        initialDetail={residentDetail(null)}
        initialError={null}
        initialFacilityId="facility-1"
      >
        <div>Independent assessment content</div>
      </AdminResidentDetailShell>,
    );

    expect(screen.getByTestId("resident-subtitle")).toHaveTextContent(
      "Age 82 · No gender posted · Room 101 A · Admitted Aug 1, 2026",
    );
  });
});
