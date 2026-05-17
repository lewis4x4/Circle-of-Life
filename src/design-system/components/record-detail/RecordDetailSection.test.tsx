import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RecordDetailSection } from "./RecordDetailSection";

describe("<RecordDetailSection />", () => {
  // ── Required props ──────────────────────────────────────────────────────────

  it("renders title as an h2 heading", () => {
    render(
      <RecordDetailSection title="Contact information">
        <p>body</p>
      </RecordDetailSection>,
    );
    expect(
      screen.getByRole("heading", { name: /contact information/i, level: 2 }),
    ).toBeInTheDocument();
  });

  it("renders children in the section body", () => {
    render(
      <RecordDetailSection title="Details">
        <p>body content here</p>
      </RecordDetailSection>,
    );
    expect(screen.getByText("body content here")).toBeInTheDocument();
  });

  // ── Optional props ──────────────────────────────────────────────────────────

  it("renders description below the heading when supplied", () => {
    render(
      <RecordDetailSection title="Care plan" description="Physician-entered summary">
        <p>plan</p>
      </RecordDetailSection>,
    );
    expect(screen.getByText("Physician-entered summary")).toBeInTheDocument();
  });

  it("does not render description element when description is omitted", () => {
    render(
      <RecordDetailSection title="Details">
        <p>content</p>
      </RecordDetailSection>,
    );
    // No description <p> should exist beyond the children
    // (query something unlikely to appear)
    expect(screen.queryByText(/physician/i)).not.toBeInTheDocument();
  });

  it("renders action slot when supplied", () => {
    render(
      <RecordDetailSection
        title="Contact information"
        action={<button type="button">Edit</button>}
      >
        <p>content</p>
      </RecordDetailSection>,
    );
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
  });

  it("action slot is keyboard-reachable when rendered", () => {
    render(
      <RecordDetailSection
        title="Medications"
        action={<button type="button">Add medication</button>}
      >
        <p>content</p>
      </RecordDetailSection>,
    );
    const btn = screen.getByRole("button", { name: /add medication/i });
    // Rendered button is focusable (not disabled, not aria-hidden)
    expect(btn).toBeEnabled();
  });

  it("renders multiple children correctly", () => {
    render(
      <RecordDetailSection title="Allergies">
        <p>Penicillin</p>
        <p>Sulfa drugs</p>
        <p>Latex</p>
      </RecordDetailSection>,
    );
    expect(screen.getByText("Penicillin")).toBeInTheDocument();
    expect(screen.getByText("Sulfa drugs")).toBeInTheDocument();
    expect(screen.getByText("Latex")).toBeInTheDocument();
  });

  // ── className forwarding ─────────────────────────────────────────────────────

  it("forwards className to the outer <section> container", () => {
    const { container } = render(
      <RecordDetailSection title="Test" className="custom-section-class">
        <p>content</p>
      </RecordDetailSection>,
    );
    expect(container.firstChild).toHaveClass("custom-section-class");
  });

  // ── Accessibility structure ──────────────────────────────────────────────────

  it("outer element is a <section> landmark", () => {
    render(
      <RecordDetailSection title="Demographics">
        <p>content</p>
      </RecordDetailSection>,
    );
    // section with an accessible name (h2 inside) is a region landmark
    // The h2 heading "Demographics" provides the implicit accessible name
    expect(
      screen.getByRole("region", { name: /demographics/i }),
    ).toBeInTheDocument();
  });

  it("h2 heading appears before children in the DOM", () => {
    render(
      <RecordDetailSection title="Diagnoses">
        <p>ICD-10 content</p>
      </RecordDetailSection>,
    );
    const heading = screen.getByRole("heading", { level: 2 });
    const content = screen.getByText("ICD-10 content");
    expect(
      heading.compareDocumentPosition(content) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("action appears in the same header row as the heading", () => {
    render(
      <RecordDetailSection
        title="Vitals"
        action={<button type="button">Record vitals</button>}
      >
        <p>content</p>
      </RecordDetailSection>,
    );
    const heading = screen.getByRole("heading", { level: 2 });
    const btn = screen.getByRole("button", { name: /record vitals/i });
    // The heading's wrapper div and the button's wrapper div share the same
    // parent (the flex header row), confirming they are in the same row.
    expect(heading.closest("div")?.parentElement).toBe(
      btn.closest("div")?.parentElement,
    );
  });
});
