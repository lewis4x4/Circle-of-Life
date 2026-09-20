import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * COL-432. Every route under `/admin/residents/[id]` renders inside
 * `AdminResidentDetailShell`, which already emits the page's single <h1> (the
 * resident's name) via `RecordDetailHeader`. A child page that also renders
 * `RecordDetailHeader` produces a second <h1> — the document outline then
 * claims the page is about "Assessments" rather than about the resident, and
 * axe flags the duplicate top-level heading.
 *
 * The shell is the only permitted owner of the <h1> on these routes; children
 * contribute <h2> section headings through `RecordDetailSection`.
 */

const ROUTE_ROOT = "src/app/(admin)/admin/residents/[id]";
const repoRoot = process.cwd();

/**
 * Drop block comments, which is also how JSX comments are written. The rule
 * below is about rendered markup, and these pages carry comments that name the
 * very tags being searched for.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

const readPage = (relativePath: string) =>
  withoutComments(readFileSync(path.join(repoRoot, relativePath), "utf8"));

/** Every `page.tsx` beneath the resident detail layout, repo-relative. */
function residentDetailPages(relativeDir: string): string[] {
  const entries = readdirSync(path.join(repoRoot, relativeDir), { withFileTypes: true });
  return entries.flatMap((entry) => {
    const child = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) return residentDetailPages(child);
    return entry.name === "page.tsx" ? [child] : [];
  });
}

describe("resident detail child routes keep the shell's single <h1>", () => {
  const pages = residentDetailPages(ROUTE_ROOT);

  it("finds the resident detail child pages", () => {
    // Guards against the walker silently returning nothing after a move.
    expect(pages.length).toBeGreaterThanOrEqual(5);
  });

  for (const page of pages) {
    it(`${page} does not render its own RecordDetailHeader`, () => {
      expect(
        readPage(page).includes("<RecordDetailHeader"),
        `${page} renders a second top-level heading; the resident name heading comes from AdminResidentDetailShell. Use RecordDetailSection plus a toolbar row instead.`,
      ).toBe(false);
    });

    it(`${page} does not hand-roll a top-level heading`, () => {
      expect(readPage(page).includes("<h1")).toBe(false);
    });
  }
});
