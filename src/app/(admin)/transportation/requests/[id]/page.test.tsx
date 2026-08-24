import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import EditResidentTransportRequestPage from "@/app/(admin)/transportation/requests/[id]/page";
import {
  TRANSPORT_REQUEST_DETAIL_LOADING_PROFILE_COPY,
  TRANSPORT_REQUEST_DETAIL_LOADING_REQUEST_COPY,
  TRANSPORT_REQUEST_DETAIL_WAITING_PROFILE_SUBMIT_COPY,
} from "@/lib/transport/transport-request-detail-display-copy";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
  user: null as { id: string } | null,
}));

const facilityMock = vi.hoisted(() => ({
  selectedFacilityId: "00000000-0000-4000-8000-00000000fac1" as string | null,
}));

const supabaseMock = vi.hoisted(() => ({
  requestError: null as string | null,
  request: null as Record<string, unknown> | null,
  updateError: null as string | null,
  updatePayload: null as Record<string, unknown> | null,
}));

const routerRefreshMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "00000000-0000-4000-8000-00000000req1" }),
  useRouter: () => ({ refresh: routerRefreshMock }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
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

vi.mock("@/lib/transport/org-mileage-rate", () => ({
  getOrganizationMileageRateCents: async () => 67,
  formatCentsPerMileUsd: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}));

function chainable(result: { data: unknown; error: { message: string } | null }) {
  const proxy: Record<string, unknown> = {};
  const handler = () => proxy;
  proxy.select = handler;
  proxy.eq = handler;
  proxy.is = handler;
  proxy.order = handler;
  proxy.limit = handler;
  proxy.maybeSingle = async () => result;
  proxy.single = async () => result;
  return proxy;
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "resident_transport_requests") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  maybeSingle: async () => {
                    if (supabaseMock.requestError) {
                      return { data: null, error: { message: supabaseMock.requestError } };
                    }
                    return { data: supabaseMock.request, error: null };
                  },
                }),
              }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            supabaseMock.updatePayload = payload;
            return {
              eq: async () => ({
                error: supabaseMock.updateError ? { message: supabaseMock.updateError } : null,
              }),
            };
          },
        };
      }
      if (table === "facilities") {
        return chainable({ data: { name: "Pilot facility" }, error: null });
      }
      if (table === "staff" || table === "fleet_vehicles" || table === "driver_credentials") {
        return chainable({ data: [], error: null });
      }
      if (table === "mileage_logs") {
        return chainable({ data: null, error: null });
      }
      return chainable({ data: [], error: null });
    },
  }),
}));

const sampleRequest = {
  id: "00000000-0000-4000-8000-00000000req1",
  organization_id: "00000000-0000-4000-8000-00000000org1",
  facility_id: "00000000-0000-4000-8000-00000000fac1",
  resident_id: "00000000-0000-4000-8000-00000000res1",
  transport_type: "facility_vehicle",
  appointment_date: "2026-08-24",
  appointment_time: "10:00:00",
  destination_name: "Clinic",
  destination_address: "123 Main St",
  purpose: "Follow-up",
  wheelchair_required: false,
  escort_required: false,
  escort_staff_id: null,
  vehicle_id: null,
  driver_staff_id: null,
  pickup_time: null,
  return_time: null,
  status: "scheduled",
  cancellation_reason: null,
  notes: null,
  created_at: "2026-08-20T12:00:00.000Z",
  residents: { first_name: "A", last_name: "B" },
};

describe("EditResidentTransportRequestPage auth hydration", () => {
  beforeEach(() => {
    authMock.loading = false;
    authMock.organizationId = null;
    authMock.user = null;
    facilityMock.selectedFacilityId = "00000000-0000-4000-8000-00000000fac1";
    supabaseMock.requestError = null;
    supabaseMock.request = sampleRequest;
    supabaseMock.updateError = null;
    supabaseMock.updatePayload = null;
    routerRefreshMock.mockReset();
  });

  it("shows named profile loading while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<EditResidentTransportRequestPage />);

    expect(screen.getByRole("status")).toHaveTextContent(TRANSPORT_REQUEST_DETAIL_LOADING_PROFILE_COPY);
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("Sign in required.")).not.toBeInTheDocument();
  });

  it("shows named request loading after auth resolves", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    authMock.user = { id: "00000000-0000-4000-8000-00000000usr1" };
    supabaseMock.request = null;

    render(<EditResidentTransportRequestPage />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(TRANSPORT_REQUEST_DETAIL_LOADING_REQUEST_COPY);
    });
  });

  it("labels appointment date in Eastern time", async () => {
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    authMock.user = { id: "00000000-0000-4000-8000-00000000usr1" };

    render(<EditResidentTransportRequestPage />);

    expect(await screen.findByText("Appointment date (ET)")).toBeInTheDocument();
  });

  it("names the quiet org gap when auth resolved without an organization and no request loaded", async () => {
    authMock.organizationId = null;
    supabaseMock.request = null;

    render(<EditResidentTransportRequestPage />);

    expect(await screen.findByText("Request not found.")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("shows sign-in gap and disabled submit when auth resolved without a user", async () => {
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    authMock.user = null;

    render(<EditResidentTransportRequestPage />);

    expect(await screen.findByRole("button", { name: "Sign in to save" })).toBeDisabled();
    expect(screen.getAllByText("Sign in to save").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Sign in required.")).not.toBeInTheDocument();
  });

  it("names the wait on submit while auth hydrates on a loaded form", async () => {
    authMock.loading = true;
    authMock.organizationId = null;
    authMock.user = null;

    render(<EditResidentTransportRequestPage />);

    expect(screen.getByRole("status")).toHaveTextContent(TRANSPORT_REQUEST_DETAIL_LOADING_PROFILE_COPY);
    expect(screen.queryByRole("button", { name: TRANSPORT_REQUEST_DETAIL_WAITING_PROFILE_SUBMIT_COPY })).not.toBeInTheDocument();
  });

  it("surfaces real save failures after auth resolves", async () => {
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    authMock.user = { id: "00000000-0000-4000-8000-00000000usr1" };
    supabaseMock.updateError = "permission denied for table resident_transport_requests";

    render(<EditResidentTransportRequestPage />);

    await screen.findByRole("button", { name: "Save" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("permission denied for table resident_transport_requests"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("Sign in required.")).not.toBeInTheDocument();
  });

  it("saves when profile and request context are present", async () => {
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    authMock.user = { id: "00000000-0000-4000-8000-00000000usr1" };

    render(<EditResidentTransportRequestPage />);

    await screen.findByRole("button", { name: "Save" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(supabaseMock.updatePayload).toMatchObject({
        updated_by: "00000000-0000-4000-8000-00000000usr1",
      });
    });
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });
});
