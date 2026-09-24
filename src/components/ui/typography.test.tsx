import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TitleH1 } from "@/components/ui/typography";

describe("TitleH1 (COL-656)", () => {
  it("uses the foreground token, not white, so it shows on the light canvas", () => {
    render(<TitleH1>Scenario Modeling</TitleH1>);
    const heading = screen.getByRole("heading", { level: 1, name: "Scenario Modeling" });
    expect(heading.className).toContain("text-foreground");
    expect(heading.className).not.toContain("text-white");
  });
});

describe("Scenario Modeling KPI tiles (COL-656)", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/app/(admin)/executive/scenarios/page.tsx"),
    "utf8",
  );

  it("uses the design-system KPI tile, not the neon mono tile", () => {
    expect(source).not.toContain("MetricCardMoonshot");
    expect(source).toContain("<KPITile");
  });

  it("formats money with the shared signed formatter and tone", () => {
    expect(source).not.toMatch(/`\$\$\{/);
    expect(source).toContain("formatUsdCompact(summary.endNoi)");
    expect(source).toContain("tone={usdTone(summary.endNoi)}");
  });
});
