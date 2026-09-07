import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(import.meta.dirname, "./executive-hub-nav.tsx"), "utf8");
const overviewSource = readFileSync(
  path.resolve(import.meta.dirname, "../../../components/executive/ExecutiveOverviewPageClient.tsx"),
  "utf8",
);
const alertsSource = readFileSync(path.resolve(import.meta.dirname, "./alerts/page.tsx"), "utf8");

describe("ExecutiveHubNav role filter", () => {
  it("filters hub links with canOpenExecutiveHubHref so facility admin is not offered overview", () => {
    expect(source).toContain("canOpenExecutiveHubHref");
    expect(source).toContain("primaryItems");
    expect(source).toContain("secondaryItems");
  });

  it("uses normal links and mounts the responsive mobile trigger on overview and alerts", () => {
    expect(source).not.toContain('role="tablist"');
    expect(source).not.toContain('tabIndex={active ? 0 : -1}');
    expect(source).toContain('aria-current={active ? "page" : undefined}');
    expect(overviewSource).toContain("<ExecutiveHubNav />");
    expect(alertsSource).toContain("<ExecutiveHubNav />");
    expect(overviewSource).not.toMatch(/hidden md:block[\s\S]{0,120}<ExecutiveHubNav/);
    expect(alertsSource).not.toMatch(/hidden md:block[\s\S]{0,120}<ExecutiveHubNav/);
  });
});
