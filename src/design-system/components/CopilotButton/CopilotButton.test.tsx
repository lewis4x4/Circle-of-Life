import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CopilotButton } from "./CopilotButton";

const VALID = {
  id: "s1",
  title: "Sample",
  body: "body",
  recordId: "r",
  recordType: "t",
  facilityId: "f",
  generatedAt: "2026-04-24T15:58:00-04:00",
  modelVersion: "v1",
  citations: [{ source: "x", id: "1", excerpt: "e" }],
};

describe("<CopilotButton />", () => {
  it("renders the button with cite-backed chip and closed drawer", () => {
    render(<CopilotButton suggestions={[VALID]} />);
    const btn = screen.getByRole("button", { name: /copilot/i });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(btn).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("toggles drawer open on click", async () => {
    const user = userEvent.setup();
    render(<CopilotButton suggestions={[VALID]} />);
    const btn = screen.getByRole("button", { name: /copilot/i });
    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: /copilot/i })).toBeInTheDocument();
  });

  it("closes the drawer via the close button", async () => {
    const user = userEvent.setup();
    render(<CopilotButton suggestions={[VALID]} />);
    await user.click(screen.getByRole("button", { name: /^copilot/i }));
    await user.click(screen.getByRole("button", { name: /close copilot drawer/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
