/**
 * COL-639: the med-tech shell's links were a `fixed` overlay, so every page
 * under them (controlled count, Required reading) rendered its title beneath
 * them on a phone. COL-714: the shell now renders the shared RoleAppFrame,
 * whose header sits in normal flow and whose pages scroll inside the frame.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("med-tech shell chrome does not cover page content", () => {
  const shell = read("src/components/layout/MedTechShell.tsx");
  const frame = read("src/design-system/components/RoleAppFrame/RoleAppFrame.tsx");

  it("renders the shared frame instead of fixed chrome of its own", () => {
    expect(shell).toMatch(/<RoleAppFrame\b/);
    expect(shell).not.toMatch(/className="[^"]*\bfixed\b[^"]*\btop-/);
  });

  it("keeps the frame header in normal flow and gives pages the remaining height", () => {
    expect(frame).toMatch(/<header className="[^"]*\bmd:sticky\b/);
    expect(frame).not.toMatch(/<header className="[^"]*(^|\s)fixed\b/);
    expect(frame).toMatch(/"flex h-dvh\b/);
    expect(frame).toMatch(/<main className="flex min-h-0 flex-1 flex-col">/);
  });

  it("sizes the full-bleed cockpit to main instead of the viewport", () => {
    expect(read("src/components/med-tech/Cockpit.tsx")).not.toMatch(/\bh-screen\b/);
  });

  it("pads the controlled count page like the other shells", () => {
    expect(read("src/app/(med-tech)/med-tech/controlled-count/page.tsx")).toMatch(/className="[^"]*\bp-4 md:p-8\b/);
  });
});
