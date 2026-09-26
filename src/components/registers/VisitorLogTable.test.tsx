import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { VisitorLogRow } from "@/lib/registers/visitor-log";

import { VisitorLogTable } from "./VisitorLogTable";

function entry(overrides: Partial<VisitorLogRow>): VisitorLogRow {
  return {
    id: "v1",
    visitorName: "Test Visitor",
    visitorPhone: null,
    visitorType: "family_friend",
    visitingType: "resident",
    visitingResidentId: "r1",
    visitingResidentName: "Ada Brown",
    signedInAt: "2026-09-25T18:00:00Z",
    signedInByName: "Desk",
    signedOutAt: "2026-09-25T19:00:00Z",
    signedOutByName: "Desk",
    signOutMethod: "individual",
    voidedAt: null,
    voidReason: null,
    leftOpen: false,
    ...overrides,
  } as VisitorLogRow;
}

const rows = [
  entry({ id: "a", visitorName: "Visitor For Ada" }),
  entry({ id: "b", visitorName: "Visitor For Cal", visitingResidentId: "r2", visitingResidentName: "Cal Adams" }),
];
const residents = [
  { id: "r1", firstName: "Ada", lastName: "Brown" },
  { id: "r2", firstName: "Cal", lastName: "Adams" },
];

function renderTable(from: string) {
  return (
    <VisitorLogTable
      rows={rows}
      from={from}
      to="2026-09-25"
      onFrom={vi.fn()}
      onTo={vi.fn()}
      busyId={null}
      residents={residents}
      onVoid={vi.fn()}
      onMatch={vi.fn()}
    />
  );
}

describe("VisitorLogTable resident filter (COL-871)", () => {
  it("narrows the log to one resident and keeps it when the dates change", async () => {
    const user = userEvent.setup();
    const view = render(renderTable("2026-09-25"));
    await user.selectOptions(screen.getByLabelText("Visits to"), "r1");
    const table = screen.getByRole("table");
    expect(within(table).getByText("Visitor For Ada")).toBeTruthy();
    expect(within(table).queryByText("Visitor For Cal")).toBeNull();

    view.rerender(renderTable("2026-09-01"));
    expect((screen.getByLabelText("Visits to") as HTMLSelectElement).value).toBe("r1");
    expect(within(screen.getByRole("table")).queryByText("Visitor For Cal")).toBeNull();
  });

  it("filters to a resident from their name on a row", async () => {
    const user = userEvent.setup();
    render(renderTable("2026-09-25"));
    await user.click(screen.getByRole("button", { name: "Show only visits to Cal Adams" }));
    expect((screen.getByLabelText("Visits to") as HTMLSelectElement).value).toBe("r2");
    expect(within(screen.getByRole("table")).queryByText("Visitor For Ada")).toBeNull();
  });
});
