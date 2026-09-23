import { readFileSync } from "node:fs";
import path from "node:path";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReferralsHubNav } from "./referrals-hub-nav";

const mocks = vi.hoisted(() => ({ pathname: "/admin/referrals" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));

const dir = path.join(process.cwd(), "src/app/(admin)/admin/referrals");

describe("ReferralsHubNav (COL-655)", () => {
  beforeEach(() => {
    mocks.pathname = "/admin/referrals";
  });

  it.each([
    ["/admin/referrals", "Pipeline"],
    ["/admin/referrals/abc-lead", "Pipeline"],
    ["/admin/referrals/new", "New lead"],
    ["/admin/referrals/hl7-inbound/new", "Referral inbox"],
    ["/admin/v2/referrals/sources", "Sources"],
  ])("links every section and marks only the current one on %s", (pathname, label) => {
    mocks.pathname = pathname;
    render(<ReferralsHubNav />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(4);
    expect(links.filter((link) => link.getAttribute("aria-current") === "page").map((link) => link.textContent)).toEqual([label]);
  });

  it("is rendered once by the referrals layout, not per page", () => {
    expect(readFileSync(path.join(dir, "layout.tsx"), "utf8")).toContain("<ReferralsHubNav />");
    for (const page of ["page.tsx", "new/page.tsx", "sources/page.tsx", "hl7-inbound/page.tsx", "hl7-inbound/new/page.tsx", "[id]/page.tsx"]) {
      expect(readFileSync(path.join(dir, page), "utf8"), page).not.toContain("<ReferralsHubNav");
    }
    const pipelineClient = path.join(process.cwd(), "src/components/referrals/AdminReferralsPageClient.tsx");
    expect(readFileSync(pipelineClient, "utf8")).not.toContain("<ReferralsHubNav");
  });
});
