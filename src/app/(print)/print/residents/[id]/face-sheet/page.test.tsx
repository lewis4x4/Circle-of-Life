import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import type { ResidentOverviewDetail } from "@/lib/residents/resident-detail-overview-load";

const RESIDENT_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({ load: vi.fn(), id: "" }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: mocks.id }),
  useSearchParams: () => new URLSearchParams("auto=0"),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ fullName: "Printer Example", loading: false }),
}));
vi.mock("@/lib/residents/resident-detail-overview-load", () => ({
  loadResidentOverviewDetail: mocks.load,
}));

import ResidentFaceSheetPage from "./page";

function detail(overrides: Partial<ResidentOverviewDetail> = {}): ResidentOverviewDetail {
  return {
    id: RESIDENT_ID,
    fullName: "Marsha Wheeler",
    initials: "MW",
    preferredName: null,
    photoUrl: null,
    acuity: 1,
    acuityLevel: null,
    status: "hospital",
    rawStatus: "hospital_hold",
    fallRiskRaw: null,
    roomLabel: "1-A",
    unitName: "Main Wing",
    facilityName: "Homewood Lodge",
    facilityId: "f1",
    admissionLabel: "Dec 26, 2025",
    dobLabel: "March 3, 1947",
    ageYears: 79,
    gender: "female",
    diagnosisRawList: ["CHF"],
    primaryDiagnosisRaw: "CHF",
    diagnosisListRaw: [],
    allergiesTokens: [],
    dietOrder: null,
    codeStatusRaw: "dnr",
    primaryPayer: null,
    hospiceStatus: null,
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
    carePlanAnnualDeltaDays: null,
    polstMolstRawStatus: null,
    specialistConsultActiveCount: 0,
    assessmentsUpcomingJson: [],
    contacts: [
      { id: "c1", name: "Dana Wheeler", relationship: "Daughter", phone: "555-0100", isEmergencyContact: true, isHealthcareProxy: true, isPowerOfAttorney: false, sortOrder: 1, updatedAt: null },
    ],
    recentDailyNotes: [],
    recentAdl: [],
    recentBehavior: [],
    recentConditionChanges: [],
    activityDays: 30,
    activityTruncatedKinds: [],
    presenceHistory: [],
    form1823: null,
    openIncidentFollowups: [],
    ...overrides,
  };
}

describe("COL-599 resident face sheet", () => {
  beforeEach(() => {
    mocks.id = RESIDENT_ID;
    mocks.load.mockReset();
  });

  it("prints identity, code status, contacts and the facility, from the overview loader, unfiltered by scope", async () => {
    mocks.load.mockResolvedValue(detail());
    const { container } = render(<ResidentFaceSheetPage />);
    await waitFor(() => expect(screen.getByText("Marsha Wheeler")).toBeTruthy());
    expect(mocks.load).toHaveBeenCalledWith(RESIDENT_ID, null);
    expect(container.querySelector("article#resident-face-sheet")).toBeTruthy();
    expect(container.querySelector("nav")).toBeNull();
    expect(screen.getByText("Homewood Lodge")).toBeTruthy();
    expect(screen.getByText("March 3, 1947")).toBeTruthy();
    expect(screen.getByText("Verified: not recorded")).toBeTruthy();
    expect(screen.getAllByText(/Dana Wheeler/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Printed .* by Printer Example/)).toBeTruthy();
    expect(screen.getByText("Back to resident").getAttribute("href")).toBe(`/admin/residents/${RESIDENT_ID}`);
  });

  it("never prints unreviewed allergies as none", async () => {
    mocks.load.mockResolvedValue(detail());
    render(<ResidentFaceSheetPage />);
    await waitFor(() => expect(screen.getByText("Not reviewed — allergies unknown")).toBeTruthy());
    expect(screen.queryByText("No known drug allergies")).toBeNull();
  });

  it("says so when the resident is not readable", async () => {
    mocks.load.mockResolvedValue(null);
    render(<ResidentFaceSheetPage />);
    await waitFor(() => expect(screen.getByText(/could not be found/)).toBeTruthy());
  });
});
