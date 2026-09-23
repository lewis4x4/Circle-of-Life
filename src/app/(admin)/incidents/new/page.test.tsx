import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: null }),
}));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ user: { id: "user-1" }, organizationId: "org-1", loading: false }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: mocks.from }),
  isBrowserSupabaseConfigured: () => true,
}));
vi.mock("@/components/common/FacilityGate", () => ({
  FacilityGate: ({ title }: { title: string }) => <div data-testid="facility-gate">{title}</div>,
}));

const { default: AdminIncidentNewPage } = await import("./page");

describe("/admin/incidents/new under All facilities (COL-651)", () => {
  it("shows the shared facility gate instead of a fillable form, and never guesses a facility", () => {
    render(<AdminIncidentNewPage />);

    expect(screen.getByTestId("facility-gate")).toHaveTextContent("Report incident");
    expect(screen.queryByRole("button", { name: /submit/i })).not.toBeInTheDocument();
    // The old page quietly filed under the organization's first facility.
    expect(mocks.from).not.toHaveBeenCalledWith("facilities");
  });
});
