import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminReferralsPageClient } from "./AdminReferralsPageClient";
import type { NextActionView } from "@/lib/referrals/next-actions";
import { emptyReferralsHubBootstrap } from "@/lib/referrals/referrals-hub-bootstrap";

const mocks = vi.hoisted(() => ({
  useFacilityStoreMock: vi.fn(),
  createClientMock: vi.fn(),
  usePathnameMock: vi.fn(),
  useRouterMock: vi.fn(),
  loadBootstrapMock: vi.fn(),
  authUser: { id: "user-1" } as { id: string } | null,
  authLoading: false,
}));

vi.mock("@/lib/referrals/referrals-hub-bootstrap", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/referrals/referrals-hub-bootstrap")>(),
  loadReferralsHubBootstrap: mocks.loadBootstrapMock,
}));

vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ user: mocks.authUser, loading: mocks.authLoading, organizationId: "org-1", appRole: "nurse" }) }));

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

const baseFacilityId = "11111111-1111-1111-1111-111111111111";

const loadedProps = {
  initialBootstrap: { ...emptyReferralsHubBootstrap(), scope: { userId: "user-1", organizationId: "org-1", appRole: "nurse", facilityId: baseFacilityId } },
  initialLoadError: null,
  initialFacilityId: baseFacilityId,
  serverBootstrapped: true,
};

describe("<AdminReferralsPageClient />", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authUser = { id: "user-1" }; mocks.authLoading = false;
    mocks.loadBootstrapMock.mockResolvedValue(emptyReferralsHubBootstrap());
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
  });

  afterEach(() => {
    cleanup();
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
  const lead = (id: string, firstName = id) => ({ id, first_name: firstName, last_name: "Example", status: "new" as const, updated_at: "2026-09-08T12:00:00Z", created_at: "2026-09-08T12:00:00Z", converted_at: null, email: null, phone: null, external_reference: null, notes: null, tour_scheduled_for: null, referral_sources: null });

  it("filters accountable work and keeps accepted backup coverage separate from unavailable owner", async () => {
    const action = { id: "a", lead_id: "covered", due_at: null, owner_acknowledged: false, owner_eligible: false, backup_id: "backup", backup_accepted: true, backup_eligible: true } as NextActionView;
    const bootstrap = { ...loadedProps.initialBootstrap, rows: [lead("missing", "Missing"), lead("covered", "Covered")], nextActions: [action] };
    render(<AdminReferralsPageClient {...loadedProps} initialBootstrap={bootstrap} />);
    await userEvent.selectOptions(screen.getByLabelText("Next action", { exact: true }), "missing");
    expect(screen.getByRole("link", { name: /Missing Example/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Covered Example/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Next action", { exact: true }), "owner_unavailable");
    expect(screen.getByRole("link", { name: /Covered Example/ })).toHaveTextContent("Backup coverage accepted");
    expect(screen.queryByRole("link", { name: /Missing Example/ })).not.toBeInTheDocument();
  });

  it("exposes later referrals while keeping each rendered page bounded to sixty", async () => {
    const bootstrap = { ...loadedProps.initialBootstrap, rows: Array.from({ length: 65 }, (_, index) => lead(`lead-${index}`, `Person${index}`)) };
    render(<AdminReferralsPageClient {...loadedProps} initialBootstrap={bootstrap} />);
    expect(screen.getAllByRole("link", { name: /Person\d+ Example/ })).toHaveLength(60);
    await userEvent.click(screen.getByRole("button", { name: "Next referrals" }));
    expect(screen.getAllByRole("link", { name: /Person\d+ Example/ })).toHaveLength(5);
    expect(screen.getByRole("link", { name: /Person64 Example/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous referrals" }));
    expect(screen.getAllByRole("link", { name: /Person\d+ Example/ })).toHaveLength(60);
  });

  it("ignores an old facility response after the operator switches facility", async () => {
    let finishOld!: (value: ReturnType<typeof emptyReferralsHubBootstrap>) => void;
    const old = new Promise<ReturnType<typeof emptyReferralsHubBootstrap>>((resolve) => { finishOld = resolve; });
    mocks.loadBootstrapMock.mockReturnValueOnce(old).mockResolvedValueOnce({ ...emptyReferralsHubBootstrap(), rows: [lead("new", "CurrentFacility")] });
    const view = render(<AdminReferralsPageClient {...loadedProps} serverBootstrapped={false} />);
    await waitFor(() => expect(mocks.loadBootstrapMock).toHaveBeenCalledTimes(1));
    mocks.useFacilityStoreMock.mockReturnValue({ selectedFacilityId: "22222222-2222-2222-2222-222222222222", availableFacilities: [] });
    view.rerender(<AdminReferralsPageClient {...loadedProps} serverBootstrapped={false} />);
    await screen.findByRole("link", { name: /CurrentFacility Example/ });
    await act(async () => { finishOld({ ...emptyReferralsHubBootstrap(), rows: [lead("old", "OldFacility")] }); await old; });
    expect(screen.queryByRole("link", { name: /OldFacility Example/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /CurrentFacility Example/ })).toBeInTheDocument();
  });

  it("never renders cached private rows for a null actor or a different actor", async () => {
    const bootstrap = { ...loadedProps.initialBootstrap, rows: [lead("private", "PrivateSentinel")] };
    mocks.authUser = null;
    const view = render(<AdminReferralsPageClient {...loadedProps} initialBootstrap={bootstrap} />);
    expect(screen.queryByText(/PrivateSentinel/)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Sign in");
    mocks.authUser = { id: "different-user" };
    mocks.loadBootstrapMock.mockResolvedValue({ ...emptyReferralsHubBootstrap(), rows: [lead("current", "CurrentActor")] });
    view.rerender(<AdminReferralsPageClient {...loadedProps} initialBootstrap={bootstrap} />);
    expect(screen.queryByText(/PrivateSentinel/)).not.toBeInTheDocument();
    await screen.findByRole("link", { name: /CurrentActor Example/ });
  });

});
