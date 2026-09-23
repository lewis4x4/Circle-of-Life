/**
 * COL-639: the med-tech shell's links were a `fixed` overlay, so every page
 * under them (controlled count, Required reading) rendered its title beneath
 * them on a phone. They now sit in a header row, and pages scroll inside `main`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("med-tech shell chrome does not cover page content", () => {
  const shell = read("src/components/layout/MedTechShell.tsx");

  it("renders its links in a header in normal flow, not a fixed overlay", () => {
    expect(shell).toMatch(/<header className="[^"]*\bshrink-0\b/);
    expect(shell).not.toMatch(/className="[^"]*\bfixed\b[^"]*\btop-/);
  });

  it("gives pages the remaining height in a scrolling main", () => {
    expect(shell).toMatch(/<div className="[^"]*\bflex h-dvh flex-col\b/);
    expect(shell).toMatch(/<main className="min-h-0 flex-1 overflow-y-auto">/);
  });

  it("sizes the full-bleed cockpit to main instead of the viewport", () => {
    expect(read("src/components/med-tech/Cockpit.tsx")).not.toMatch(/\bh-screen\b/);
  });

  it("pads the controlled count page like the other shells", () => {
    expect(read("src/app/(med-tech)/med-tech/controlled-count/page.tsx")).toMatch(/className="[^"]*\bp-4 md:p-8\b/);
  });
});
