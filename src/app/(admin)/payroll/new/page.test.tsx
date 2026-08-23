import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminPayrollNewBatchPage from "@/app/(admin)/payroll/new/page";
import {
  PAYROLL_NEW_LOADING_PROFILE_COPY,
  PAYROLL_NEW_WAITING_PROFILE_SUBMIT_COPY,
} from "@/lib/payroll/payroll-new-display-copy";

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
      if (table === "payroll_export_batches") {
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

describe("AdminPayrollNewBatchPage auth hydration", () => {
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

    render(<AdminPayrollNewBatchPage />);

    expect(screen.getByRole("status")).toHaveTextContent(PAYROLL_NEW_LOADING_PROFILE_COPY);
    expect(screen.getByRole("button", { name: PAYROLL_NEW_WAITING_PROFILE_SUBMIT_COPY })).toBeDisabled();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet org gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<AdminPayrollNewBatchPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create draft" })).toBeDisabled();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("labels period date controls with Eastern time", () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";

    render(<AdminPayrollNewBatchPage />);

    expect(screen.getByLabelText(/^period start \(eastern time\)$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^period end \(eastern time\)$/i)).toBeInTheDocument();
  });

  it("inserts a draft when org, facility, user, and period are present", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    authMock.user = { id: "00000000-0000-4000-8000-00000000usr1" };

    render(<AdminPayrollNewBatchPage />);

    fireEvent.change(screen.getByLabelText(/^period start \(eastern time\)$/i), {
      target: { value: "2026-08-01" },
    });
    fireEvent.change(screen.getByLabelText(/^period end \(eastern time\)$/i), {
      target: { value: "2026-08-15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));

    await waitFor(() => {
      expect(supabaseMock.insertPayload).toMatchObject({
        organization_id: "00000000-0000-4000-8000-00000000org1",
        facility_id: "00000000-0000-4000-8000-00000000fac1",
        period_start: "2026-08-01",
        period_end: "2026-08-15",
        status: "draft",
        created_by: "00000000-0000-4000-8000-00000000usr1",
      });
    });
    expect(routerPushMock).toHaveBeenCalledWith("/admin/payroll");
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("surfaces real insert failures without the legacy org crash string", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    authMock.user = { id: "00000000-0000-4000-8000-00000000usr1" };
    supabaseMock.insertError = "permission denied for table payroll_export_batches";

    render(<AdminPayrollNewBatchPage />);

    fireEvent.change(screen.getByLabelText(/^period start \(eastern time\)$/i), {
      target: { value: "2026-08-01" },
    });
    fireEvent.change(screen.getByLabelText(/^period end \(eastern time\)$/i), {
      target: { value: "2026-08-15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByText("permission denied for table payroll_export_batches")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });
});
