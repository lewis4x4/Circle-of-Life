import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RoleAppFrame } from "@/design-system/components/RoleAppFrame";

const pathnameMock = vi.hoisted(() => ({ value: "/caregiver/meds" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock.value,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: async () => ({ error: null }) } }),
}));

describe("RoleAppFrame", () => {
  it("shows building, person and sign-out in one header", () => {
    render(
      <RoleAppFrame app="med-tech" building={<h1>Homewood Lodge</h1>} person="Pat Doe">
        <p>page</p>
      </RoleAppFrame>,
    );
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("heading", { name: "Homewood Lodge" })).toBeTruthy();
    expect(within(header).getByText("Pat Doe")).toBeTruthy();
    expect(within(header).getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("renders the app's tabs in the phone bar and the rail, marking the active one", () => {
    pathnameMock.value = "/caregiver/meds";
    render(
      <RoleAppFrame app="med-tech" building="Homewood" person={null}>
        <p>page</p>
      </RoleAppFrame>,
    );
    for (const name of ["Med-Tech navigation", "Med-Tech navigation (tablet)"]) {
      const nav = screen.getByRole("navigation", { name });
      const links = within(nav).getAllByRole("link");
      expect(links.map((link) => link.textContent)).toEqual(["Meds", "Residents", "Rounds", "Clock", "Me"]);
      expect(within(nav).getByRole("link", { name: "Meds" }).getAttribute("aria-current")).toBe("page");
    }
  });

  it("can hide the tabs", () => {
    render(
      <RoleAppFrame app="family" building="Family" person={null} hideNav>
        <p>page</p>
      </RoleAppFrame>,
    );
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
