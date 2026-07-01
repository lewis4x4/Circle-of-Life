import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ResidentPresenceControl } from "./ResidentPresenceControl";

describe("ResidentPresenceControl", () => {
  // Regression guard for Base UI error #31: DropdownMenuLabel (a base-ui
  // "group part") must sit inside a DropdownMenuGroup, or opening the menu
  // throws at runtime (dev tolerates it; the production build crashed the page).
  it("opens the presence menu and renders all three options without crashing", async () => {
    const user = userEvent.setup();
    render(
      <ResidentPresenceControl
        residentId="00000000-0000-0000-0000-000000000001"
        status="active"
      />,
    );

    const trigger = screen.getByRole("button", { name: /update presence/i });
    await user.click(trigger);

    // These render only inside the opened menu — reaching them proves the
    // GroupLabel rendered inside its Group (no #31 throw).
    expect(await screen.findByText("Update presence")).toBeInTheDocument();
    expect(screen.getByText("Bed Hold — Hospital")).toBeInTheDocument();
    expect(screen.getByText("On leave / vacation")).toBeInTheDocument();
  });
});
