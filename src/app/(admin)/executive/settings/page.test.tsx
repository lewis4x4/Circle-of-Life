import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ExecutiveSettingsPage, { EXECUTIVE_SETTINGS_LOADING_MESSAGE } from "@/app/(admin)/executive/settings/page";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
  user: null as { id: string } | null,
}));

const supabaseMock = vi.hoisted(() => ({
  loadError: null as string | null,
  loadData: null as { id: string; default_date_range: string; widgets: unknown[] } | null,
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    user: authMock.user,
    organizationId: authMock.organizationId,
    loading: authMock.loading,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: (columns: string) => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: async () => {
                if (columns.includes("default_date_range") && supabaseMock.loadError) {
                  return { data: null, error: { message: supabaseMock.loadError } };
                }
                return {
                  data: supabaseMock.loadData ?? { id: "cfg-anon-1" },
                  error: null,
                };
              },
            }),
          }),
        }),
      }),
      update: () => ({
        eq: async () => ({ error: null }),
      }),
      insert: async () => ({ error: null }),
    }),
  }),
}));

vi.mock("@/app/(admin)/executive/executive-hub-nav", () => ({
  ExecutiveHubNav: () => <div data-testid="executive-hub-nav" />,
}));

describe("ExecutiveSettingsPage auth hydration", () => {
  beforeEach(() => {
    authMock.loading = false;
    authMock.organizationId = null;
    authMock.user = null;
    supabaseMock.loadError = null;
    supabaseMock.loadData = null;
  });

  it("shows named loading copy while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<ExecutiveSettingsPage />);

    expect(screen.getByRole("status")).toHaveTextContent(EXECUTIVE_SETTINGS_LOADING_MESSAGE);
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("exec_dashboard_configs")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<ExecutiveSettingsPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText(EXECUTIVE_SETTINGS_LOADING_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Date range preset")).not.toBeInTheDocument();
  });

  it("surfaces real fetch failures after auth resolves", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    authMock.user = { id: "user-anon-1" };
    supabaseMock.loadError = "Could not load executive settings.";

    render(<ExecutiveSettingsPage />);

    expect(await screen.findByText("Could not load executive settings.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("shows operator subtitle and settings form for an owner with org (no org-missing leak)", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    authMock.user = { id: "user-anon-1" };
    supabaseMock.loadData = {
      id: "cfg-anon-1",
      default_date_range: "last_30",
      widgets: [],
    };

    render(<ExecutiveSettingsPage />);

    expect(await screen.findByLabelText("Date range preset")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(
      screen.getByText("Personal dashboard date-range defaults — your preset when executive KPI views load."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Per-user dashboard defaults stored in/i)).not.toBeInTheDocument();
    expect(screen.queryByText("exec_dashboard_configs")).not.toBeInTheDocument();
    expect(screen.queryByText(/later slice/i)).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("clears stale save banners when auth resolves without an organization", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    authMock.user = { id: "user-anon-1" };
    supabaseMock.loadData = {
      id: "cfg-anon-1",
      default_date_range: "mtd",
      widgets: [],
    };

    const { rerender } = render(<ExecutiveSettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();

    authMock.organizationId = null;
    rerender(<ExecutiveSettingsPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  });

  it("clears the fetch error banner after a successful save", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    authMock.user = { id: "user-anon-1" };
    supabaseMock.loadError = "Could not load executive settings.";
    supabaseMock.loadData = null;

    render(<ExecutiveSettingsPage />);
    expect(await screen.findByText("Could not load executive settings.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(screen.queryByText("Could not load executive settings.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});
