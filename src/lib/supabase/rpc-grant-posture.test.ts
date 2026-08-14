import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Integration guard for migration 308 RPC grant posture.
 * Replays all migrations in Docker (when available) and asserts anon cannot
 * execute billing/clinical SECURITY DEFINER RPCs while authenticated paths remain.
 */
describe("RPC grant posture (migration 308)", () => {
  it("denies anon execute on billing/clinical RPCs after migration replay", () => {
    const result = spawnSync("npm", ["run", "migrations:verify:pg"], {
      encoding: "utf8",
    });

    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

    if (output.includes("SKIP: Docker not available")) {
      return;
    }

    expect(result.status, output).toBe(0);
    expect(output).toContain("[migrations:verify:pg] PASS");
  });
});
