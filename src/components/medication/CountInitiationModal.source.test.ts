import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(import.meta.dirname, "./CountInitiationModal.tsx"), "utf8");

describe("CountInitiationModal controlled-count receipt", () => {
  it("passes a complete medication identity label to the shared witness receipt", () => {
    expect(source).toContain("medicationLabels");
    expect(source).not.toContain("medicationNames");
    expect(source).toContain("strength,");
    expect(source).toContain("form,");
    expect(source).toContain("Medication record:");
  });
});
