import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "./page";
import { workspaceFixture } from "@/components/insurance/test-support/fixtures";
const auth = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
  appRole: "owner",
  user: { id: "user-1" },
}));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => auth }));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: (select: (s: { selectedFacilityId: null }) => unknown) =>
    select({ selectedFacilityId: null }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/insurance",
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
describe("Insurance workspace scope and recovery", () => {
  beforeEach(() => {
    auth.loading = true;
    auth.organizationId = null;
    auth.appRole = "owner";
    vi.stubGlobal("fetch", vi.fn());
  });
  it("waits for profile before requesting data or offering management actions", () => {
    render(<Page />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading insurance profile",
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("link", { name: "Upload insurance document" }),
    ).not.toBeInTheDocument();
  });
  it("shows the quiet missing organization state after hydration", () => {
    auth.loading = false;
    render(<Page />);
    expect(
      screen.getByText("No organization on this profile"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("recovers a failed request without showing a reassuring zero", async () => {
    auth.loading = false;
    auth.organizationId = "org";
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Workspace unavailable" }), {
          status: 503,
        }),
      )
      .mockResolvedValueOnce(Response.json(workspaceFixture()));
    render(<Page />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Workspace unavailable",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Retry loading insurance" }),
    );
    expect(await screen.findByText("Not established")).toBeInTheDocument();
    expect(
      screen.getByText(/Client retained costs: Unknown/),
    ).toBeInTheDocument();
  });
  it("discards a late owner response after role revocation", async () => {
    auth.loading = false;
    auth.organizationId = "org";
    let finish: (r: Response) => void = () => {};
    vi.mocked(fetch)
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(
        Response.json({ ...workspaceFixture(), can_manage: false }),
      );
    const view = render(<Page />);
    auth.appRole = "facility_admin";
    view.rerender(<Page />);
    await screen.findByText("Managed by insurance reviewers");
    finish(Response.json(workspaceFixture()));
    await waitFor(() =>
      expect(
        screen.queryByText("Premiums and retained costs"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("link", { name: "Upload insurance document" }),
    ).not.toBeInTheDocument();
  });
});
