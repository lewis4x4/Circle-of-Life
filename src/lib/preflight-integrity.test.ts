import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { describe, expect, it } from "vitest";

function probe({ env = {}, audit = "| CRITICAL | 0 | 0 |", fail = false }: { env?: Record<string, string>; audit?: string; fail?: boolean } = {}) {
  let code: number | undefined;
  let report = "";
  const script = fs.readFileSync("scripts/homewood/preflight.mjs", "utf8").replace(/^import .*;$/gm, "");
  vm.runInNewContext(script, {
    path, console: { log() {}, error() {} },
    process: { cwd: () => "/synthetic", env, argv: [], stdout: { write() {} }, exit: (n: number) => { code = n; } },
    execSync: () => { if (fail) throw { status: 1, stderr: "failed" }; return "test output"; },
    spawnSync: () => ({ status: 0, stdout: "test-commit" }),
    existsSync: () => true, mkdirSync() {}, readFileSync: () => audit,
    writeFileSync: (_p: string, text: string) => { report = text; },
  });
  return { code, report };
}

describe("preflight evidence", () => {
  it("blocks launch when operational prerequisites are missing", () => {
    const result = probe();
    expect(result.code).toBe(1);
    expect(result.report).toContain("BLOCKED");
    expect(result.report).not.toContain("Every pre-flight gate passed");
  });
  it("fails on missing parseable audit evidence", () => {
    const result = probe({ env: { BASE_URL: "http://test", HOMEWOOD_LAUNCH_PASSWORD: "fixture" }, audit: "not a completed audit" });
    expect(result.code).toBe(1);
    expect(result.report).toContain("NO-GO");
  });
  it("returns a failure exit code without requiring a strict flag", () => {
    expect(probe({ fail: true }).code).toBe(1);
  });
});
