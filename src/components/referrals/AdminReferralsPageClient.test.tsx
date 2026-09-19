import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminReferralsPageClient } from "./AdminReferralsPageClient";
import { emptyReferralsHubBootstrap } from "@/lib/referrals/referrals-hub-bootstrap";

const mocks = vi.hoisted(() => ({
  useFacilityStoreMock: vi.fn(),
  createClientMock: vi.fn(),
  loadBootstrapMock: vi.fn(),
  usePathnameMock: vi.fn(),
  useRouterMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathnameMock,
  useRouter: mocks.useRouterMock,
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: mocks.useFacilityStoreMock,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mocks.createClientMock,
}));

vi.mock("@/lib/referrals/referrals-hub-bootstrap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/referrals/referrals-hub-bootstrap")>()),
  loadReferralsHubBootstrap: mocks.loadBootstrapMock,
}));

const baseFacilityId = "11111111-1111-1111-1111-111111111111";

const loadedProps = {
  initialBootstrap: emptyReferralsHubBootstrap(),
  initialLoadError: null,
  initialFacilityId: baseFacilityId,
  serverBootstrapped: true,
};

describe("<AdminReferralsPageClient />", () => {
  beforeEach(() => {
    mocks.usePathnameMock.mockReturnValue("/admin/referrals");
    mocks.useRouterMock.mockReturnValue({ push: vi.fn(), replace: vi.fn() });
    mocks.useFacilityStoreMock.mockReturnValue({
      selectedFacilityId: baseFacilityId,
      availableFacilities: [{ id: baseFacilityId, name: "Demo ALF" }],
    });
    mocks.createClientMock.mockReturnValue({
      from: vi.fn(),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    });
    mocks.loadBootstrapMock.mockReset().mockResolvedValue(emptyReferralsHubBootstrap());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults outreach Scheduled for to Eastern wall clock with ET label", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T20:06:00.000Z"));

    render(<AdminReferralsPageClient {...loadedProps} />);

    const scheduledInput = screen.getByLabelText(/^scheduled date and time \(et\)$/i);
    expect(scheduledInput).toHaveValue("2026-08-20T16:06");
    expect(scheduledInput).not.toHaveValue("2026-08-20T20:06");
    expect(new Date("2026-08-20T20:06:00.000Z").toISOString().slice(0, 16)).toBe("2026-08-20T20:06");
  });

  it("persists outreach scheduled_for from Eastern datetime-local without a 4-hour shift", async () => {
    const user = userEvent.setup();
    const insertMock = vi.fn().mockReturnValue({ error: null });
    const fromMock = vi.fn((table: string) => {
      if (table === "facilities") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { organization_id: "org-1" },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "referral_outreach_activities") {
        return { insert: insertMock };
      }
      throw new Error(`unexpected table ${table}`);
    });

    mocks.createClientMock.mockReturnValue({
      from: fromMock,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    });

    render(<AdminReferralsPageClient {...loadedProps} />);

    await user.clear(screen.getByLabelText(/^scheduled date and time \(et\)$/i));
    await user.type(screen.getByLabelText(/^scheduled date and time \(et\)$/i), "2026-08-20T16:06");
    await user.click(screen.getByRole("button", { name: /save activity/i }));

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduled_for: "2026-08-20T20:06:00.000Z",
      }),
    );
  });

  it("withholds KPI claims when the authorized roster is truncated", () => {
    render(
      <AdminReferralsPageClient
        {...loadedProps}
        initialBootstrap={{
          ...emptyReferralsHubBootstrap(),
          leadListTruncated: true,
        }}
      />,
    );

    expect(screen.getByText(/pipeline roster is limited to the 200 most recently updated leads/i)).toBeInTheDocument();
    expect(screen.getAllByText("Requires complete reporting")).toHaveLength(5);
  });

  it("names the facility gap instead of claiming a facility when none is selected", () => {
    mocks.useFacilityStoreMock.mockReturnValue({
      selectedFacilityId: null,
      availableFacilities: [{ id: baseFacilityId, name: "Demo ALF" }],
    });

    render(
      <AdminReferralsPageClient
        {...loadedProps}
        initialFacilityId={null}
        serverBootstrapped={false}
      />,
    );

    expect(screen.queryByText(/the selected facility/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/select a facility in the header to load referral leads and kpis for that site/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/inquiries and pipeline before admission — attribution, follow-up, and conversion\.$/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Demo ALF")).not.toBeInTheDocument();
  });

  it("does not claim a facility when the selected id cannot be queried", () => {
    mocks.useFacilityStoreMock.mockReturnValue({
      selectedFacilityId: "not-a-uuid",
      availableFacilities: [{ id: baseFacilityId, name: "Demo ALF" }],
    });

    render(
      <AdminReferralsPageClient
        {...loadedProps}
        initialFacilityId={"not-a-uuid"}
        serverBootstrapped={false}
      />,
    );

    expect(screen.queryByText(/the selected facility/i)).not.toBeInTheDocument();
    expect(screen.queryByText("not-a-uuid")).not.toBeInTheDocument();
    expect(
      screen.getByText(/select a facility in the header to load referral leads and kpis for that site/i),
    ).toBeInTheDocument();
  });

  it("names the selected facility in the hub subheading once one is selected", () => {
    render(<AdminReferralsPageClient {...loadedProps} />);

    expect(screen.getByText("Demo ALF")).toBeInTheDocument();
    expect(screen.queryByText(/the selected facility/i)).not.toBeInTheDocument();
  });
});
