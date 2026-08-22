import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ExecutiveEntityIndexPage, {
  EXECUTIVE_ENTITY_EMPTY_LIST_MESSAGE,
  EXECUTIVE_ENTITY_LOADING_MESSAGE,
} from "@/app/(admin)/admin/executive/entity/page";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
}));

const supabaseMock = vi.hoisted(() => ({
  loadError: null as string | null,
  entities: [] as { id: string; name: string; status: string | null }[],
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    organizationId: authMock.organizationId,
    loading: authMock.loading,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            order: async () => {
              if (supabaseMock.loadError) {
                return { data: null, error: { message: supabaseMock.loadError } };
              }
              return { data: supabaseMock.entities, error: null };
            },
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/app/(admin)/executive/executive-hub-nav", () => ({
  ExecutiveHubNav: () => <div data-testid="executive-hub-nav" />,
}));

describe("ExecutiveEntityIndexPage auth hydration", () => {
  beforeEach(() => {
    authMock.loading = false;
    authMock.organizationId = null;
    supabaseMock.loadError = null;
    supabaseMock.entities = [];
  });

  it("shows named loading copy while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<ExecutiveEntityIndexPage />);

    expect(screen.getByRole("status")).toHaveTextContent(EXECUTIVE_ENTITY_LOADING_MESSAGE);
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<ExecutiveEntityIndexPage />);

    expect(screen.getByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText(EXECUTIVE_ENTITY_LOADING_MESSAGE)).not.toBeInTheDocument();
  });

  it("surfaces real fetch failures after auth resolves", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    supabaseMock.loadError = "Could not load entities.";

    render(<ExecutiveEntityIndexPage />);

    expect(await screen.findByText("Could not load entities.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("shows named empty list copy when the org has no entities", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    supabaseMock.entities = [];

    render(<ExecutiveEntityIndexPage />);

    expect(await screen.findByText(EXECUTIVE_ENTITY_EMPTY_LIST_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/for this organization/i)).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("renders entity cards when org context is present", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    supabaseMock.entities = [{ id: "ent-anon-1", name: "Anon Entity LLC", status: "active" }];

    render(<ExecutiveEntityIndexPage />);

    expect(await screen.findByText("Anon Entity LLC")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View portfolio →" })).toHaveAttribute(
      "href",
      "/admin/executive/entity/ent-anon-1",
    );
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });
});
