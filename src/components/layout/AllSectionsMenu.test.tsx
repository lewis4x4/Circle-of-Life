import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AllSectionsMenu } from "./AllSectionsMenu";
import { PILLARS } from "@/lib/navigation/pillars";

describe("AllSectionsMenu", () => {
  // Regression guard for Base UI error #31: each pillar's DropdownMenuLabel (a
  // base-ui "group part") must sit inside its DropdownMenuGroup, or opening the
  // menu throws `useMenuGroupRootContext` at runtime — dev tolerates it, but the
  // production build crashed the AppShell top bar to the error boundary the
  // moment the "all sections" menu opened.
  it("opens the all-sections menu and renders every pillar label + item without crashing", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<AllSectionsMenu pillars={PILLARS} onNavigate={onNavigate} />);

    const trigger = screen.getByRole("button", { name: /open all sections menu/i });
    await user.click(trigger);

    // The menu contents render in a portal only after opening. Reaching the
    // first pillar label proves its GroupLabel rendered inside its Group (no
    // #31 throw); we then assert every pillar label + item is present.
    expect(await screen.findByText(PILLARS[0].label)).toBeInTheDocument();
    for (const pillar of PILLARS) {
      expect(screen.getByText(pillar.label)).toBeInTheDocument();
      for (const item of pillar.items) {
        expect(screen.getByText(item.label)).toBeInTheDocument();
      }
    }
  });

  it("navigates to an item's href when the item is selected", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<AllSectionsMenu pillars={PILLARS} onNavigate={onNavigate} />);

    await user.click(screen.getByRole("button", { name: /open all sections menu/i }));

    const firstItem = PILLARS[0].items[0];
    await user.click(await screen.findByRole("menuitem", { name: firstItem.label }));
    expect(onNavigate).toHaveBeenCalledWith(firstItem.href);
  });
});
