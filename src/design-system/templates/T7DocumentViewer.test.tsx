import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { T7DocumentViewer } from "./T7DocumentViewer";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/admin/documents/d1",
  useSearchParams: () => new URLSearchParams(""),
}));

const audit = {
  auditHref: "/admin/audit",
  updatedAt: new Date("2026-04-24T12:00:00-04:00"),
  now: new Date("2026-04-24T12:05:00-04:00"),
};

describe("<T7DocumentViewer />", () => {
  it("renders document, toolbar, metadata, activity, and audit footer", () => {
    render(
      <T7DocumentViewer
        title="Form 1823"
        document={<div data-testid="doc">document body</div>}
        metadata={[
          { label: "Uploaded", value: "2026-04-23" },
          { label: "Signer", value: "Dr. Patel" },
        ]}
        activity={[
          { id: "a1", label: "Signed", occurredAt: "2026-04-23T14:00:00-04:00", actor: "Dr. Patel" },
        ]}
        toolbar={<button type="button">Highlight</button>}
        audit={audit}
      />,
    );

    expect(screen.getByRole("region", { name: /annotation toolbar/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /document pane/i })).toBeInTheDocument();
    expect(screen.getByTestId("doc")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /document metadata/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /document activity/i })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo", { name: /audit/i })).toBeInTheDocument();
  });
});
