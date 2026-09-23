import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { axeViolations } from "@/test-utils/axe";

import { TableRow, TableRowHeader } from "./table-row";

describe("TableRow / TableRowHeader (COL-658)", () => {
  it("renders a row list that axe accepts (no orphan row roles)", async () => {
    const { container } = render(
      <div>
        <TableRowHeader>
          <div className="flex-[3]">Staff</div>
          <div className="flex-1">Status</div>
        </TableRowHeader>
        <TableRow>
          <div className="flex-[3]">Jordan Smith</div>
          <div className="flex-1">Active</div>
        </TableRow>
      </div>,
    );
    expect(container.querySelector('[role="row"]')).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("keeps link semantics when a row renders as an anchor", () => {
    render(
      <TableRow render={<a href="#staff-1" />}>
        <div>Jordan Smith</div>
      </TableRow>,
    );
    expect(screen.getByRole("link", { name: "Jordan Smith" })).toHaveAttribute("href", "#staff-1");
  });

  it("still lets a caller building a full ARIA grid opt into the row role", () => {
    render(
      <div role="table" aria-label="Roster">
        <div role="rowgroup">
          <TableRow role="row">
            <div role="cell">Jordan Smith</div>
          </TableRow>
        </div>
      </div>,
    );
    expect(screen.getByRole("row", { name: "Jordan Smith" })).toBeInTheDocument();
  });
});
