import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageShell } from "./PageShell";

const audit = {
  auditHref: "/admin/audit",
  updatedAt: new Date("2026-04-24T12:00:00-04:00"),
  now: new Date("2026-04-24T12:05:00-04:00"),
};

describe("<PageShell />", () => {
  it("renders title, children, and audit footer by default", () => {
    render(
      <PageShell title="Triage Inbox" audit={audit}>
        <p>content</p>
      </PageShell>,
    );

    expect(screen.getByRole("heading", { name: "Triage Inbox", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo", { name: /audit/i })).toBeInTheDocument();
  });

  it("renders subtitle, scope, filters, and actions slots", () => {
    render(
      <PageShell
        title="Executive"
        subtitle="Owner overview"
        scope={<div data-testid="scope">scope</div>}
        filters={<div data-testid="filters">filters</div>}
        actions={<button type="button">Reset view</button>}
        audit={audit}
      >
        <p>main body</p>
      </PageShell>,
    );

    expect(screen.getByText("Owner overview")).toBeInTheDocument();
    expect(screen.getByTestId("scope")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /filters/i })).toBeInTheDocument();
    expect(screen.getByTestId("filters")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset view/i })).toBeInTheDocument();
  });

  it("renders the right rail when provided", () => {
    render(
      <PageShell
        title="Executive"
        rightRail={<div data-testid="rail">rail</div>}
        audit={audit}
      >
        <p>main</p>
      </PageShell>,
    );

    const aside = screen.getByRole("complementary", { name: /right rail/i });
    expect(aside).toBeInTheDocument();
    expect(screen.getByTestId("rail")).toBeInTheDocument();
  });

  it("omits the right rail region when rightRail prop is absent", () => {
    render(
      <PageShell title="Executive" audit={audit}>
        <p>main</p>
      </PageShell>,
    );

    expect(screen.queryByRole("complementary", { name: /right rail/i })).toBeNull();
  });

  it("omits the filters region when filters prop is absent", () => {
    render(
      <PageShell title="Executive" audit={audit}>
        <p>main</p>
      </PageShell>,
    );

    expect(screen.queryByRole("region", { name: /filters/i })).toBeNull();
  });
});
