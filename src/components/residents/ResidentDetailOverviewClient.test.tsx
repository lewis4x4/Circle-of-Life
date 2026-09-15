import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResidentOverviewDetail } from "@/lib/residents/resident-detail-overview-load";
import {
  RESIDENT_OVERVIEW_LOADING_COPY,
  RESIDENT_OVERVIEW_VERIFICATION_PENDING,
} from "@/lib/residents/resident-overview-display-copy";
import {
  formatResidentOverviewActivityEmptyCopy,
  recordedDiagnosisPhrases,
  residentOverviewActivityWindow,
} from "@/lib/residents/resident-overview-presentation";

const mocks = vi.hoisted(() => ({
  residentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  selectedFacilityId: "11111111-1111-4111-8111-111111111111" as string | null,
  loadResidentOverviewDetail: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: mocks.residentId }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => `/admin/residents/${mocks.residentId}`,
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: mocks.selectedFacilityId }),
}));

vi.mock("@/lib/residents/resident-detail-overview-load", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/residents/resident-detail-overview-load")>();
  return {
    ...actual,
    loadResidentOverviewDetail: mocks.loadResidentOverviewDetail,
  };
});

vi.mock("@/components/resident-intake", () => ({
  ResidentIntakeLinks: () => <div>Packet reviews mock</div>,
}));

vi.mock("@/components/residents/ResidentPresenceControl", () => ({
  ResidentPresenceControl: ({ status }: { status: string }) => <div>Presence {status}</div>,
}));

vi.mock("@/components/residents/HoldDeclineReturnButton", () => ({
  HoldDeclineReturnButton: () => null,
}));

vi.mock("@/components/admin/resident-log-modals", () => ({
  BehaviorLogModal: () => null,
  ConditionLogModal: () => null,
  GeneralNoteModal: () => null,
}));

import { ResidentDetailOverviewClient } from "./ResidentDetailOverviewClient";

function makeDetail(overrides: Partial<ResidentOverviewDetail> = {}): ResidentOverviewDetail {
  return {
    id: mocks.residentId,
    fullName: "Marsha Wheeler",
    initials: "MW",
    preferredName: null,
    photoUrl: null,
    acuity: 1,
    status: "active",
    rawStatus: "active",
    fallRiskRaw: null,
    roomLabel: "1-A",
    unitName: "No unit linked",
    admissionLabel: "Dec 26, 2025",
    dobLabel: "December 26, 1946",
    ageYears: 79,
    gender: "female",
    diagnosisRawList: [
      "OSTEOPENIA; GERD; COLON POLYPS; DEPRESSION BASAL CELL CARCINOMA; MEMORY LOSS",
      "Osteopenia",
    ],
    allergiesTokens: [],
    dietOrder: null,
    codeStatusRaw: "full_code",
    primaryPayer: null,
    hospiceStatus: "none",
    advanceDirectiveType: null,
    advanceDirectiveOnFile: false,
    responsiblePartyName: null,
    responsiblePartyRelationship: null,
    responsiblePartyPhone: null,
    responsiblePartyEmail: null,
    primaryPhysicianName: null,
    primaryPhysicianPhone: null,
    codeStatusVerifiedAt: null,
    codeStatusVerifiedByName: null,
    allergyReviewedAt: null,
    allergyReviewedByName: null,
    diagnosesReviewedAt: null,
    diagnosesReviewedByName: null,
    carePlanVersion: null,
    carePlanEffectiveDate: null,
    carePlanAnnualDeltaDays: 8,
    polstMolstRawStatus: null,
    specialistConsultActiveCount: 0,
    assessmentsUpcomingJson: [],
    contacts: [],
    recentDailyNotes: [],
    recentAdl: [],
    recentBehavior: [],
    recentConditionChanges: [],
    ...overrides,
  };
}

describe("ResidentDetailOverviewClient", () => {
  beforeEach(() => {
    mocks.loadResidentOverviewDetail.mockReset();
    mocks.selectedFacilityId = "11111111-1111-4111-8111-111111111111";
  });

  it("shows a factual loading state before the profile arrives", () => {
    render(<ResidentDetailOverviewClient workspace="admin" />);
    expect(screen.getByRole("status")).toHaveTextContent(RESIDENT_OVERVIEW_LOADING_COPY);
    expect(screen.queryByText("Quiet shift")).not.toBeInTheDocument();
  });

  it("shows unavailable copy when the profile cannot be loaded", async () => {
    mocks.loadResidentOverviewDetail.mockRejectedValue(new Error("unavailable"));
    render(
      <ResidentDetailOverviewClient
        workspace="admin"
        initialDetail={null}
        initialError="Live resident profile is unavailable right now."
        initialFacilityId={mocks.selectedFacilityId}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Live resident profile is unavailable right now.",
    );
  });

  it("renders empty, unreviewed, and identity states without implementation language", async () => {
    const user = userEvent.setup();
    render(
      <ResidentDetailOverviewClient
        workspace="admin"
        initialDetail={makeDetail()}
        initialFacilityId={mocks.selectedFacilityId}
      />,
    );

    const emptyCopy = formatResidentOverviewActivityEmptyCopy(residentOverviewActivityWindow());
    expect(screen.getByRole("status")).toHaveTextContent(emptyCopy);
    expect(screen.queryByText(/quiet shift/i)).not.toBeInTheDocument();
    expect(screen.getByText(`Full code · ${RESIDENT_OVERVIEW_VERIFICATION_PENDING}`)).toBeVisible();
    expect(screen.getByText("Age 79 · Born December 26, 1946 · Female")).toBeInTheDocument();
    expect(screen.queryByText(/DOB — hover label/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/capture verification in profile editor/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Upload another packet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Confirm scope in eMAR tooling/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log behavior" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log condition" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add note" })).toBeInTheDocument();
    expect(screen.getByText("Annual care plan review")).toBeInTheDocument();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText("Record completeness")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Location" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Packet reviews" })).not.toBeInTheDocument();

    const diagnosisPhrases = recordedDiagnosisPhrases([
      "OSTEOPENIA; GERD; COLON POLYPS; DEPRESSION BASAL CELL CARCINOMA; MEMORY LOSS",
      "Osteopenia",
    ]);
    await user.click(screen.getByText("Show directives and diagnoses"));
    expect(screen.getByText(diagnosisPhrases[0], { hidden: true })).toBeInTheDocument();
    expect(screen.getByText("Osteopenia", { hidden: true })).toBeInTheDocument();
    expect(screen.queryByText("GI")).not.toBeInTheDocument();
  });

  it("renders populated recent activity without treating it as a quiet shift", () => {
    render(
      <ResidentDetailOverviewClient
        workspace="admin"
        initialDetail={makeDetail({
          recentBehavior: [
            {
              id: "beh-1",
              typeLabel: "Agitation / anxiety",
              behaviorText: "Pacing the hallway after dinner.",
              occurredLabel: "Sep 15, 2:10 PM",
              shift: "evening",
              loggedByLabel: "Jordan Lee",
              injuryOccurred: false,
              notesSnippet: null,
              occurredAtIso: new Date().toISOString(),
            },
          ],
        })}
        initialFacilityId={mocks.selectedFacilityId}
      />,
    );

    expect(screen.getByText("Agitation / anxiety")).toBeInTheDocument();
    expect(screen.getByText("Pacing the hallway after dinner.")).toBeInTheDocument();
    expect(screen.queryByText(/No activity recorded/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/quiet shift/i)).not.toBeInTheDocument();
  });

  it("keeps documentation actions keyboard reachable", async () => {
    const user = userEvent.setup();
    render(
      <ResidentDetailOverviewClient
        workspace="admin"
        initialDetail={makeDetail()}
        initialFacilityId={mocks.selectedFacilityId}
      />,
    );

    await user.tab();
    const header = screen.getByRole("heading", { name: "Marsha Wheeler" }).closest("div");
    expect(header).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log behavior" })).toHaveAccessibleName("Log behavior");
    expect(screen.getByRole("link", { name: /Resident roster/i })).toBeInTheDocument();
  });

  it("places needs attention above record completeness", () => {
    render(
      <ResidentDetailOverviewClient
        workspace="admin"
        initialDetail={makeDetail()}
        initialFacilityId={mocks.selectedFacilityId}
      />,
    );
    const attention = screen.getByRole("region", { name: "Needs attention" });
    const completeness = screen.getByRole("region", { name: "Record completeness" });
    expect(attention.compareDocumentPosition(completeness) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(completeness).getByText("Packet reviews mock")).toBeInTheDocument();
  });
});
