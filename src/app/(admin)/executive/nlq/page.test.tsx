import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ExecutiveNlqPage from "@/app/(admin)/executive/nlq/page";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
  appRole: "owner" as const,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    organizationId: authMock.organizationId,
    appRole: authMock.appRole,
    loading: authMock.loading,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            neq: () => ({
              is: () => ({
                order: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/app/(admin)/executive/executive-hub-nav", () => ({
  ExecutiveHubNav: () => <div data-testid="executive-hub-nav" />,
}));

vi.mock("@/components/haven-insight/ConversationSidebar", () => ({
  ConversationSidebar: () => <div data-testid="conversation-sidebar" />,
}));

vi.mock("@/components/common/HavenErrorBoundary", () => ({
  HavenErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("ExecutiveNlqPage auth hydration", () => {
  beforeEach(() => {
    authMock.loading = true;
    authMock.organizationId = null;
    authMock.appRole = "owner";
  });

  it("shows named loading copy while auth is hydrating", () => {
    render(<ExecutiveNlqPage />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading Haven Insight…");
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<ExecutiveNlqPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading Haven Insight…")).not.toBeInTheDocument();
  });

  it("keeps the owner/admin gate after auth resolves", () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    authMock.appRole = "facility_admin";

    render(<ExecutiveNlqPage />);

    expect(
      screen.getByText("Haven Insight is available to organization owners and org admins."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Ask Haven about your portfolio.")).not.toBeInTheDocument();
  });

  it("shows the empty-state helper when the owner can use Insight", () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    authMock.appRole = "owner";

    render(<ExecutiveNlqPage />);

    expect(screen.getByText("Ask Haven about your portfolio.")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Ask a facility or portfolio question — answers come from your live operational data; Haven does not invent census or counts\./,
      ),
    ).toBeInTheDocument();
  });
});
