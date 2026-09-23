import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appRole: "housekeeper",
  ownStaff: [{ id: "staff-me", first_name: "Pat", last_name: "Doe" }] as unknown[],
  swaps: [] as unknown[],
  orFilters: [] as string[],
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ user: { id: "user-1" }, appRole: mocks.appRole }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: vi.fn(async () => ({ error: null })),
    from: (table: string) => {
      let byUser = false;
      const query: Record<string, unknown> = {};
      for (const name of ["select", "is", "order", "limit", "in"]) query[name] = vi.fn(() => query);
      query.eq = vi.fn((col: string) => {
        if (col === "user_id") byUser = true;
        return query;
      });
      query.or = vi.fn((filter: string) => {
        mocks.orFilters.push(filter);
        return query;
      });
      query.then = (resolve: (v: unknown) => void) =>
        resolve(
          table === "staff"
            ? { data: byUser ? mocks.ownStaff : [], error: null }
            : { data: mocks.swaps, error: null },
        );
      return query;
    },
  }),
}));

import { MyShiftSwaps } from "./MyShiftSwaps";

const SWAP = {
  id: "swap-1",
  status: "pending",
  swap_type: "cover",
  reason: null,
  created_at: "2026-09-20T14:00:00Z",
  requesting_staff_id: "staff-me",
  covering_staff_id: "staff-other",
  requesting_confirmed_at: null,
  covering_confirmed_at: null,
};

beforeEach(() => {
  mocks.appRole = "housekeeper";
  mocks.ownStaff = [{ id: "staff-me", first_name: "Pat", last_name: "Doe" }];
  mocks.swaps = [SWAP];
  mocks.orFilters.length = 0;
});

describe("floor app shift swaps (COL-661 A2)", () => {
  it("asks only for swaps the signed-in person requests or covers, with no export or approval", async () => {
    render(<MyShiftSwaps />);
    expect(await screen.findByText(/You →/)).toBeInTheDocument();
    expect(mocks.orFilters).toEqual(["requesting_staff_id.in.(staff-me),covering_staff_id.in.(staff-me)"]);
    expect(screen.getByRole("button", { name: /Confirm my participation/ })).toBeInTheDocument();
    expect(screen.queryByText(/Download CSV/i)).toBeNull();
    expect(screen.queryByText(/Oversight queue/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Approve/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /approval queue/i })).toBeNull();
  });

  it("links roles allowed to approve to the oversight queue instead of embedding it", async () => {
    mocks.appRole = "med_tech";
    render(<MyShiftSwaps />);
    expect(await screen.findByRole("link", { name: /Open the approval queue/ })).toHaveAttribute("href", "/admin/shift-swaps");
  });

  it("tells an account with no staff record that it is not linked, without querying swaps", async () => {
    mocks.ownStaff = [];
    render(<MyShiftSwaps />);
    expect(await screen.findByText(/not linked to a staff record yet/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.orFilters).toEqual([]));
  });

  it("no longer re-exports the admin oversight page on the floor route", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/(caregiver)/caregiver/shift-swaps/page.tsx"), "utf8");
    expect(page).not.toContain("(admin)/admin/shift-swaps");
    expect(page).toContain("MyShiftSwaps");
  });
});
