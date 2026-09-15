import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import type { CarePlanPrintPacket } from "@/lib/care-plans/care-plan-print-packet";
import { CARE_PLAN_PRINT_DRAFT_BANNER, CARE_PLAN_PRINT_NO_ITEMS_COPY, CARE_PLAN_PRINT_UNSIGNED_COPY } from "@/lib/care-plans/care-plan-print-copy";

const RESIDENT_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";

const navigation = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: RESIDENT_ID }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import ResidentCarePlanPrintPage from "./page";

function packet(overrides: Partial<CarePlanPrintPacket> = {}): CarePlanPrintPacket {
  return {
    plan: { id: PLAN_ID, version: 2, status: "active", effectiveDate: "2026-09-10", reviewDueDate: "2027-09-10", notes: null, supersededByVersion: null },
    resident: { id: RESIDENT_ID, name: "Test Resident", dateOfBirth: "1940-01-02", room: "10-B" },
    facility: { name: "Homewood Lodge", addressLines: ["430 Mills St", "Mayo, FL 32066"], phone: null, licenseNumber: null },
    sections: [
      {
        category: "bathing",
        label: "Bathing",
        items: [{ id: "i1", title: "Shower", description: "Assist with shower", assistanceLevel: "limited_assist", frequency: "3x weekly", goal: null, interventions: ["Gather supplies first"], specialInstructions: null }],
      },
    ],
    signature: { approvedAt: "2026-09-12T14:00:00.000Z", approverName: "Nurse Example", signatureData: "data:image/png;base64,AAAA" },
    printedAt: "2026-09-15T21:00:00.000Z",
    printedBy: "Printer Example",
    ...overrides,
  };
}

const fetchMock = vi.fn();

describe("ResidentCarePlanPrintPage", () => {
  beforeEach(() => {
    navigation.search = `plan=${PLAN_ID}&auto=0`;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders the signed plan with its signature block and no banner", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => packet() });
    render(<ResidentCarePlanPrintPage />);

    await waitFor(() => expect(screen.getByText("Test Resident")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(`/api/care-plans/${PLAN_ID}/print`, { cache: "no-store" });
    expect(screen.getByText("Bathing")).toBeTruthy();
    expect(screen.getByText("Gather supplies first")).toBeTruthy();
    expect(screen.getByText("Limited Assist")).toBeTruthy();
    expect(screen.getByText("Nurse Example")).toBeTruthy();
    expect(screen.getByAltText("Approver signature")).toBeTruthy();
    expect(screen.queryByText(CARE_PLAN_PRINT_DRAFT_BANNER)).toBeNull();
    expect(screen.getByText(/Printed .* by Printer Example/)).toBeTruthy();
  });

  it("brands a draft as not in effect and says it is not signed", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => packet({ plan: { ...packet().plan, status: "draft" }, signature: null, sections: [] }),
    });
    render(<ResidentCarePlanPrintPage />);

    await waitFor(() => expect(screen.getByText(CARE_PLAN_PRINT_DRAFT_BANNER)).toBeTruthy());
    expect(screen.getByText(CARE_PLAN_PRINT_UNSIGNED_COPY)).toBeTruthy();
    expect(screen.getByText(CARE_PLAN_PRINT_NO_ITEMS_COPY)).toBeTruthy();
  });

  it("surfaces the route's refusal instead of a blank sheet", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "You do not have access to this care plan" }) });
    render(<ResidentCarePlanPrintPage />);

    await waitFor(() => expect(screen.getByText("You do not have access to this care plan")).toBeTruthy());
    expect(screen.getByText("Back to care plan").getAttribute("href")).toBe(`/admin/residents/${RESIDENT_ID}/care-plan`);
  });

  it("asks for a plan when opened without one and never calls the route", async () => {
    navigation.search = "";
    render(<ResidentCarePlanPrintPage />);

    await waitFor(() => expect(screen.getByText("Open this page from a care plan; no plan was named.")).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
