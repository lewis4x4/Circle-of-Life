import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/reports/templates",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import ReportTemplateDetailPage from "@/app/(admin)/reports/templates/[slug]/page";
import { PHASE1_TEMPLATE_SEED } from "@/lib/reports/templates";

import { ReportTemplateDetail } from "./report-template-detail";

afterEach(cleanup);

describe("report template detail (COL-642)", () => {
  it.each(PHASE1_TEMPLATE_SEED.map((t) => [t.slug, t] as const))(
    "%s resolves and renders its definition and actions",
    async (slug, template) => {
      const element = await ReportTemplateDetailPage({ params: Promise.resolve({ slug }) });
      expect(element.type).toBe(ReportTemplateDetail);

      render(element);
      expect(screen.getByRole("heading", { level: 1, name: template.name })).toBeTruthy();
      expect(screen.getByRole("link", { name: "Run now" }).getAttribute("href")).toBe(
        `/admin/reports/run/template/${slug}`,
      );
      for (const tag of template.tags) expect(screen.getAllByText(tag).length).toBeGreaterThan(0);
    },
  );

  it("an unknown slug is a 404, not a crash", async () => {
    await expect(
      ReportTemplateDetailPage({ params: Promise.resolve({ slug: "no-such-template" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
