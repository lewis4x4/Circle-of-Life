import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BackLink } from "@/design-system/components/BackLink";
import { PageHeader } from "@/design-system/components/PageHeader";

describe("BackLink (COL-656)", () => {
  it("names the destination and hides the decorative arrow", () => {
    render(<BackLink label="Admissions" href="/admin/admissions" />);
    const link = screen.getByRole("link", { name: "Admissions" });
    expect(link.getAttribute("href")).toBe("/admin/admissions");
    expect(link.querySelector('[aria-hidden="true"]')?.textContent).toBe("←");
  });

  it("is what PageHeader renders above the title", () => {
    render(<PageHeader title="Queue" backLink={{ label: "Admissions", href: "/admin/admissions" }} />);
    const link = screen.getByRole("link", { name: "Admissions" });
    const heading = screen.getByRole("heading", { level: 1, name: "Queue" });
    expect(link.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
