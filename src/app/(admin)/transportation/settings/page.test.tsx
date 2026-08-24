import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TransportationOrgSettingsPage from "@/app/(admin)/transportation/settings/page";
import {
  TRANSPORT_SETTINGS_LOADING_PROFILE_COPY,
  TRANSPORT_SETTINGS_ORG_WIDE_SCOPE_CUE,
} from "@/lib/transport/transport-settings-display-copy";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
  user: null as { id: string } | null,
  appRole: "owner",
}));

const supabaseMock = vi.hoisted(() => ({
  queryError: null as string | null,
  row: null as { mileage_reimbursement_rate_cents: number; updated_at: string } | null,
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    user: authMock.user,
    organizationId: authMock.organizationId,
    appRole: authMock.appRole,
    loading: authMock.loading,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table !== "organization_transport_settings") {
        throw new Error(`unexpected table ${table}`);
      }
      const terminal = async () => {
        if (supabaseMock.queryError) {
          return { data: null, error: { message: supabaseMock.queryError } };
        }
        return { data: supabaseMock.row, error: null };
      };
      const builder = {
        eq: () => builder,
        maybeSingle: terminal,
        update: () => ({
          eq: async () => ({ error: null }),
        }),
        insert: async () => ({ error: null }),
      };
      return {
        select: () => builder,
        update: builder.update,
        insert: builder.insert,
      };
    },
  }),
}));

describe("TransportationOrgSettingsPage auth hydration", () => {
  beforeEach(() => {
    authMock.loading = false;
    authMock.organizationId = null;
    authMock.user = { id: "user-1" };
    authMock.appRole = "owner";
    supabaseMock.queryError = null;
    supabaseMock.row = null;
  });

  it("shows named loading copy while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<TransportationOrgSettingsPage />);

    expect(screen.getByRole("status")).toHaveTextContent(TRANSPORT_SETTINGS_LOADING_PROFILE_COPY);
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<TransportationOrgSettingsPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("surfaces real fetch failures after auth resolves", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    supabaseMock.queryError = "permission denied for table organization_transport_settings";

    render(<TransportationOrgSettingsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "permission denied for table organization_transport_settings",
    );
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("names the organization-wide scope on the page", () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";

    render(<TransportationOrgSettingsPage />);

    expect(screen.getByText(TRANSPORT_SETTINGS_ORG_WIDE_SCOPE_CUE)).toBeInTheDocument();
  });

  it("loads settings when organization context is available", async () => {
    authMock.loading = false;
    authMock.organizationId = "00000000-0000-4000-8000-00000000org1";
    supabaseMock.row = {
      mileage_reimbursement_rate_cents: 70,
      updated_at: "2026-08-24T16:00:00.000Z",
    };

    render(<TransportationOrgSettingsPage />);

    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveValue("0.70");
    });
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });
});
