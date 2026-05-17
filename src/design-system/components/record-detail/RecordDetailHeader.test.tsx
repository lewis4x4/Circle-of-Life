import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RecordDetailHeader } from "./RecordDetailHeader";

describe("<RecordDetailHeader />", () => {
  // ── Required props ──────────────────────────────────────────────────────────

  it("renders title as an h1 heading", () => {
    render(<RecordDetailHeader title="Mary Johnson" />);
    expect(
      screen.getByRole("heading", { name: "Mary Johnson", level: 1 }),
    ).toBeInTheDocument();
  });

  // ── Optional props ──────────────────────────────────────────────────────────

  it("renders subtitle when supplied", () => {
    render(
      <RecordDetailHeader title="Mary Johnson" subtitle="Room 207 · MRN 048213" />,
    );
    expect(screen.getByText("Room 207 · MRN 048213")).toBeInTheDocument();
  });

  it("does not render a subtitle element when subtitle is omitted", () => {
    render(<RecordDetailHeader title="Mary Johnson" />);
    // The subtitle <p> should not be present when prop is not supplied
    expect(screen.queryByText(/room/i)).not.toBeInTheDocument();
  });

  it("renders backLink as a keyboard-reachable anchor", () => {
    render(
      <RecordDetailHeader
        title="Mary Johnson"
        backLink={{ label: "All residents", href: "/admin/residents" }}
      />,
    );
    const link = screen.getByRole("link", { name: /all residents/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/admin/residents");
  });

  it("does not render a back link when backLink is omitted", () => {
    render(<RecordDetailHeader title="Mary Johnson" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders statusChips slot when supplied", () => {
    render(
      <RecordDetailHeader
        title="Incident #INC-2026-0421"
        statusChips={
          <span role="status" aria-label="Status: Open">
            Open
          </span>
        }
      />,
    );
    expect(screen.getByRole("status", { name: /open/i })).toBeInTheDocument();
  });

  it("renders actions slot when supplied", () => {
    render(
      <RecordDetailHeader
        title="Mary Johnson"
        actions={<button type="button">Edit profile</button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: /edit profile/i }),
    ).toBeInTheDocument();
  });

  it("renders multiple action children in the actions slot", () => {
    render(
      <RecordDetailHeader
        title="Mary Johnson"
        actions={
          <>
            <button type="button">Save</button>
            <button type="button">Print</button>
          </>
        }
      />,
    );
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /print/i })).toBeInTheDocument();
  });

  // ── className forwarding ─────────────────────────────────────────────────────

  it("forwards className to the outer container", () => {
    const { container } = render(
      <RecordDetailHeader title="Test" className="custom-header-class" />,
    );
    expect(container.firstChild).toHaveClass("custom-header-class");
  });

  // ── Accessibility structure ──────────────────────────────────────────────────

  it("title h1 appears before subtitle in the DOM", () => {
    render(
      <RecordDetailHeader
        title="Mary Johnson"
        subtitle="Room 207"
        backLink={{ label: "Back", href: "/admin/residents" }}
      />,
    );
    const heading = screen.getByRole("heading", { level: 1 });
    const subtitle = screen.getByText("Room 207");
    // Heading must precede subtitle in document order
    expect(
      heading.compareDocumentPosition(subtitle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("back link is rendered before the heading in the DOM (breadcrumb above title)", () => {
    render(
      <RecordDetailHeader
        title="Mary Johnson"
        backLink={{ label: "All residents", href: "/admin/residents" }}
      />,
    );
    const link = screen.getByRole("link");
    const heading = screen.getByRole("heading", { level: 1 });
    // The back link must come before the h1 in DOM order
    expect(
      link.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("arrow in back link is aria-hidden (not read by screen readers)", () => {
    render(
      <RecordDetailHeader
        title="Test"
        backLink={{ label: "Back", href: "/admin/staff" }}
      />,
    );
    // The decorative arrow span must carry aria-hidden="true"
    const arrowSpan = document.querySelector('[aria-hidden="true"]');
    expect(arrowSpan).toBeInTheDocument();
    expect(arrowSpan?.textContent).toBe("←");
  });
});
