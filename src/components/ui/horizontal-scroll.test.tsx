import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HorizontalScroll } from "./horizontal-scroll";
import { Table, TableBody, TableCell, TableRow } from "./table";
import { TableRowHeader, TableRowList } from "./table-row";

function stubWidths(scrollWidth: number, clientWidth: number) {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(scrollWidth);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(clientWidth);
}

afterEach(() => vi.restoreAllMocks());

describe("HorizontalScroll (COL-657)", () => {
  it("turns an overflowing box into a named, keyboard-focusable scroll region with an edge shade", () => {
    stubWidths(900, 390);
    const { container } = render(<HorizontalScroll label="Staff roster"><div>wide</div></HorizontalScroll>);
    const region = screen.getByRole("region", { name: "Staff roster" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.className).toContain("overflow-x-auto");
    expect(container.querySelector('[data-slot="horizontal-scroll-shade-end"]')?.className).toContain("opacity-100");
    expect(container.querySelector('[data-slot="horizontal-scroll-shade-start"]')?.className).toContain("opacity-0");
  });

  it("stays a plain box with no tab stop when everything fits", () => {
    stubWidths(390, 390);
    const { container } = render(<HorizontalScroll label="Staff roster"><div>fits</div></HorizontalScroll>);
    expect(screen.queryByRole("region")).toBeNull();
    expect(container.querySelector('[data-slot="horizontal-scroll-viewport"]')).not.toHaveAttribute("tabindex");
  });

  it("wraps every Table so its columns scroll instead of clipping", () => {
    stubWidths(1200, 390);
    render(
      <Table aria-label="Incident reports log">
        <TableBody><TableRow><TableCell>Fall</TableCell></TableRow></TableBody>
      </Table>,
    );
    const region = screen.getByRole("region", { name: "Incident reports log" });
    expect(region.querySelector("table")).not.toBeNull();
  });

  it("gives TableRowHeader lists a minimum width inside the scroll box", () => {
    stubWidths(704, 390);
    const { container } = render(
      <TableRowList label="Insurance policies">
        <TableRowHeader><span className="flex-1">Carrier</span></TableRowHeader>
      </TableRowList>,
    );
    const region = screen.getByRole("region", { name: "Insurance policies" });
    const list = container.querySelector('[data-slot="table-row-list"]');
    expect(region.contains(list)).toBe(true);
    expect(list?.className).toContain("min-w-[44rem]");
  });
});

/**
 * Guard: a TableRowHeader list outside TableRowList squeezes its columns to
 * the card width and clips on a phone. The only exceptions are named here
 * with the reason.
 */
const EXEMPT_FROM_TABLE_ROW_LIST = new Set<string>([
  // Native <table> markup rendered through TableRowHeader render={<tr />}; the table itself scrolls.
  "src/app/(admin)/admin/compliance/deficiencies/analysis/page.tsx",
  // Reflows to stacked cards below md; header is desktop-only by design.
  "src/components/residents/AdminResidentsPageClient.tsx",
]);

describe("TableRowHeader lists scroll on a phone (COL-657 guard)", () => {
  const users = execFileSync("git", ["grep", "-l", "<TableRowHeader", "--", "src"], { encoding: "utf8" })
    .split("\n")
    .filter((file) => file && !file.includes("/components/ui/") && !/\.test\.tsx?$/.test(file));

  it.each(users.filter((file) => !EXEMPT_FROM_TABLE_ROW_LIST.has(file)))("%s wraps its rows in TableRowList", (file) => {
    expect(readFileSync(file, "utf8")).toContain("<TableRowList");
  });

  it("keeps the exemption list honest", () => {
    for (const file of EXEMPT_FROM_TABLE_ROW_LIST) expect(users, file).toContain(file);
  });
});
