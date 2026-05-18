#!/usr/bin/env node
/**
 * Counts Quiet Operator primitive regressions across `src/app` routes so PRs can
 * attach backlog numbers (`>5 routes` → open migration tickets before widening ESLint globs).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "src", "app");

const TAG_OPEN = /<(\/)?(button|select|thead|\bth\b)\b/gim;
const TRACKED_CAPS_COMBO =
  /\buppercase\b[^"'`<>{}\r\n]{0,220}?\btracking-(?:wider|widest)\b|\btracking-(?:wider|widest)\b[^"'`<>{}\r\n]{0,220}?\buppercase\b/gis;

/** @typedef {{ file: string, rawButton: boolean, nativeSelect: boolean, rawThead: boolean, rawThOpen: boolean, trackedCapsTailwindFragments: boolean }} Row */

/** @returns {Generator<string>} */
function* walkRoutes(dir) {
  const ents = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of ents) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === ".next") continue;
      yield* walkRoutes(full);
    } else if (/\.(?:tsx|jsx)$/.test(ent.name)) yield full;
  }
}

/** @returns {boolean} */
function fileHasTrackedCapsCombo(snippet) {
  for (const line of snippet.split(/\r?\n/)) {
    TRACKED_CAPS_COMBO.lastIndex = 0;
    if (TRACKED_CAPS_COMBO.test(line)) return true;
  }
  return false;
}

function main() {
  const files = [...walkRoutes(appDir)];

  /** @type {Row[]} */
  const rows = [];

  for (const file of files) {
    const rel = path.relative(root, file);
    const content = fs.readFileSync(file, "utf8");

    TAG_OPEN.lastIndex = 0;
    let hasButton = false;
    let hasSelect = false;
    let hasThead = false;
    let hasTh = false;
    let m;
    while ((m = TAG_OPEN.exec(content)) !== null) {
      const tag = m[2]?.toLowerCase();
      const isClose = Boolean(m[1]);
      if (isClose) continue;
      if (tag === "button") hasButton = true;
      if (tag === "select") hasSelect = true;
      if (tag === "thead") hasThead = true;
      if (tag === "th") hasTh = true;
    }

    const tracked = fileHasTrackedCapsCombo(content);

    if (hasButton || hasSelect || hasThead || hasTh || tracked) {
      rows.push({
        file: rel,
        rawButton: hasButton,
        nativeSelect: hasSelect,
        rawThead: hasThead,
        rawThOpen: hasTh,
        trackedCapsTailwindFragments: tracked,
      });
    }
  }

  const outDir = path.join(root, "test-results", "primitive-enforcement");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "audit.json");

  const summary = {
    generatedAt: new Date().toISOString(),
    appRoot: "src/app",
    routeFilesWithAnyHit: rows.length,
    totals: {
      rawButtonRoutes: rows.filter((r) => r.rawButton).length,
      nativeSelectRoutes: rows.filter((r) => r.nativeSelect).length,
      rawTheadRoutes: rows.filter((r) => r.rawThead).length,
      rawThRouteFiles: rows.filter((r) => r.rawThOpen).length,
      trackedCapsSuspectRoutes: rows.filter((r) => r.trackedCapsTailwindFragments).length,
    },
    note: "Heuristic grep (not JSX-aware). See eslint.config `quiet-primitives` block for phased enforcement.",
    files: rows.sort((a, b) => a.file.localeCompare(b.file)),
  };

  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(
    `[primitive-enforcement] wrote ${path.relative(root, outPath)} — ${rows.length} route file(s) with ≥1 heuristic hit.`,
  );
}

main();
