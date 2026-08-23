import fs from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import NewResidentTransportRequestPage from "@/app/(admin)/transportation/requests/new/page";
import {
  TRANSPORT_REQUEST_NEW_LOADING_PROFILE_COPY,
  TRANSPORT_REQUEST_NEW_LOADING_RESIDENTS_COPY,
  TRANSPORT_REQUEST_NEW_NO_RESIDENTS_AT_FACILITY_COPY,
  TRANSPORT_REQUEST_NEW_WAITING_PROFILE_SUBMIT_COPY,
} from "@/lib/transport/transport-request-new-display-copy";

const pageSource = fs.readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");

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
      if (table === "resident_transport_requests") {
        return {
          insert: (payload: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                supabaseMock.insertPayload = payload;
                if (supabaseMock.insertError) {
                  return { data: null, error: { message: supabaseMock.insertError } };
                }
                return { data: { id: "00000000-0000-4000-8000-00000000req1" }, error: null };
              },
            }),
          }),
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

describe("NewResidentTransportRequestPage auth hydration", () => {
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

  it("never throws the legacy organization crash string in page source", () => {
    expect(pageSource).not.toContain("Organization missing on profile.");
    expect(pageSource).toContain("Appointment date (ET)");
  });

  it("shows named loading copy while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<NewResidentTransportRequestPage />);

    expect(screen.getByRole("status")).toHaveTextContent(TRANSPORT_REQUEST_NEW_LOADING_PROFILE_COPY);
    expect(screen.getByRole("button", { name: TRANSPORT_REQUEST_NEW_WAITING_PROFILE_SUBMIT_COPY })).toBeDisabled();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<NewResidentTransportRequestPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create request" })).toBeDisabled();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("names the empty resident list when the facility has none", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    supabaseMock.residents = [];

    render(<NewResidentTransportRequestPage />);

    await waitFor(() => {
      expect(screen.getByText(TRANSPORT_REQUEST_NEW_NO_RESIDENTS_AT_FACILITY_COPY)).toBeInTheDocument();
    });
    expect(screen.queryByText(TRANSPORT_REQUEST_NEW_LOADING_RESIDENTS_COPY)).not.toBeInTheDocument();
  });

  it("does not insert while auth is still hydrating", async () => {
    authMock.loading = true;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    authMock.user = { id: "00000000-0000-4000-8000-00000000usr1" };
    supabaseMock.residents = [{ id: "00000000-0000-4000-8000-00000000res1", first_name: "A", last_name: "B" }];

    render(<NewResidentTransportRequestPage />);

    fireEvent.click(screen.getByRole("button", { name: TRANSPORT_REQUEST_NEW_WAITING_PROFILE_SUBMIT_COPY }));

    await waitFor(() => {
      expect(supabaseMock.insertPayload).toBeNull();
    });
  });
});
