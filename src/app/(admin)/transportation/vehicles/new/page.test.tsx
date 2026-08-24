import fs from "node:fs";
import path from "node:path";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminTransportationVehicleNewPage from "@/app/(admin)/transportation/vehicles/new/page";
import {
  VEHICLE_NEW_LOADING_PROFILE_COPY,
  VEHICLE_NEW_NO_ORGANIZATION_SUBMIT_COPY,
  VEHICLE_NEW_SIGN_IN_SUBMIT_COPY,
  VEHICLE_NEW_WAITING_PROFILE_SUBMIT_COPY,
} from "@/lib/transportation/vehicle-new-display-copy";

const pageSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "./page.tsx"),
  "utf8",
);

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
      if (table === "fleet_vehicles") {
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

describe("AdminTransportationVehicleNewPage auth hydration", () => {
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

    render(<AdminTransportationVehicleNewPage />);

    expect(screen.getByRole("status")).toHaveTextContent(VEHICLE_NEW_LOADING_PROFILE_COPY);
    expect(screen.getByRole("button", { name: VEHICLE_NEW_WAITING_PROFILE_SUBMIT_COPY })).toBeDisabled();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("Sign in required.")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.organizationId = null;
    authMock.user = { id: "00000000-0000-4000-8000-00000000usr1" };

    render(<AdminTransportationVehicleNewPage />);

    expect(screen.getAllByText("No organization on this profile").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: VEHICLE_NEW_NO_ORGANIZATION_SUBMIT_COPY })).toBeDisabled();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("names sign-in on the submit button when auth resolved without a user", () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    authMock.user = null;

    render(<AdminTransportationVehicleNewPage />);

    expect(screen.getByRole("button", { name: VEHICLE_NEW_SIGN_IN_SUBMIT_COPY })).toBeDisabled();
    expect(screen.queryByText("Sign in required.")).not.toBeInTheDocument();
  });

  it("surfaces real insert failures after auth resolves", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    authMock.user = { id: "00000000-0000-4000-8000-00000000usr1" };
    supabaseMock.insertError = "permission denied for table fleet_vehicles";

    render(<AdminTransportationVehicleNewPage />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Van 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save vehicle" }));

    expect(await screen.findByText("permission denied for table fleet_vehicles")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("inserts a fleet vehicle when org, facility, user, and name are present", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    authMock.user = { id: "00000000-0000-4000-8000-00000000usr1" };

    render(<AdminTransportationVehicleNewPage />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Van 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save vehicle" }));

    await waitFor(() => {
      expect(supabaseMock.insertPayload).toMatchObject({
        organization_id: "00000000-0000-4000-8000-00000000org1",
        facility_id: "00000000-0000-4000-8000-00000000fac1",
        name: "Van 1",
        created_by: "00000000-0000-4000-8000-00000000usr1",
      });
    });
    expect(routerPushMock).toHaveBeenCalledWith("/admin/transportation");
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("Sign in required.")).not.toBeInTheDocument();
  });

  it("labels compliance date fields as Eastern", () => {
    expect(pageSource).toContain("Insurance expires (ET)");
    expect(pageSource).toContain("Registration expires (ET)");
    expect(pageSource).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
    expect(pageSource).not.toContain("Organization missing on profile.");
    expect(pageSource).not.toContain("Sign in required.");
  });
});
