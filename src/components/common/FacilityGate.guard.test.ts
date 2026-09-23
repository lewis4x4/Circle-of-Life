import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { NOT_A_GATE } from "./facility-gate-exceptions";

const repoRoot = process.cwd();
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const GATE_COMPONENT = "src/components/common/FacilityGate.tsx";
const EXCEPTIONS = "src/components/common/facility-gate-exceptions.ts";

// Every phrasing the COL-651 audit found pages using to dead-end on "All facilities".
const HAND_ROLLED_GATE_COPY =
  /select a facility|choose a (single )?facility|pick a facility|choose a building|facility selector in the (header|top bar)|from the header selector/i;

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = path.join(directory, entry);
    if (statSync(fullPath).isDirectory()) return collectSourceFiles(fullPath);
    if (!SOURCE_EXTENSIONS.has(path.extname(fullPath)) || fullPath.includes(".test.")) return [];
    return [path.relative(repoRoot, fullPath).split(path.sep).join("/")];
  });
}

const filesWithGateCopy = collectSourceFiles(path.join(repoRoot, "src"))
  .filter((file) => file !== GATE_COMPONENT && file !== EXCEPTIONS)
  .filter((file) => HAND_ROLLED_GATE_COPY.test(readFileSync(path.join(repoRoot, file), "utf8")));

describe("COL-651 facility gate", () => {
  it("allows no hand-rolled facility gate copy outside <FacilityGate>", () => {
    const unlisted = filesWithGateCopy.filter((file) => !(file in NOT_A_GATE));
    expect(
      unlisted,
      "Use <FacilityGate> from @/components/common/FacilityGate instead of writing a facility banner",
    ).toEqual([]);
  });

  it("keeps the exception list to files that still carry the copy", () => {
    const stale = Object.keys(NOT_A_GATE).filter((file) => !filesWithGateCopy.includes(file));
    expect(stale, "These files no longer carry gate copy; delete them from facility-gate-exceptions.ts").toEqual([]);
  });
});
