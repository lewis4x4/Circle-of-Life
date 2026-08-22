import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminDietaryNewPage from "@/app/(admin)/admin/dietary/new/page";
import {
  DIETARY_NEW_LOADING_PROFILE_COPY,
  DIETARY_NEW_LOADING_RESIDENTS_COPY,
  DIETARY_NEW_NO_RESIDENTS_AT_FACILITY_COPY,
  DIETARY_NEW_WAITING_PROFILE_SUBMIT_COPY,
} from "@/lib/dietary/dietary-new-display-copy";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
  user: null as { id: string } | null,
}));

const facilityMock = vi.hoisted(() => ({
  selectedFacilityId: "00000000-0000-4000-8000-00000000fac1" as string | null,
}));

const supabaseMock = vi.hoisted(() => ({
  residentsError: null as string | null,
  residents: [] as { id: string; first_name: string; last_name: string }[],
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
      if (table === "residents") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                order: () => ({
                  limit: async () => {
                    if (supabaseMock.residentsError) {
                      return { data: null, error: { message: supabaseMock.residentsError } };
                    }
                    return { data: supabaseMock.residents, error: null };
                  },
                }),
              }),
            }),
          }),
        };
      }
      if (table === "diet_orders") {
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
        select: () => ({
          eq: () => ({
            is: () => ({
              order: () => ({
                limit: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        }),
      };
    },
  }),
}));

describe("AdminDietaryNewPage auth hydration", () => {
  beforeEach(() => {
    authMock.loading = false;
    authMock.organizationId = null;
    authMock.user = null;
    facilityMock.selectedFacilityId = "00000000-0000-4000-8000-00000000fac1";
    supabaseMock.residentsError = null;
    supabaseMock.residents = [];
    supabaseMock.insertError = null;
    supabaseMock.insertPayload = null;
    routerPushMock.mockReset();
  });

  it("shows named loading copy while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<AdminDietaryNewPage />);

    expect(screen.getByRole("status")).toHaveTextContent(DIETARY_NEW_LOADING_PROFILE_COPY);
    expect(screen.getByRole("button", { name: DIETARY_NEW_WAITING_PROFILE_SUBMIT_COPY })).toBeDisabled();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", async () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<AdminDietaryNewPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("surfaces real resident fetch failures after auth resolves", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    supabaseMock.residentsError = "permission denied for table residents";

    render(<AdminDietaryNewPage />);

    expect(await screen.findByText("permission denied for table residents")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("names the empty resident list when the facility has none", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    supabaseMock.residents = [];

    render(<AdminDietaryNewPage />);

    await waitFor(() => {
      expect(screen.getByText(DIETARY_NEW_NO_RESIDENTS_AT_FACILITY_COPY)).toBeInTheDocument();
    });
    expect(screen.queryByText(DIETARY_NEW_LOADING_RESIDENTS_COPY)).not.toBeInTheDocument();
  });

  it("inserts a draft when org, facility, and resident are present", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    authMock.user = { id: "00000000-0000-4000-8000-00000000usr1" };
    supabaseMock.residents = [{ id: "00000000-0000-4000-8000-00000000res1", first_name: "A", last_name: "B" }];

    render(<AdminDietaryNewPage />);

    await waitFor(() => {
      expect(screen.getByLabelText("Resident")).toBeEnabled();
    });

    fireEvent.change(screen.getByLabelText("Resident"), {
      target: { value: "00000000-0000-4000-8000-00000000res1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(supabaseMock.insertPayload).toMatchObject({
        organization_id: "00000000-0000-4000-8000-00000000org1",
        facility_id: "00000000-0000-4000-8000-00000000fac1",
        resident_id: "00000000-0000-4000-8000-00000000res1",
        status: "draft",
        created_by: "00000000-0000-4000-8000-00000000usr1",
      });
    });
    expect(routerPushMock).toHaveBeenCalledWith("/admin/dietary");
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });
});
