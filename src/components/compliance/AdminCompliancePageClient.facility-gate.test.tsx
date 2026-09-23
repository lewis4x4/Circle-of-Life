import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AdminCompliancePageClient } from "./AdminCompliancePageClient";

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: null }),
}));
const supabaseStub = vi.hoisted(() => {
  // Any query chain resolves empty; this test is about what renders without a facility.
  const chain: Record<string, unknown> = {};
  const handler: ProxyHandler<Record<string, unknown>> = {
    get: (_target, prop) =>
      prop === "then"
        ? (resolve: (value: unknown) => void) => resolve({ data: [], error: null, count: 0 })
        : () => proxy,
  };
  const proxy = new Proxy(chain, handler);
  return { from: () => proxy };
});
vi.mock("@/lib/supabase/client", () => ({ createClient: () => supabaseStub }));
vi.mock("@/lib/compliance-dashboard-snapshot", () => ({ fetchComplianceDashboardSnapshot: vi.fn() }));
vi.mock("@/lib/compliance-scan", () => ({
  getComplianceScore: vi.fn(),
  getEmergencyChecklistPreview: vi.fn(),
}));
vi.mock("@/lib/compliance-reminders", () => ({ getPendingReminders: vi.fn(), dismissReminder: vi.fn() }));
vi.mock("@/components/common/FacilityGate", () => ({
  FacilityGateNotice: ({ reason }: { reason: string }) => <section data-testid="facility-gate">{reason}</section>,
}));

const ROLLUP = {
  overdueAssessments: 3,
  overdueCarePlanReviews: 1,
  openIncidentFollowupsPastDue: 0,
  activeInfections: 0,
  activeOutbreaks: 0,
  expiringCertifications30d: 2,
  openDeficiencies: 4,
  surveyVisitActive: null,
};

describe("AdminCompliancePageClient under All facilities (COL-651)", () => {
  it("keeps the org-wide tile rollup, labels it, and gates only the per-building sections", () => {
    render(<AdminCompliancePageClient initialSnapshot={ROLLUP} initialSnapError={null} initialFacilityId={null} />);

    expect(screen.getByText(/Tile totals cover all your facilities/)).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByTestId("facility-gate")).toBeInTheDocument();
    expect(screen.queryByText(/select a facility/i)).not.toBeInTheDocument();
    expect(screen.queryByText("All Clear")).not.toBeInTheDocument();
  });
});
