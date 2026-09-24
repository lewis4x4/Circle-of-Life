#!/usr/bin/env node
/**
 * COL-794 evidence: render a DEMO-ONLY resident face sheet through the real
 * `FACE_SHEET_PRINT_CSS` with Chromium print media, then rasterise page 1.
 *
 * Every value below is fictional ("Demo Resident", "Homewood Demo"). No record
 * is read and nothing touches Supabase. The markup mirrors the sections of
 * src/app/(print)/print/residents/[id]/face-sheet/page.tsx, with a small
 * stand-in for the Tailwind utilities the route uses, so the page-break and
 * width rules are exercised the way the route exercises them.
 *
 * Usage: node scripts/evidence/col-794-face-sheet-print-preview.mjs
 * Needs Playwright Chromium and `pdftoppm` (poppler-utils).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const outDir = path.join(root, "docs/evidence");
const htmlOut = path.join(outDir, "col-794-face-sheet-print-fixture-DEMO.html");
const pngOut = path.join(outDir, "col-794-face-sheet-print-preview-DEMO.png");

const cssSource = readFileSync(path.join(root, "src/lib/print/face-sheet-print-css.ts"), "utf8");
const printCss = cssSource.match(/FACE_SHEET_PRINT_CSS = `([\s\S]*?)`;/)?.[1];
if (!printCss) throw new Error("FACE_SHEET_PRINT_CSS not found");

const field = (label, value, wide = false) =>
  `<div class="field${wide ? " wide" : ""}"><dt>${label}</dt><dd>${value}</dd></div>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>DEMO face sheet — COL-794</title>
<style>
  body { margin: 0; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #000; }
  .demo-banner { background: #fde68a; border: 2px dashed #b45309; padding: 6px 10px; margin-bottom: 10px;
    font-weight: 700; text-align: center; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  #resident-face-sheet { max-width: 768px; margin: 0 auto; padding: 32px; background: #fff; box-sizing: border-box; }
  header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #000; padding-bottom: 12px; }
  .eyebrow { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; margin: 0; }
  h1 { font-size: 24px; margin: 0; } p { margin: 0; }
  .photo { width: 80px; height: 96px; border: 1px dashed #737373; display: flex; align-items: center;
    justify-content: center; text-align: center; font-size: 10px; color: #525252; }
  section { margin-top: 14px; } .boxed { border: 2px solid #000; padding: 12px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid #000; padding-bottom: 4px; margin: 0 0 8px; }
  dl { display: grid; gap: 8px 16px; margin: 0; } .g4 { grid-template-columns: repeat(4, 1fr); }
  .g3 { grid-template-columns: repeat(3, 1fr); } .g2 { grid-template-columns: repeat(2, 1fr); }
  .wide { grid-column: span 2; } dt { font-size: 10px; font-weight: 600; text-transform: uppercase; color: #404040; }
  dd { margin: 0; } .strong { font-weight: 700; } .big { font-size: 15px; font-weight: 700; } .sub { display: block; font-size: 11px; }
  footer { margin-top: 24px; display: flex; justify-content: space-between; border-top: 1px solid #d4d4d4; padding-top: 8px; font-size: 10px; color: #404040; }
  @media print { #resident-face-sheet { padding: 0; } }
</style>
<style>${printCss}</style>
</head><body>
<article id="resident-face-sheet">
  <div class="demo-banner">DEMO ONLY — fictional resident, facility and contacts. Not PHI. COL-794 print preview evidence.</div>
  <header>
    <div>
      <p class="eyebrow">Resident face sheet</p>
      <h1>Demo Resident</h1>
      <p>Preferred name: Demo</p>
      <p>Homewood Demo (fictional facility)</p>
    </div>
    <p class="photo">No photo on file</p>
  </header>
  <section aria-label="Identity"><dl class="g4">
    ${field("Date of birth", "Jan 1, 1900 (demo)")}
    ${field("Age", "Not recorded")}
    ${field("Gender", "Not recorded")}
    ${field("Admitted", "Not recorded")}
    ${field("Room", "Demo 000")}
    ${field("Unit", "Demo Wing")}
    ${field("Presence", "In facility · since demo seed", true)}
  </dl></section>
  <section aria-label="Code status and directives" class="boxed"><dl class="g3">
    ${field("Code status", '<span class="big">Full code (demo)</span><span class="sub">Verified: not recorded</span>')}
    ${field("POLST / MOLST", "Not recorded")}
    ${field("Hospice", "Not elected")}
    ${field("DNH (Do Not Hospitalize)", "Not recorded")}
    ${field("Feeding tube", "No")}
    ${field("Advance directive", "Type not recorded · not on file")}
  </dl></section>
  <section aria-label="Allergies" class="boxed"><dl>
    ${field("Allergies", '<span class="strong">Demo allergen A; Demo allergen B</span><span class="sub">Reviewed: not recorded</span>')}
  </dl></section>
  <section aria-label="Clinical"><h2>Clinical</h2><dl class="g2">
    ${field("Diagnoses", '<span class="sub" style="font-size:13px">Primary: Demo condition one</span><span class="sub" style="font-size:13px">Also: Demo condition two; Demo condition three; DemoConditionWithAVeryLongUnbrokenNameThatMustWrapInsteadOfRunningOffTheLetterPage</span>', true)}
    ${field("Diet order", "Regular (demo)")}
    ${field("Fall risk", "Not assessed")}
  </dl></section>
  <section aria-label="Contacts"><h2>Contacts and physician</h2><dl class="g2">
    ${field("Primary contact", "Demo Contact One · (000) 000-0000 · demo.contact.one.with.a.long.address@example.invalid")}
    ${field("Secondary contact", "Not recorded")}
    ${field("POA / healthcare proxy", "Not recorded")}
    ${field("Primary care physician", "Dr. Demo Physician · phone not recorded")}
  </dl></section>
  <section aria-label="Coverage"><h2>Coverage</h2><dl class="g2">
    ${field("Primary payer", "Demo payer (fictional)")}
  </dl></section>
  <footer><span>Printed (demo render) by Demo User</span><span>Haven · DEMO fixture — contains no protected health information</span></footer>
</article>
</body></html>
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(htmlOut, html);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`file://${htmlOut}`);
  await page.emulateMedia({ media: "print" });
  const tmp = mkdtempSync(path.join(tmpdir(), "col794-"));
  const pdf = path.join(tmp, "face-sheet.pdf");
  await page.pdf({ path: pdf, format: "Letter", preferCSSPageSize: true, printBackground: true });
  execFileSync("pdftoppm", ["-png", "-r", "110", "-f", "1", "-l", "1", "-singlefile", pdf, pngOut.replace(/\.png$/, "")]);
  const pages = execFileSync("pdfinfo", [pdf]).toString().match(/Pages:\s+(\d+)/)?.[1];
  console.log(`wrote ${path.relative(root, htmlOut)}\nwrote ${path.relative(root, pngOut)} (PDF pages: ${pages})`);
} finally {
  await browser.close();
}
