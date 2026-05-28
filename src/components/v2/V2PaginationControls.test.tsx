import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { V2PaginationControls } from "./V2PaginationControls";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/v2/residents",
  useSearchParams: () => new URLSearchParams("facility=f-1&page=99&pageSize=50"),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe("V2PaginationControls", () => {
  it("shows honest out-of-range copy and links back to the last page", () => {
    render(
      <V2PaginationControls
        showCurrentPageExportNote
        pagination={{
          page: 99,
          pageSize: 50,
          from: 4_900,
          to: 4_949,
          totalCount: 10,
          hasPreviousPage: true,
          hasNextPage: false,
        }}
      />,
    );

    expect(screen.getByText("No rows on page 99; 10 total")).toBeInTheDocument();
    expect(screen.getByText("· CSV exports current page")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Last page" })).toHaveAttribute(
      "href",
      "/admin/v2/residents?facility=f-1&page=1&pageSize=50",
    );
  });
});
