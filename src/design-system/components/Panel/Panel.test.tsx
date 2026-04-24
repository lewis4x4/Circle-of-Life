import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Panel } from "./Panel";

describe("<Panel />", () => {
  it("renders title and children", () => {
    render(
      <Panel title="Priority alerts">
        <p>body</p>
      </Panel>,
    );
    expect(screen.getByRole("region", { name: /priority alerts/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /priority alerts/i })).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("renders subtitle when provided", () => {
    render(<Panel title="Quality" subtitle="Portfolio rollup" />);
    expect(screen.getByText("Portfolio rollup")).toBeInTheDocument();
  });

  it("renders info tooltip toggle", async () => {
    const user = userEvent.setup();
    render(<Panel title="Occupancy" info="Census ÷ licensed beds" />);
    const btn = screen.getByRole("button", { name: /info for occupancy/i });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Census");
  });

  it("renders actionCta as a link when href is provided", () => {
    render(
      <Panel
        title="Alerts"
        actionCta={{ label: "Open queue", href: "/admin/alerts" }}
      >
        <p>rows</p>
      </Panel>,
    );
    const link = screen.getByRole("link", { name: /open queue/i });
    expect(link).toHaveAttribute("href", "/admin/alerts");
  });

  it("renders actionCta as a button that calls onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Panel
        title="Alerts"
        actionCta={{ label: "Customize", onClick }}
      >
        <p>rows</p>
      </Panel>,
    );
    await user.click(screen.getByRole("button", { name: /customize/i }));
    expect(onClick).toHaveBeenCalled();
  });

  it("renders loading state with aria-live status", () => {
    render(<Panel title="Queue" loading />);
    expect(screen.getByRole("region", { name: /queue/i })).toHaveAttribute("data-loading", "true");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders error state with alert role and danger styling", () => {
    render(<Panel title="Queue" error="Could not load" />);
    expect(screen.getByRole("region", { name: /queue/i })).toHaveAttribute("data-error", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load");
  });
});
