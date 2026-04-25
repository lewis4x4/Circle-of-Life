import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CopilotDrawer } from "./CopilotDrawer";
import { filterCitedSuggestions } from "./filter-citations";
import type { CopilotSuggestion } from "./types";

const VALID: CopilotSuggestion = {
  id: "s1",
  title: "Review fall-prevention protocol",
  body: "2 falls in Hallway A in the last 72h.",
  recordId: "unit-a",
  recordType: "facility_unit",
  facilityId: "oakridge",
  generatedAt: "2026-04-24T15:58:00-04:00",
  modelVersion: "haven-copilot-2026-04-15",
  citations: [
    { source: "incident_reports", id: "inc-1", excerpt: "Resident fall." },
  ],
};

const UNCITED = { ...VALID, id: "s2", citations: [] };
const MISSING_RECORD = { ...VALID, id: "s3" } as unknown as Record<string, unknown>;
delete MISSING_RECORD.recordId;

describe("filterCitedSuggestions", () => {
  it("keeps suggestions with at least one well-formed citation", () => {
    const warn = vi.fn();
    const result = filterCitedSuggestions([VALID], warn);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("s1");
    expect(warn).not.toHaveBeenCalled();
  });

  it("drops uncited suggestions and logs a warning", () => {
    const warn = vi.fn();
    const result = filterCitedSuggestions([UNCITED], warn);
    expect(result).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/citations/i);
  });

  it("drops suggestions missing a required field", () => {
    const warn = vi.fn();
    const result = filterCitedSuggestions([MISSING_RECORD], warn);
    expect(result).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it("drops suggestions with malformed citations", () => {
    const warn = vi.fn();
    const bad = { ...VALID, id: "s4", citations: [{ source: "x" }] };
    const result = filterCitedSuggestions([bad], warn);
    expect(result).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });
});

describe("<CopilotDrawer />", () => {
  it("renders nothing when closed", () => {
    render(<CopilotDrawer open={false} onClose={() => undefined} suggestions={[VALID]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders empty copy when no cited suggestions survive the filter", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<CopilotDrawer open onClose={() => undefined} suggestions={[UNCITED]} />);
    expect(
      screen.getByText(/no cite-backed suggestions/i),
    ).toBeInTheDocument();
    warn.mockRestore();
  });

  it("renders cited suggestions with citation count and record metadata", () => {
    render(<CopilotDrawer open onClose={() => undefined} suggestions={[VALID]} />);
    expect(screen.getByRole("dialog", { name: /copilot/i })).toBeInTheDocument();
    expect(screen.getByText(/cite-backed \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/facility_unit/i)).toBeInTheDocument();
  });

  it("expands a suggestion to show citations and action buttons", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <CopilotDrawer
        open
        onClose={() => undefined}
        suggestions={[VALID]}
        onAction={onAction}
      />,
    );
    await user.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByText(/inc-1/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^ACK$/ }));
    expect(onAction).toHaveBeenCalledWith("ack", expect.objectContaining({ id: "s1" }));
  });
});
