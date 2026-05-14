import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const designSystemRoot = path.join(repoRoot, "src/design-system");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".json"]);
const RETIRED_LEGACY_LABELS = ["Oakridge", "Plantation", "Rising Oaks", "Grande Cypress"];

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = path.join(directory, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      return collectSourceFiles(fullPath);
    }

    if (!SOURCE_EXTENSIONS.has(path.extname(fullPath)) || fullPath.includes(".test.")) {
      return [];
    }

    return [fullPath];
  });
}

describe("design-system preview data legacy facility names", () => {
  it("keeps previews and fixtures on neutral sample labels", () => {
    for (const sourcePath of collectSourceFiles(designSystemRoot)) {
      const source = readFileSync(sourcePath, "utf8");

      for (const label of RETIRED_LEGACY_LABELS) {
        expect(source, `${path.relative(repoRoot, sourcePath)} still contains ${label}`).not.toContain(label);
      }
    }
  });
});
