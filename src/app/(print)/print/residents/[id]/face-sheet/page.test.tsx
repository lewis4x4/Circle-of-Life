import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { ResidentOverviewDetail } from "@/lib/residents/resident-detail-overview-load";

const RESIDENT_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({ load: vi.fn(), record: vi.fn(), id: "", search: "auto=0", calls: [] as string[] }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: mocks.id }),
  useSearchParams: () => new URLSearchParams(mocks.search),
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
vi.mock("@/lib/residents/resident-face-sheet-print", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/residents/resident-face-sheet-print")>()),
  recordResidentFaceSheetPrint: mocks.record,
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
    recentSafetyChecks: [],
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
    mocks.search = "auto=0";
    mocks.calls = [];
    mocks.load.mockReset();
    mocks.record.mockReset();
    mocks.load.mockImplementation(async () => {
      mocks.calls.push("load");
      return detail();
    });
    mocks.record.mockImplementation(async () => {
      mocks.calls.push("record");
      return "audit-1";
    });
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

describe("COL-627 face-sheet print audit", () => {
  beforeEach(() => {
    mocks.id = RESIDENT_ID;
    mocks.search = "auto=0";
    mocks.calls = [];
    mocks.load.mockReset();
    mocks.record.mockReset();
    mocks.load.mockImplementation(async () => {
      mocks.calls.push("load");
      return detail();
    });
    mocks.record.mockImplementation(async () => {
      mocks.calls.push("record");
      return "audit-1";
    });
  });

  it("logs the print before it reads or renders the record, with the print dialog closed (?auto=0)", async () => {
    render(<ResidentFaceSheetPage />);
    await waitFor(() => expect(screen.getByText("Marsha Wheeler")).toBeTruthy());
    expect(mocks.record).toHaveBeenCalledWith(RESIDENT_ID);
    expect(mocks.calls.slice(0, 2)).toEqual(["record", "load"]);
  });

  it("renders no PHI and never loads the record when the print cannot be logged", async () => {
    mocks.record.mockRejectedValue(new Error("network down"));
    const { container } = render(<ResidentFaceSheetPage />);
    await waitFor(() => expect(screen.getByText(/could not be logged, so it was not shown/)).toBeTruthy());
    expect(mocks.load).not.toHaveBeenCalled();
    expect(container.querySelector("article#resident-face-sheet")).toBeNull();
    expect(screen.queryByText("Marsha Wheeler")).toBeNull();
  });

  it("treats a refused print as a resident outside the caller's access", async () => {
    mocks.record.mockRejectedValue(Object.assign(new Error("Resident unavailable"), { code: "42501" }));
    render(<ResidentFaceSheetPage />);
    await waitFor(() => expect(screen.getByText(/outside your facility access/)).toBeTruthy());
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("logs again before the Print button opens the dialog, and does not open it if logging fails", async () => {
    const original = window.print;
    const print = vi.fn();
    Object.defineProperty(window, "print", { value: print, configurable: true, writable: true });
    render(<ResidentFaceSheetPage />);
    await waitFor(() => expect(screen.getByText("Marsha Wheeler")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(mocks.record).toHaveBeenCalledTimes(2);

    mocks.record.mockRejectedValueOnce(new Error("network down"));
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/could not be logged/));
    expect(print).toHaveBeenCalledTimes(1);
    Object.defineProperty(window, "print", { value: original, configurable: true, writable: true });
  });
});

describe("COL-794 face sheet prints on paper", () => {
  beforeEach(() => {
    mocks.id = RESIDENT_ID;
    mocks.search = "auto=0";
    mocks.load.mockReset().mockResolvedValue(detail());
    mocks.record.mockReset().mockResolvedValue("audit-1");
  });

  it("paginates for Letter: sections, headings, the photo and the footer stay whole", async () => {
    const { container } = render(<ResidentFaceSheetPage />);
    await waitFor(() => expect(screen.getByText("Marsha Wheeler")).toBeTruthy());
    const css = Array.from(container.querySelectorAll("style")).map((node) => node.textContent ?? "").join("\n");

    expect(css).toContain("@page { size: Letter; margin: 0.5in; }");
    // The 768px screen column would overflow a 7.5in page and clip or shrink.
    expect(css).toMatch(/#resident-face-sheet\s*\{[^}]*max-width:\s*none/);
    expect(css).toMatch(/print-color-adjust:\s*exact/);
    for (const selector of ["header", "section", "footer", "img"]) {
      expect(css).toMatch(new RegExp(`#resident-face-sheet ${selector}[^{]*\\{[^}]*break-inside: avoid`));
    }
    // A heading must not be stranded at the foot of a page.
    expect(css).toMatch(/#resident-face-sheet h2,?[^{]*\{[^}]*break-after: avoid/);
    // Long diagnosis lists and email addresses wrap instead of running off the sheet.
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("holds the print dialog until the resident photo has decoded", async () => {
    mocks.search = "auto=1";
    const original = window.print;
    const print = vi.fn();
    Object.defineProperty(window, "print", { value: print, configurable: true, writable: true });
    let decodePhoto = () => {};
    const decode = vi.fn(() => new Promise<void>((resolve) => { decodePhoto = resolve; }));
    Object.defineProperty(window.HTMLImageElement.prototype, "decode", { value: decode, configurable: true, writable: true });

    mocks.load.mockResolvedValue(detail({ photoUrl: "https://example.test/demo-resident.jpg" }));
    try {
      render(<ResidentFaceSheetPage />);
      await waitFor(() => expect(decode).toHaveBeenCalled());
      expect(print).not.toHaveBeenCalled();
      decodePhoto();
      await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(window, "print", { value: original, configurable: true, writable: true });
      // @ts-expect-error -- restore the environment's own (absent) decode
      delete window.HTMLImageElement.prototype.decode;
    }
  });

  it("prints anyway when the photo never loads", async () => {
    mocks.search = "auto=1";
    const original = window.print;
    const print = vi.fn();
    Object.defineProperty(window, "print", { value: print, configurable: true, writable: true });
    const decode = vi.fn(() => Promise.reject(new Error("404")));
    Object.defineProperty(window.HTMLImageElement.prototype, "decode", { value: decode, configurable: true, writable: true });

    mocks.load.mockResolvedValue(detail({ photoUrl: "https://example.test/missing.jpg" }));
    try {
      render(<ResidentFaceSheetPage />);
      await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(window, "print", { value: original, configurable: true, writable: true });
      // @ts-expect-error -- restore the environment's own (absent) decode
      delete window.HTMLImageElement.prototype.decode;
    }
  });
});
