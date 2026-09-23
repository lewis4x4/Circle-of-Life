import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

/**
 * Admin pages render inside the AppShell workspace, which scrolls on its own
 * and sits beside the sidebar. A window-fixed bottom bar lies over that
 * workspace: on a phone it covers the page's last controls, on desktop it runs
 * under the sidebar (COL-657, /admin/operations stats bar). Bars that must stay
 * on screen stick to the workspace instead (`sticky bottom-0`).
 */
describe("admin workspace bottom bars (COL-657)", () => {
  it("no admin page pins a bar to the bottom of the window", () => {
    let hits = "";
    try {
      hits = execFileSync(
        "git",
        ["grep", "-nE", "fixed (bottom-0 (inset-x-0|left-0)|inset-x-0 bottom-0|left-0 right-0 bottom-0)", "--", "src/app/(admin)"],
        { encoding: "utf8" },
      );
    } catch {
      // git grep exits 1 when nothing matches.
    }
    expect(hits).toBe("");
  });
});
