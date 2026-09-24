import React from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dietary",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user", app_metadata: { app_role: "cook" } } } }) },
  }),
}));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ fullName: "Casey Cook" }) }));
vi.mock("@/components/caregiver/WorkingFacilitySelector", () => ({
  WorkingFacilitySelector: ({ onResolved }: { onResolved: (id: string) => void }) => {
    React.useEffect(() => onResolved("facility"), [onResolved]);
    return <span>Homewood Lodge</span>;
  },
}));

import { DietaryShell } from "./DietaryShell";

afterEach(() => cleanup());

it("gives the Cook app the shared header and its own short tab list (COL-714)", async () => {
  await act(async () => {
    render(<DietaryShell>Kitchen page</DietaryShell>);
  });
  expect(await screen.findByText("Kitchen page")).toBeInTheDocument();
  const header = screen.getByRole("banner");
  expect(header).toHaveTextContent("Homewood Lodge");
  expect(header).toHaveTextContent("Casey Cook");
  expect(within(header).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  expect(within(header).queryByRole("link", { name: "My employee file" })).toBeNull();

  const tabs = screen.getByRole("navigation", { name: "Kitchen navigation" });
  expect([...tabs.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
    ["Kitchen", "/dietary"],
    ["Reading", "/dietary/acknowledgments"],
    ["Me", "/employee-file"],
  ]);
  expect(within(tabs).getByRole("link", { name: "Kitchen" })).toHaveAttribute("aria-current", "page");
});
