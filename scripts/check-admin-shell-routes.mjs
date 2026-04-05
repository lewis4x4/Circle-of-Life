/**
 * Ensures every first-level route under src/app/(admin)/ (except the nested admin/ tree)
 * has a matching prefix in ADMIN_SHELL_SEGMENTS — prevents auth proxy gaps on short paths.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const adminAppDir = path.join(repoRoot, "src/app/(admin)");
const adminShellFile = path.join(repoRoot, "src/lib/auth/admin-shell.ts");

function parseAdminShellSegments(source) {
  const m = source.match(/const ADMIN_SHELL_SEGMENTS = \[([\s\S]*?)\] as const/);
  if (!m) {
    throw new Error("[check:admin-shell] Could not find ADMIN_SHELL_SEGMENTS in admin-shell.ts");
  }
  const body = m[1];
  const segments = [];
  for (const line of body.split("\n")) {
    const q = /"([^"]+)"/.exec(line);
    if (q) segments.push(q[1]);
  }
  return new Set(segments);
}

function collectRequiredPrefixesFromFilesystem() {
  const required = new Set();
  if (!fs.existsSync(adminAppDir)) {
    throw new Error(`[check:admin-shell] Missing ${adminAppDir}`);
  }
  for (const name of fs.readdirSync(adminAppDir)) {
    if (name === "admin") {
      required.add("/admin");
      continue;
    }
    const full = path.join(adminAppDir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      required.add(`/${name}`);
    }
  }
  return required;
}

function main() {
  const source = fs.readFileSync(adminShellFile, "utf8");
  const declared = parseAdminShellSegments(source);
  const required = collectRequiredPrefixesFromFilesystem();

  const missing = [...required].filter((p) => !declared.has(p)).sort();

  if (missing.length > 0) {
    console.error("[check:admin-shell] FAIL: Add these to ADMIN_SHELL_SEGMENTS in src/lib/auth/admin-shell.ts:");
    for (const p of missing) console.error(`  - ${p}`);
    process.exit(1);
  }

  console.log(`[check:admin-shell] PASS: all ${required.size} top-level (admin) route prefix(es) are gated`);
}

main();
