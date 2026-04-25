import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { T5Form } from "./T5Form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/admin/residents/new",
  useSearchParams: () => new URLSearchParams(""),
}));

const audit = {
  auditHref: "/admin/audit",
  updatedAt: new Date("2026-04-24T12:00:00-04:00"),
  now: new Date("2026-04-24T12:05:00-04:00"),
};

describe("<T5Form />", () => {
  it("renders steps, form body, save bar, audit log, and audit footer", () => {
    render(
      <T5Form
        title="New resident"
        steps={[
          { id: "1", label: "Identity", state: "complete" },
          { id: "2", label: "Care plan", state: "active" },
          { id: "3", label: "Family", state: "pending" },
        ]}
        auditLog={[
          { id: "a1", label: "Saved draft", occurredAt: "2026-04-24T11:00:00-04:00", actor: "B. Lewis" },
        ]}
        saveBar={
          <>
            <button type="button">Cancel</button>
            <button type="button">Save</button>
          </>
        }
        audit={audit}
      >
        <p>field placeholder</p>
      </T5Form>,
    );

    expect(screen.getByRole("list", { name: /wizard steps/i })).toBeInTheDocument();
    expect(screen.getByText(/identity/i).closest("li")).not.toHaveAttribute("aria-current");
    expect(screen.getByText(/care plan/i).closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("region", { name: /form body/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /save bar/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /form audit log/i })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo", { name: /audit/i })).toBeInTheDocument();
  });

  it("omits the audit log rail when empty", () => {
    render(
      <T5Form
        title="New resident"
        saveBar={<button type="button">Save</button>}
        audit={audit}
      >
        <p>fields</p>
      </T5Form>,
    );
    expect(screen.queryByRole("region", { name: /form audit log/i })).toBeNull();
  });
});
