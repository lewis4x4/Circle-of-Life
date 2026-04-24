import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuditFooter } from "./AuditFooter";

describe("<AuditFooter />", () => {
  const updatedAt = new Date("2026-04-24T12:00:00-04:00");
  const now = new Date("2026-04-24T12:03:00-04:00");

  it("renders audit trail link, live status, relative time, and timezone", () => {
    render(
      <AuditFooter
        auditHref="/admin/audit"
        updatedAt={updatedAt}
        now={now}
        timezone="America/New_York"
      />,
    );

    const auditLink = screen.getByRole("link", { name: /audit trail/i });
    expect(auditLink).toHaveAttribute("href", "/admin/audit");

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Live");

    expect(screen.getByText(/updated 3m ago/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/timezone/i)).toBeInTheDocument();
  });

  it("renders offline state with grayed dot", () => {
    render(
      <AuditFooter
        auditHref="/admin/audit"
        updatedAt={updatedAt}
        now={now}
        live={false}
      />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Offline");
  });

  it("uses America/New_York timezone by default", () => {
    render(<AuditFooter auditHref="/admin/audit" updatedAt={updatedAt} now={now} />);
    // EDT or EST label shown via date-fns-tz zzz token.
    expect(screen.getByLabelText(/timezone/i).textContent).toMatch(/^E[DS]T$/);
  });

  it("accepts updatedAt as ISO string", () => {
    render(
      <AuditFooter
        auditHref="/admin/audit"
        updatedAt="2026-04-24T15:59:30Z"
        now={new Date("2026-04-24T16:00:00Z")}
      />,
    );
    expect(screen.getByText(/just now|30s ago/i)).toBeInTheDocument();
  });
});
