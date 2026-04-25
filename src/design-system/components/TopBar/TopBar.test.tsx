import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TopBar } from "./TopBar";

describe("<TopBar />", () => {
  it("renders title, subtitle, and scope slot", () => {
    render(
      <TopBar
        title="Triage Inbox"
        subtitle="All facilities · last 24 hours"
        scope={<span data-testid="scope">owner / group / facility</span>}
      />,
    );

    expect(screen.getByRole("banner", { name: /page top bar/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Triage Inbox" })).toBeInTheDocument();
    expect(screen.getByText("All facilities · last 24 hours")).toBeInTheDocument();
    expect(screen.getByTestId("scope")).toBeInTheDocument();
  });

  it("renders actions slot as a group", () => {
    render(
      <TopBar
        title="Executive"
        actions={
          <>
            <button type="button">Reset view</button>
            <button type="button">Save view</button>
          </>
        }
      />,
    );

    const group = screen.getByRole("group", { name: /page actions/i });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset view/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save view/i })).toBeInTheDocument();
  });

  it("shows notifications count when provided", () => {
    render(<TopBar title="Executive" notifications={{ count: 7 }} />);
    const bell = screen.getByRole("button", { name: /notifications, 7 unread/i });
    expect(bell).toBeInTheDocument();
    expect(screen.getByTestId("notifications-badge")).toHaveTextContent("7");
  });

  it("renders the Copilot button stub when copilot.visible is true and toggles aria-expanded", async () => {
    const user = userEvent.setup();
    render(<TopBar title="Executive" copilot={{ visible: true }} />);

    const copilot = screen.getByRole("button", { name: /copilot/i });
    expect(copilot).toHaveAttribute("aria-expanded", "false");
    await user.click(copilot);
    expect(copilot).toHaveAttribute("aria-expanded", "true");
  });

  it("hides the Copilot button when copilot is absent", () => {
    render(<TopBar title="Executive" />);
    expect(screen.queryByRole("button", { name: /copilot/i })).toBeNull();
  });
});
