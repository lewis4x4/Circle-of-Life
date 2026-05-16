#!/usr/bin/env node
/**
 * Homewood Lodge ALF — perf baseline (Sprint 5 of Homewood Go-Live).
 *
 * Measures per-route first-load JS sizes after a production build and writes
 * `docs/homewood/PERF_BASELINE.md` (markdown summary) plus the bundle
 * analyzer's static HTML report to `docs/homewood/bundle-analysis-<date>.html`.
 *
 * Usage:
 *   ANALYZE=true npm run build       # produce bundle analyzer html + .next
 *   npm run homewood:perf-baseline   # consume the build output, produce baseline doc
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";

const ROOT = process.cwd();
const NEXT_DIR = path.join(ROOT, ".next");
const DOCS_DIR = path.join(ROOT, "docs", "homewood");
const REPORT_PATH = path.join(DOCS_DIR, "PERF_BASELINE.md");

const HOMEWOOD_ROUTES = ["/admin/command", "/caregiver", "/family", "/med-tech", "/dietary"];
const THRESHOLD_KB = 300; // brief target: first-load JS < 300kb gzip

function bytesToKb(b) {
  return Math.round((b / 1024) * 10) / 10;
}

function readManifest() {
  const manifestPath = path.join(NEXT_DIR, "build-manifest.json");
  const appBuildManifest = path.join(NEXT_DIR, "app-build-manifest.json");
  if (existsSync(appBuildManifest)) {
    return { manifest: JSON.parse(readFileSync(appBuildManifest, "utf8")), kind: "app" };
  }
  if (existsSync(manifestPath)) {
    return { manifest: JSON.parse(readFileSync(manifestPath, "utf8")), kind: "pages" };
  }
  return null;
}

function gzipSize(filePath) {
  try {
    const buf = readFileSync(filePath);
    return zlib.gzipSync(buf, { level: 9 }).length;
  } catch {
    return 0;
  }
}

function collectChunkBytes(chunkPaths) {
  let total = 0;
  for (const rel of chunkPaths) {
    const full = path.join(NEXT_DIR, rel);
    if (existsSync(full) && statSync(full).isFile()) {
      total += gzipSize(full);
    }
  }
  return total;
}

function findBundleAnalyzerHtml() {
  const candidates = [
    path.join(NEXT_DIR, "analyze"),
    path.join(NEXT_DIR, "server", "analyze"),
  ];
  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith(".html"));
    if (files.length > 0) {
      // Prefer "client" report when both client + server are produced.
      const client = files.find((f) => f.includes("client"));
      return path.join(dir, client ?? files[0]);
    }
  }
  return null;
}

function main() {
  if (!existsSync(NEXT_DIR)) {
    console.error("[homewood:perf-baseline] FAIL: .next/ not found. Run `npm run build` (with ANALYZE=true) first.");
    process.exit(1);
  }
  const manifestResult = readManifest();

  mkdirSync(DOCS_DIR, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const htmlSource = findBundleAnalyzerHtml();
  const htmlTarget = path.join(DOCS_DIR, `bundle-analysis-${today}.html`);
  let htmlCopied = false;
  if (htmlSource) {
    try {
      copyFileSync(htmlSource, htmlTarget);
      htmlCopied = true;
    } catch (err) {
      console.warn(`[homewood:perf-baseline] could not copy bundle html: ${err.message}`);
    }
  }

  const lines = [];
  lines.push(`# Homewood Lodge ALF — Performance Baseline`);
  lines.push("");
  lines.push(`_Generated: \`${new Date().toISOString()}\`_`);
  lines.push("");
  lines.push(`This baseline reports per-route first-load JS for the 5 routes Homewood staff hit on day one. Re-generate with \`ANALYZE=true npm run build && npm run homewood:perf-baseline\`.`);
  lines.push("");
  lines.push(`## Target thresholds (documented, not gates)`);
  lines.push("");
  lines.push(`- LCP < 2.5s on simulated 4G`);
  lines.push(`- **First-load JS < ${THRESHOLD_KB}kb gzip per route**`);
  lines.push(`- No long tasks > 200ms on initial render`);
  lines.push("");
  lines.push(`## Per-route first-load JS (gzip)`);
  lines.push("");
  lines.push("| Route | First-load JS (kb gzip) | Status | Notes |");
  lines.push("|---|---:|---|---|");

  if (!manifestResult) {
    for (const route of HOMEWOOD_ROUTES) {
      lines.push(`| ${route} | — | ⚠️ no build manifest | run \`npm run build\` to populate |`);
    }
  } else {
    const { manifest, kind } = manifestResult;
    for (const route of HOMEWOOD_ROUTES) {
      // app-build-manifest format: { pages: { '/admin/command': [chunks…], … } }
      // build-manifest format: { pages: { '/admin/command': [...], 'rootMainFiles': [...] } }
      const pageChunks = manifest.pages?.[route] ?? manifest[route] ?? [];
      const sharedChunks = kind === "pages" ? manifest.rootMainFiles ?? [] : manifest.rootMainFiles ?? [];
      const allChunks = [...new Set([...sharedChunks, ...pageChunks])];
      const bytes = collectChunkBytes(allChunks);
      const kb = bytesToKb(bytes);
      const status = bytes === 0 ? "⚠️ no chunks" : kb < THRESHOLD_KB ? "✅ within threshold" : kb < THRESHOLD_KB * 1.5 ? "⚠️ over threshold" : "❌ over 50% threshold breach";
      lines.push(`| ${route} | ${kb} | ${status} | ${allChunks.length} chunks |`);
    }
  }

  lines.push("");
  lines.push(`## Bundle analyzer report`);
  lines.push("");
  if (htmlCopied) {
    lines.push(`- \`${path.basename(htmlTarget)}\` (open in a browser for treemap of every chunk)`);
  } else {
    lines.push(`- bundle analyzer HTML not found — re-run with \`ANALYZE=true npm run build\` before \`npm run homewood:perf-baseline\``);
  }
  lines.push("");
  lines.push(`## Lighthouse scores (manual)`);
  lines.push("");
  lines.push(`Lighthouse must be run manually against the 5 routes in production-mode local build. Capture Performance / Accessibility / Best Practices scores below after each run.`);
  lines.push("");
  lines.push("| Route | Performance | Accessibility | Best Practices |");
  lines.push("|---|---:|---:|---:|");
  for (const route of HOMEWOOD_ROUTES) {
    lines.push(`| ${route} | _pending_ | _pending_ | _pending_ |`);
  }
  lines.push("");
  lines.push(`## Anomalies to surface`);
  lines.push("");
  lines.push(`Any route whose first-load JS exceeds **${Math.round(THRESHOLD_KB * 1.5)}kb gzip** (50% over threshold) is flagged for code-splitting / dynamic import work. None today exceed that bound unless the table above shows \`❌\`.`);
  lines.push("");

  writeFileSync(REPORT_PATH, `${lines.join("\n")}\n`);
  console.log(`[homewood:perf-baseline] report written: ${path.relative(ROOT, REPORT_PATH)}`);
  if (htmlCopied) console.log(`[homewood:perf-baseline] bundle html: ${path.relative(ROOT, htmlTarget)}`);
}

main();
