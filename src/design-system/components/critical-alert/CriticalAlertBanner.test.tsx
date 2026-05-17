import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CriticalAlertBanner } from "./CriticalAlertBanner";

describe("<CriticalAlertBanner />", () => {
  // ── Required props + role contract ─────────────────────────────────────────

  it("renders title as an h2 heading by default", () => {
    render(<CriticalAlertBanner title="Unable to load this page" />);
    expect(
      screen.getByRole("heading", {
        name: "Unable to load this page",
        level: 2,
      }),
    ).toBeInTheDocument();
  });

  it("renders title as h1 when headingLevel=1 (global error use)", () => {
    render(
      <CriticalAlertBanner title="Something went wrong" headingLevel={1} />,
    );
    expect(
      screen.getByRole("heading", {
        name: "Something went wrong",
        level: 1,
      }),
    ).toBeInTheDocument();
  });

  it("renders title as h3 when headingLevel=3 (nested-section use)", () => {
    render(
      <CriticalAlertBanner title="Nested callout" headingLevel={3} />,
    );
    expect(
      screen.getByRole("heading", {
        name: "Nested callout",
        level: 3,
      }),
    ).toBeInTheDocument();
  });

  it("default severity (critical) sets role=alert with assertive live region", () => {
    render(<CriticalAlertBanner title="Critical" />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveAttribute("aria-live", "assertive");
  });

  it("info severity sets role=status with polite live region", () => {
    render(<CriticalAlertBanner title="Heads up" severity="info" />);
    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  // ── Optional slots ─────────────────────────────────────────────────────────

  it("renders description when supplied", () => {
    render(
      <CriticalAlertBanner
        title="Unable to load this page"
        description="Try refreshing or contact support if the issue persists."
      />,
    );
    expect(
      screen.getByText(/try refreshing or contact support/i),
    ).toBeInTheDocument();
  });

  it("does not render description element when omitted", () => {
    render(<CriticalAlertBanner title="Test" />);
    expect(screen.queryByText(/try refreshing/i)).not.toBeInTheDocument();
  });

  it("renders reference identifier when supplied", () => {
    render(
      <CriticalAlertBanner title="Test" reference="abc123def456" />,
    );
    expect(screen.getByText(/abc123def456/)).toBeInTheDocument();
    expect(screen.getByText(/reference:/i)).toBeInTheDocument();
  });

  it("does not render reference paragraph when omitted", () => {
    render(<CriticalAlertBanner title="Test" />);
    expect(screen.queryByText(/reference:/i)).not.toBeInTheDocument();
  });

  it("renders icon slot with aria-hidden so it is not announced", () => {
    render(
      <CriticalAlertBanner
        title="Test"
        icon={<svg data-testid="warn-icon" />}
      />,
    );
    const icon = screen.getByTestId("warn-icon");
    expect(icon.parentElement).toHaveAttribute("aria-hidden", "true");
  });

  it("renders actions slot when supplied", () => {
    render(
      <CriticalAlertBanner
        title="Test"
        actions={<button type="button">Retry</button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: /retry/i }),
    ).toBeInTheDocument();
  });

  it("renders multiple action children in the actions slot", () => {
    render(
      <CriticalAlertBanner
        title="Test"
        actions={
          <>
            <button type="button">Retry</button>
            <button type="button">Dashboard</button>
          </>
        }
      />,
    );
    expect(
      screen.getByRole("button", { name: /retry/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /dashboard/i }),
    ).toBeInTheDocument();
  });

  // ── className forwarding ──────────────────────────────────────────────────

  it("forwards className to the outer container", () => {
    const { container } = render(
      <CriticalAlertBanner title="Test" className="custom-banner-class" />,
    );
    expect(container.firstChild).toHaveClass("custom-banner-class");
  });

  // ── Quiet Operator visual contract ────────────────────────────────────────

  it("critical severity applies destructive soft tint (10/30 policy)", () => {
    const { container } = render(<CriticalAlertBanner title="Test" />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("border-destructive/30");
    expect(root.className).toContain("bg-destructive/10");
  });

  it("info severity applies info soft tint (10/30 policy)", () => {
    const { container } = render(
      <CriticalAlertBanner title="Test" severity="info" />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("border-info/30");
    expect(root.className).toContain("bg-info/10");
  });

  it("title is in DOM order before description", () => {
    render(
      <CriticalAlertBanner
        title="Critical"
        description="Body copy"
      />,
    );
    const heading = screen.getByRole("heading", { level: 2 });
    const body = screen.getByText("Body copy");
    expect(
      heading.compareDocumentPosition(body) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
