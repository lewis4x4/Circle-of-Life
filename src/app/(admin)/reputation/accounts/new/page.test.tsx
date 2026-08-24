import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminReputationAccountNewPage from "@/app/(admin)/reputation/accounts/new/page";
import {
  REPUTATION_ACCOUNT_NEW_LOADING_PROFILE_COPY,
  REPUTATION_ACCOUNT_NEW_WAITING_PROFILE_SUBMIT_COPY,
} from "@/lib/reputation/reputation-account-new-display-copy";

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

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "reputation_accounts") {
        return {
          insert: (payload: Record<string, unknown>) => {
            supabaseMock.insertPayload = payload;
            return Promise.resolve({
              error: supabaseMock.insertError ? { message: supabaseMock.insertError } : null,
            });
          },
        };
      }
      return {
        insert: () => Promise.resolve({ error: null }),
      };
    },
  }),
}));

describe("AdminReputationAccountNewPage auth hydration", () => {
  beforeEach(() => {
    authMock.loading = false;
    authMock.organizationId = null;
    authMock.user = null;
    facilityMock.selectedFacilityId = "00000000-0000-4000-8000-00000000fac1";
    supabaseMock.insertError = null;
    supabaseMock.insertPayload = null;
    routerPushMock.mockReset();
  });

  it("shows named loading copy while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<AdminReputationAccountNewPage />);

    expect(screen.getByRole("status")).toHaveTextContent(REPUTATION_ACCOUNT_NEW_LOADING_PROFILE_COPY);
    expect(screen.getByRole("button", { name: REPUTATION_ACCOUNT_NEW_WAITING_PROFILE_SUBMIT_COPY })).toBeDisabled();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("Sign in required.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<AdminReputationAccountNewPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: REPUTATION_ACCOUNT_NEW_WAITING_PROFILE_SUBMIT_COPY })).toBeDisabled();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("Sign in required.")).not.toBeInTheDocument();
  });

  it("stamps organization scope on the form without date fields", () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";

    render(<AdminReputationAccountNewPage />);

    expect(screen.getByText(/Listing is scoped to your signed-in organization/)).toBeInTheDocument();
  });

  it("surfaces real insert failures after auth resolves", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    authMock.user = { id: "00000000-0000-4000-8000-00000000usr1" };
    supabaseMock.insertError = "permission denied for table reputation_accounts";

    render(<AdminReputationAccountNewPage />);

    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Main campus Google" } });
    fireEvent.click(screen.getByRole("button", { name: "Save listing" }));

    expect(await screen.findByText("permission denied for table reputation_accounts")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("Sign in required.")).not.toBeInTheDocument();
  });

  it("inserts a listing when org, user, facility, and label are present", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    authMock.user = { id: "00000000-0000-4000-8000-00000000usr1" };

    render(<AdminReputationAccountNewPage />);

    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Main campus Google" } });
    fireEvent.click(screen.getByRole("button", { name: "Save listing" }));

    await waitFor(() => {
      expect(supabaseMock.insertPayload).toMatchObject({
        organization_id: "00000000-0000-4000-8000-00000000org1",
        facility_id: "00000000-0000-4000-8000-00000000fac1",
        label: "Main campus Google",
        created_by: "00000000-0000-4000-8000-00000000usr1",
      });
    });
    expect(routerPushMock).toHaveBeenCalledWith("/admin/reputation");
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("Sign in required.")).not.toBeInTheDocument();
  });
});
