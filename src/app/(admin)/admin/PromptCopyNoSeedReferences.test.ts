import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readSource = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

const PROMPT_AND_COPY_SOURCES = [
  "src/lib/haven-insight/context-map.ts",
  "src/app/(admin)/training/page.tsx",
  "src/lib/knowledge/obsidian-draft.ts",
];

const LEGACY_SITE_MARKERS = [
  "Cedar Park",
  "Oakridge",
  "Grande Cypress",
  "Rising Oaks",
  "Plantation",
];

const SEEDED_COPY_MARKERS = [
  "catalog programs are seeded",
  "seeded. Select a facility",
];

describe("prompt and training copy do not reference legacy seed examples", () => {
  it("keeps live prompt suggestions generic instead of naming seeded facilities", () => {
    for (const sourcePath of PROMPT_AND_COPY_SOURCES) {
      const source = readSource(sourcePath);

      for (const marker of LEGACY_SITE_MARKERS) {
        expect(source, `${sourcePath} still contains legacy site marker ${marker}`).not.toContain(marker);
      }
    }
  });

  it("does not describe live catalog copy as seeded", () => {
    const trainingSource = readSource("src/app/(admin)/training/page.tsx");

    for (const marker of SEEDED_COPY_MARKERS) {
      expect(trainingSource, `Training copy still contains ${marker}`).not.toContain(marker);
    }

    expect(trainingSource).toContain("Florida catalog programs are ready to assign");
    expect(trainingSource).toContain("add a live completion row");
  });
});
