import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readSource = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("AdminShell Quality navigation", () => {
  it("does not include reputation in the Quality & Risk nav group", () => {
    const source = readSource("src/components/layout/AdminShell.tsx");
    const qualityBlockStart = source.indexOf('group: "Quality & Risk"');
    const qualityBlockEnd = source.indexOf('group: "Knowledge"', qualityBlockStart);

    expect(qualityBlockStart).toBeGreaterThan(-1);
    expect(qualityBlockEnd).toBeGreaterThan(qualityBlockStart);

    const qualityBlock = source.slice(qualityBlockStart, qualityBlockEnd);
    expect(qualityBlock).not.toContain("reputation");
    expect(qualityBlock).not.toContain("/admin/reputation");
    expect(qualityBlock).not.toContain("Reputation");
  });
});
