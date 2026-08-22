import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AuditLogExportPage from "@/app/(admin)/admin/compliance/audit-export/page";
import {
  AUDIT_EXPORT_LOADING_PROFILE_COPY,
  AUDIT_EXPORT_NO_JOBS_COPY,
  AUDIT_EXPORT_OPEN_DATE_RANGE_COPY,
  AUDIT_EXPORT_WAITING_PROFILE_SUBMIT_COPY,
} from "@/lib/compliance/audit-export-display-copy";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
  user: null as { id: string } | null,
  appRole: "owner" as string,
}));

const facilityMock = vi.hoisted(() => ({
  selectedFacilityId: null as string | null,
}));

const supabaseMock = vi.hoisted(() => ({
  jobs: [] as {
    id: string;
    status: string;
    format: string;
    date_from: string | null;
    date_to: string | null;
    facility_id: string | null;
    row_count: number | null;
    created_at: string;
    error_message: string | null;
  }[],
  jobsError: null as string | null,
  insertError: null as string | null,
  sessionToken: "anon-session-token" as string | null,
}));

const exportMock = vi.hoisted(() => ({
  ok: true,
  message: "",
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    user: authMock.user,
    organizationId: authMock.organizationId,
    appRole: authMock.appRole,
    loading: authMock.loading,
  }),
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({
    selectedFacilityId: facilityMock.selectedFacilityId,
  }),
}));

vi.mock("@/lib/audit-export", () => ({
  invokeExportAuditLog: vi.fn(async () => {
    if (!exportMock.ok) {
      return { ok: false as const, message: exportMock.message };
    }
    return {
      ok: true as const,
      blob: new Blob(["id,action\n1,insert\n"], { type: "text/csv" }),
      filename: "audit-anon.csv",
    };
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: {
          session: supabaseMock.sessionToken
            ? { access_token: supabaseMock.sessionToken }
            : null,
        },
      }),
    },
    from: (table: string) => {
      if (table !== "audit_log_export_jobs") {
        throw new Error(`unexpected table ${table}`);
      }
      const terminal = async () => {
        if (supabaseMock.jobsError) {
          return { data: null, error: { message: supabaseMock.jobsError } };
        }
        return { data: supabaseMock.jobs, error: null };
      };
      const builder = {
        order: () => builder,
        limit: () => builder,
        select: () => builder,
        insert: () => ({
          select: () => ({
            single: async () => {
              if (supabaseMock.insertError) {
                return { data: null, error: { message: supabaseMock.insertError } };
              }
              return { data: { id: "00000000-0000-4000-8000-00000000job1" }, error: null };
            },
          }),
        }),
        then: (
          onFulfilled: (value: Awaited<ReturnType<typeof terminal>>) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => terminal().then(onFulfilled, onRejected),
      };
      return builder;
    },
  }),
}));

describe("AuditLogExportPage auth hydration", () => {
  beforeEach(() => {
    authMock.loading = false;
    authMock.organizationId = null;
    authMock.user = null;
    authMock.appRole = "owner";
    facilityMock.selectedFacilityId = null;
    supabaseMock.jobs = [];
    supabaseMock.jobsError = null;
    supabaseMock.insertError = null;
    supabaseMock.sessionToken = "anon-session-token";
    exportMock.ok = true;
    exportMock.message = "";
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:anon"),
      revokeObjectURL: vi.fn(),
    });
  });

  it("does not show the legacy org crash banner while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<AuditLogExportPage />);

    expect(screen.getByText(AUDIT_EXPORT_LOADING_PROFILE_COPY)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: AUDIT_EXPORT_WAITING_PROFILE_SUBMIT_COPY }),
    ).toBeDisabled();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", async () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<AuditLogExportPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download CSV" })).toBeDisabled();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(AUDIT_EXPORT_NO_JOBS_COPY)).toBeInTheDocument();
    });
  });

  it("surfaces real export failures after auth resolves", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    authMock.user = { id: "00000000-0000-4000-8000-00000000usr1" };
    supabaseMock.insertError = "permission denied for table audit_log_export_jobs";

    render(<AuditLogExportPage />);

    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("permission denied for table audit_log_export_jobs");
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("keeps role-cannot-export as its own message", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    authMock.user = { id: "00000000-0000-4000-8000-00000000usr1" };
    authMock.appRole = "caregiver";

    render(<AuditLogExportPage />);

    expect(
      screen.getByText("Only owner, org admin, or facility admin can export audit logs."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download CSV" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));

    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("names open date ranges in the jobs table", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    supabaseMock.jobs = [
      {
        id: "00000000-0000-4000-8000-00000000job1",
        status: "completed",
        format: "csv",
        date_from: null,
        date_to: null,
        facility_id: null,
        row_count: 0,
        created_at: "2026-08-01T12:00:00.000Z",
        error_message: null,
      },
    ];

    render(<AuditLogExportPage />);

    expect(await screen.findByText(AUDIT_EXPORT_OPEN_DATE_RANGE_COPY)).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });
});
