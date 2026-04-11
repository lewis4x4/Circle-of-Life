#!/usr/bin/env node
/**
 * Fails if disallowed "Memory Care" marketing/unit strings reappear in source (COL handoff).
 */
import { execSync } from "node:child_process";

const root = process.cwd();
try {
  const out = execSync(
    `grep -R -n "Memory Care" "${root}/src" 2>/dev/null || true`,
    { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
  );
  if (out.trim()) {
    console.error("[check-memory-care] FAIL: disallowed phrase found:\n", out);
    process.exit(1);
  }
  console.log("[check-memory-care] PASS");
  process.exit(0);
} catch (e) {
  console.error("[check-memory-care] ERROR", e);
  process.exit(1);
}
