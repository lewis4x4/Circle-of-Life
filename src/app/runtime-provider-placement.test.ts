import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readSource = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("runtime provider placement", () => {
  it("keeps root layout free of non-public runtime providers", () => {
    const rootLayout = readSource("src/app/layout.tsx");

    expect(rootLayout).not.toContain("ServiceWorkerRegister");
    expect(rootLayout).not.toContain("TooltipProvider");
    expect(rootLayout).not.toContain("Toaster");
    expect(rootLayout).toContain("ThemeProvider");
    expect(rootLayout).toContain("main-content");
  });

  it("mounts AppRuntimeProviders in authenticated app route layouts", () => {
    const runtimeLayouts = [
      "src/app/(admin)/layout.tsx",
      "src/app/clinical/layout.tsx",
      "src/app/(caregiver)/layout.tsx",
      "src/app/(family)/layout.tsx",
      "src/app/(med-tech)/layout.tsx",
      "src/app/(dietary)/layout.tsx",
      "src/app/(onboarding)/layout.tsx",
    ];

    for (const layoutPath of runtimeLayouts) {
      expect(readSource(layoutPath), layoutPath).toContain("AppRuntimeProviders");
    }
  });
});
