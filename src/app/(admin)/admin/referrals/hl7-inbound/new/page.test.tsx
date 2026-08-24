import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminReferralsHl7InboundNewPage from "@/app/(admin)/admin/referrals/hl7-inbound/new/page";
import {
  HL7_INBOUND_NEW_LOADING_PROFILE_COPY,
  HL7_INBOUND_NEW_WAITING_PROFILE_SUBMIT_COPY,
} from "@/lib/referrals/hl7-inbound-new-display-copy";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
  user: null as { id: string } | null,
}));

const facilityMock = vi.hoisted(() => ({
  selectedFacilityId: "00000000-0000-4000-8000-00000000fac1" as string | null,
}));

const supabaseMock = vi.hoisted(() => ({
  insertError: null as string | null,
  insertPayload: null as Record<string, unknown> | null,
}));

const routerPushMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    user: authMock.user,
    organizationId: authMock.organizationId,
    loading: authMock.loading,
  }),
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({
    selectedFacilityId: facilityMock.selectedFacilityId,
  }),
}));

vi.mock("../../referrals-hub-nav", () => ({
  ReferralsHubNav: () => <nav data-testid="referrals-hub-nav" />,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "referral_hl7_inbound") {
        return {
          insert: (payload: Record<string, unknown>) => {
            supabaseMock.insertPayload = payload;
            return Promise.resolve({
              error: supabaseMock.insertError ? { message: supabaseMock.insertError } : null,
            });
          },
        };
      }
      return { insert: async () => ({ error: null }) };
    },
  }),
}));

describe("AdminReferralsHl7InboundNewPage auth hydration", () => {
  beforeEach(() => {
    authMock.loading = false;
    authMock.organizationId = null;
    authMock.user = null;
    facilityMock.selectedFacilityId = "00000000-0000-4000-8000-00000000fac1";
    supabaseMock.insertError = null;
    supabaseMock.insertPayload = null;
    routerPushMock.mockReset();
  });

  it("shows named loading copy and blocks submit while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<AdminReferralsHl7InboundNewPage />);

    expect(screen.getByRole("status")).toHaveTextContent(HL7_INBOUND_NEW_LOADING_PROFILE_COPY);
    expect(
      screen.getByRole("button", { name: HL7_INBOUND_NEW_WAITING_PROFILE_SUBMIT_COPY }),
    ).toBeDisabled();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^referral data$/i)).toBeDisabled();
  });

  it("shows the named quiet org gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<AdminReferralsHl7InboundNewPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to Inbox" })).toBeDisabled();
    expect(screen.getByLabelText(/^referral data$/i)).toBeDisabled();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("Sign in required.")).not.toBeInTheDocument();
  });

  it("disables the form when auth resolved without a signed-in user", () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    authMock.user = null;

    render(<AdminReferralsHl7InboundNewPage />);

    expect(screen.getByLabelText(/^referral data$/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add to Inbox" })).toBeDisabled();
    expect(screen.queryByText("Sign in required.")).not.toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("inserts a pending row when org, facility, user, and payload are present", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    authMock.user = { id: "00000000-0000-4000-8000-00000000usr1" };

    render(<AdminReferralsHl7InboundNewPage />);

    fireEvent.change(screen.getByLabelText(/^referral data$/i), {
      target: { value: "sample inbound referral payload" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to Inbox" }));

    await waitFor(() => {
      expect(supabaseMock.insertPayload).toMatchObject({
        organization_id: "00000000-0000-4000-8000-00000000org1",
        facility_id: "00000000-0000-4000-8000-00000000fac1",
        raw_message: "sample inbound referral payload",
        status: "pending",
        created_by: "00000000-0000-4000-8000-00000000usr1",
      });
    });
    expect(routerPushMock).toHaveBeenCalledWith("/admin/referrals/hl7-inbound");
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("surfaces real insert failures without the legacy org crash string", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    authMock.user = { id: "00000000-0000-4000-8000-00000000usr1" };
    supabaseMock.insertError = "permission denied for table referral_hl7_inbound";

    render(<AdminReferralsHl7InboundNewPage />);

    fireEvent.change(screen.getByLabelText(/^referral data$/i), {
      target: { value: "sample inbound referral payload" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to Inbox" }));

    expect(
      await screen.findByText("permission denied for table referral_hl7_inbound"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });
});
