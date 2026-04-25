import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { T3EntityDetail } from "./T3EntityDetail";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/admin/residents/r1",
  useSearchParams: () => new URLSearchParams(""),
}));

const audit = {
  auditHref: "/admin/audit",
  updatedAt: new Date("2026-04-24T12:00:00-04:00"),
  now: new Date("2026-04-24T12:05:00-04:00"),
};

describe("<T3EntityDetail />", () => {
  it("renders entity header, tabs, default tab content, timeline, and audit footer", () => {
    render(
      <T3EntityDetail
        title="Resident · A. Smith"
        subtitle="Oakridge ALF · Wing B"
        identifiers={[
          { label: "MRN", value: "12345" },
          { label: "Admit", value: "2024-09-01" },
        ]}
        status={{ label: "Active", tone: "success" }}
        tabs={[
          { id: "summary", label: "Summary", content: <p>summary body</p> },
          { id: "care-plan", label: "Care plan", content: <p>care plan</p>, count: 2 },
        ]}
        timeline={[
          {
            id: "t1",
            title: "Care plan signed",
            occurredAt: "2026-04-23T10:00:00-04:00",
            tone: "info",
          },
        ]}
        audit={audit}
      />,
    );

    expect(screen.getByRole("region", { name: /entity header/i })).toBeInTheDocument();
    expect(screen.getByText("MRN")).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: /entity tabs/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent(/summary/i);
    expect(screen.getByRole("tabpanel")).toHaveTextContent(/summary body/i);
    expect(screen.getByRole("region", { name: /activity timeline/i })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo", { name: /audit/i })).toBeInTheDocument();
  });

  it("switches tabs on click", async () => {
    const user = userEvent.setup();
    render(
      <T3EntityDetail
        title="Resident"
        tabs={[
          { id: "a", label: "A", content: <p>a</p> },
          { id: "b", label: "B", content: <p>b</p> },
        ]}
        audit={audit}
      />,
    );
    await user.click(screen.getByRole("tab", { name: /^B$/ }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent(/^b$/);
  });
});
