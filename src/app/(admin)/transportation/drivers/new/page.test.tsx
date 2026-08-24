import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminTransportationDriverNewPage from "@/app/(admin)/transportation/drivers/new/page";
import {
  DRIVER_NEW_LICENSE_EXPIRES_LABEL,
  DRIVER_NEW_LOADING_PROFILE_COPY,
  DRIVER_NEW_LOADING_STAFF_COPY,
  DRIVER_NEW_NO_STAFF_AT_FACILITY_COPY,
  DRIVER_NEW_WAITING_PROFILE_SUBMIT_COPY,
} from "@/lib/transportation/driver-new-display-copy";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
  user: null as { id: string } | null,
}));

const facilityMock = vi.hoisted(() => ({
  selectedFacilityId: "00000000-0000-4000-8000-00000000fac1" as string | null,
}));

const supabaseMock = vi.hoisted(() => ({
  staffError: null as string | null,
  staff: [] as { id: string; first_name: string; last_name: string }[],
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
      if (table === "staff") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                order: () => ({
                  limit: async () => {
                    if (supabaseMock.staffError) {
                      return { data: null, error: { message: supabaseMock.staffError } };
                    }
                    return { data: supabaseMock.staff, error: null };
                  },
                }),
              }),
            }),
          }),
        };
      }
      if (table === "driver_credentials") {
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

describe("AdminTransportationDriverNewPage auth hydration", () => {
  beforeEach(() => {
    authMock.loading = false;
    authMock.organizationId = null;
    authMock.user = null;
    facilityMock.selectedFacilityId = "00000000-0000-4000-8000-00000000fac1";
    supabaseMock.staffError = null;
    supabaseMock.staff = [];
    supabaseMock.insertError = null;
    supabaseMock.insertPayload = null;
    routerPushMock.mockReset();
  });

  it("shows named loading copy while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<AdminTransportationDriverNewPage />);

    expect(screen.getByRole("status")).toHaveTextContent(DRIVER_NEW_LOADING_PROFILE_COPY);
    expect(screen.getByRole("button", { name: DRIVER_NEW_WAITING_PROFILE_SUBMIT_COPY })).toBeDisabled();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", async () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<AdminTransportationDriverNewPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save credential" })).toBeDisabled();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("labels the license expiry field with Eastern (ET)", () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";

    render(<AdminTransportationDriverNewPage />);

    expect(screen.getByLabelText(DRIVER_NEW_LICENSE_EXPIRES_LABEL)).toBeInTheDocument();
  });

  it("surfaces real staff fetch failures after auth resolves", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    supabaseMock.staffError = "permission denied for table staff";

    render(<AdminTransportationDriverNewPage />);

    expect(await screen.findByText("permission denied for table staff")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("names the empty staff list when the facility has none", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    supabaseMock.staff = [];

    render(<AdminTransportationDriverNewPage />);

    await waitFor(() => {
      expect(screen.getByText(DRIVER_NEW_NO_STAFF_AT_FACILITY_COPY)).toBeInTheDocument();
    });
    expect(screen.queryByText(DRIVER_NEW_LOADING_STAFF_COPY)).not.toBeInTheDocument();
  });

  it("inserts a credential when org, facility, and staff are present", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    authMock.user = { id: "00000000-0000-4000-8000-00000000usr1" };
    supabaseMock.staff = [{ id: "00000000-0000-4000-8000-00000000stf1", first_name: "A", last_name: "B" }];

    render(<AdminTransportationDriverNewPage />);

    await waitFor(() => {
      expect(screen.getByLabelText("Staff")).toBeEnabled();
    });

    fireEvent.change(screen.getByLabelText("Staff"), {
      target: { value: "00000000-0000-4000-8000-00000000stf1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save credential" }));

    await waitFor(() => {
      expect(supabaseMock.insertPayload).toMatchObject({
        organization_id: "00000000-0000-4000-8000-00000000org1",
        facility_id: "00000000-0000-4000-8000-00000000fac1",
        staff_id: "00000000-0000-4000-8000-00000000stf1",
        status: "active",
        created_by: "00000000-0000-4000-8000-00000000usr1",
      });
    });
    expect(routerPushMock).toHaveBeenCalledWith("/admin/transportation");
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });
});
