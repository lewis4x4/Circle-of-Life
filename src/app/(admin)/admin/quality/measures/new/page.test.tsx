import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminQualityMeasureNewPage from "./page";

const ORG_ID = "00000000-0000-4000-8000-00000000org1";

const authMock = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  organizationId: null as string | null,
  loading: false,
}));
const insertMock = vi.hoisted(() => vi.fn());
const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/quality/measures/new",
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => authMock }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      insert: (row: unknown) => {
        insertMock(row);
        return { select: () => ({ single: async () => ({ data: { id: "m-1" }, error: null }) }) };
      },
    }),
  }),
}));

beforeEach(() => {
  insertMock.mockReset();
  pushMock.mockReset();
  authMock.organizationId = ORG_ID;
  authMock.loading = false;
});

describe("Define measure (COL-651)", () => {
  it("is not gated on a facility: the org-wide catalog saves under the profile's organization", async () => {
    const user = userEvent.setup();
    render(<AdminQualityMeasureNewPage />);

    expect(screen.queryByTestId("facility-gate")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Measure key"), "falls_injury_rate");
    await user.type(screen.getByLabelText("Name"), "Falls with injury");
    await user.click(screen.getByRole("button", { name: "Save measure" }));

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: ORG_ID, measure_key: "falls_injury_rate", name: "Falls with injury" }),
    );
    expect(pushMock).toHaveBeenCalledWith("/admin/quality");
  });

  it("says why it cannot save when the profile has no organization, instead of showing a dead form", () => {
    authMock.organizationId = null;
    render(<AdminQualityMeasureNewPage />);

    expect(screen.getByText(/has no organization/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save measure" })).not.toBeInTheDocument();
  });
});
