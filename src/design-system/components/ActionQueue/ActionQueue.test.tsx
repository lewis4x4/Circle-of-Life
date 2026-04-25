import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActionQueue } from "./ActionQueue";

describe("<ActionQueue />", () => {
  it("renders empty copy when items is empty", () => {
    render(<ActionQueue items={[]} />);
    expect(screen.getByText(/no pending actions/i)).toBeInTheDocument();
  });

  it("renders one row with label + count + link", () => {
    render(
      <ActionQueue
        items={[
          {
            id: "care-plans",
            label: "Care plan reviews due",
            sublabel: "This week",
            count: 3,
            href: "/admin/care-plans/reviews-due",
          },
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: /care plan reviews due/i });
    expect(link).toHaveAttribute("href", "/admin/care-plans/reviews-due");
    const badge = screen.getByLabelText(/3 items/i);
    expect(badge).toHaveAttribute("data-tone", "danger");
  });

  it("uses neutral tone for zero count", () => {
    render(
      <ActionQueue
        items={[
          {
            id: "alerts",
            label: "Open alerts",
            count: 0,
            href: "/admin/alerts",
          },
        ]}
      />,
    );
    expect(screen.getByLabelText(/0 items/i)).toHaveAttribute("data-tone", "neutral");
  });

  it("renders many rows", () => {
    render(
      <ActionQueue
        items={[
          { id: "a", label: "A", count: 1, href: "/a" },
          { id: "b", label: "B", count: 2, href: "/b" },
          { id: "c", label: "C", count: 3, href: "/c" },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: /action queue/i });
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("caps the count label at 99+", () => {
    render(
      <ActionQueue
        items={[
          { id: "lots", label: "Lots", count: 250, href: "/x" },
        ]}
      />,
    );
    expect(screen.getByText("99+")).toBeInTheDocument();
  });
});
