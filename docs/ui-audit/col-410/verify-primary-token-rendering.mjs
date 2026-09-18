#!/usr/bin/env node
/**
 * COL-410 evidence: prove that `*-primary-<shade>` utilities emit no CSS, and
 * that their replacements render the theme token.
 *
 * Screenshotting the two named surfaces (Care Plan Reviews Due, med-tech
 * cockpit) while authenticated would put real resident data into a committed
 * PNG — `.env.local` points at production. This asks the same question of the
 * same Tailwind theme without touching a resident record.
 *
 * The naive version of this test is circular: once the repair lands, the old
 * class names are gone from `src`, so Tailwind would not emit them whether or
 * not the theme defines the shade. So the probe writes BOTH the before and
 * after class strings into a scanned source file and compiles the project's
 * own `globals.css` over it. Anything Tailwind can express, it emits. The
 * control is `bg-emerald-600`, a stock Tailwind scale that must emit.
 *
 * Usage: node docs/ui-audit/col-410/verify-primary-token-rendering.mjs
 * Writes: computed-styles.json, before-after-{light,dark}.png
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "docs/ui-audit/col-410");

/* One row per real action site, quoting the class string as it stood on main
   (commit 04c0c866) and as it stands now. */
const CASES = [
  {
    id: "care-plan-reviews-due",
    label: 'Care Plan Reviews Due — "Review & sign"',
    file: "src/components/care-plans/CarePlanReviewsDuePageClient.tsx",
    before:
      "h-11 rounded-full px-6 font-bold uppercase tracking-wider text-[10px] bg-primary-600 text-white shadow-sm hover:bg-primary-700",
    after: "h-11 rounded-full px-6 font-bold uppercase tracking-wider text-[10px] shadow-sm",
    afterUsesButtonVariant: true,
    text: "Review & sign",
  },
  {
    id: "med-tech-resident-drawer",
    label: 'Med-tech cockpit — resident drawer "Full Chart"',
    file: "src/components/med-tech/ResidentDrawer.tsx",
    before:
      "py-2.5 px-6 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold",
    after:
      "py-2.5 px-6 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold",
    text: "Full Chart",
  },
  {
    id: "compliance-scan",
    label: 'Compliance Scan — "Run Compliance Scan"',
    file: "src/app/(admin)/admin/compliance/scan/page.tsx",
    before: "bg-primary-600 hover:bg-primary-700 text-white",
    after: "",
    afterUsesButtonVariant: true,
    text: "Run Compliance Scan",
  },
  {
    id: "unified-search",
    label: 'Unified search — "Search"',
    file: "src/app/(admin)/search/page.tsx",
    before: "h-11 shrink-0 rounded-xl bg-primary-600 px-5 text-white hover:bg-primary-500",
    after: "h-11 shrink-0 rounded-xl px-5",
    afterUsesButtonVariant: true,
    text: "Search",
  },
  {
    id: "incidents-new-retry",
    label: 'New incident — "Retry"',
    file: "src/app/(admin)/incidents/new/page.tsx",
    before: "px-6 py-3 rounded-xl bg-primary-600 text-white font-semibold hover:bg-primary-700",
    after: "",
    afterUsesButtonVariant: true,
    text: "Retry",
  },
  {
    id: "compliance-deficiencies",
    label: 'Compliance hub — "Add deficiencies"',
    file: "src/components/compliance/AdminCompliancePageClient.tsx",
    before: "text-[10px] font-mono bg-primary-600 hover:bg-primary-700 text-white",
    after: "text-[10px] font-mono",
    afterUsesButtonVariant: true,
    text: "Add deficiencies",
  },
  {
    id: "overdue-assessments-badge",
    label: "Clinical Desk — plans-needed badge (tint, not a button)",
    file: "src/components/assessments/AdminOverdueAssessmentsPageClient.tsx",
    before:
      "inline-flex items-center px-4 py-2 rounded-full border border-primary-200 bg-primary-50 text-primary-800 text-sm font-bold",
    after:
      "inline-flex items-center px-4 py-2 rounded-full border border-primary/20 bg-primary/5 text-primary text-sm font-bold",
    text: "12 Needed",
  },
];

/* Copied from buttonVariants({ variant: "default" }) in
   src/components/ui/button.tsx — the classes the variant itself supplies. */
const BUTTON_VARIANT_CLASSES =
  "inline-flex shrink-0 items-center justify-center rounded-[var(--radius)] border border-transparent text-sm font-medium h-9 gap-1.5 px-4 py-2.5 bg-primary text-primary-foreground font-semibold";

/* Utilities the probe asserts on directly. `bg-emerald-600` is the control:
   a stock Tailwind scale that must compile, proving the probe itself works. */
const PROBED_UTILITIES = [
  { cls: "bg-emerald-600", expectEmitted: true, note: "control — stock Tailwind scale" },
  { cls: "bg-primary-600", expectEmitted: false, note: "undefined shade (the defect)" },
  { cls: "bg-primary-50", expectEmitted: false, note: "undefined shade" },
  { cls: "border-primary-200", expectEmitted: false, note: "undefined shade" },
  { cls: "text-primary-800", expectEmitted: false, note: "undefined shade" },
  { cls: "bg-primary", expectEmitted: true, note: "the repair" },
  { cls: "text-primary-foreground", expectEmitted: true, note: "the repair" },
];

const afterClassesFor = (c) =>
  c.afterUsesButtonVariant ? `${BUTTON_VARIANT_CLASSES} ${c.after}`.trim() : c.after;

/* ── 1. Compile the project's theme over a source holding both families ── */

const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "col410-probe-"));
const probeHtml = path.join(probeDir, "probe.html");
const probeCss = path.join(ROOT, `.col410-probe-${process.pid}.css`);
const probeOut = path.join(probeDir, "out.css");

const sheetLayout =
  "bg-background p-8 font-sans grid grid-cols-3 gap-x-8 gap-y-6 items-center " +
  "text-foreground text-muted-foreground text-xl font-semibold text-sm text-xs mb-1 mb-6 justify-self-start justify-self-center";

fs.writeFileSync(
  probeHtml,
  [
    `<div class="${sheetLayout}"></div>`,
    ...PROBED_UTILITIES.map((u) => `<div class="${u.cls}"></div>`),
    ...CASES.flatMap((c) => [
      `<button class="${c.before}">${c.text}</button>`,
      `<button class="${afterClassesFor(c)}">${c.text}</button>`,
    ]),
  ].join("\n"),
);

fs.writeFileSync(probeCss, `@import "./src/app/globals.css";\n@source "${probeHtml}";\n`);

try {
  execFileSync("npx", ["@tailwindcss/cli", "-i", probeCss, "-o", probeOut], {
    cwd: ROOT,
    stdio: "pipe",
  });
} finally {
  fs.rmSync(probeCss, { force: true });
}

const css = fs.readFileSync(probeOut, "utf8");

const utilityFindings = PROBED_UTILITIES.map((u) => {
  const rules = (css.match(new RegExp(`\\.${u.cls.replace(/[/\\]/g, "\\$&")}[,{: ]`, "g")) ?? []).length;
  return { ...u, rules, emitted: rules > 0, ok: rules > 0 === u.expectEmitted };
});

/* ── 2. Read back computed colours, and capture the sheet ── */

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 1180, height: 760 } });
    await page.setContent(
      `<!doctype html><html class="${theme}"><head><style>${css}</style></head><body></body></html>`,
    );

    for (const c of CASES) {
      for (const phase of ["before", "after"]) {
        const classes = phase === "after" ? afterClassesFor(c) : c.before;
        const computed = await page.evaluate(
          ({ classes, text }) => {
            const el = document.createElement("button");
            el.className = classes;
            el.textContent = text;
            document.body.appendChild(el);
            const s = getComputedStyle(el);
            const out = { background: s.backgroundColor, color: s.color, borderColor: s.borderColor };
            el.remove();
            return out;
          },
          { classes, text: c.text },
        );
        results.push({
          case: c.id,
          label: c.label,
          file: c.file,
          theme,
          phase,
          classes,
          ...computed,
          rendersInvisible:
            computed.background === "rgba(0, 0, 0, 0)" || computed.background === "transparent",
        });
      }
    }

    await page.evaluate(
      ({ cases, variantClasses }) => {
        document.body.className = "bg-background p-8 font-sans";
        document.body.innerHTML =
          '<h1 class="text-foreground text-xl font-semibold mb-1">COL-410 — primary action buttons</h1>' +
          '<p class="text-muted-foreground text-sm mb-6">Left: class string as it stood on main. Right: after. One compiled stylesheet, both families scanned.</p>' +
          '<div class="grid grid-cols-3 gap-x-8 gap-y-6 items-center"></div>';
        const grid = document.querySelector("div.grid");
        for (const c of cases) {
          const before = document.createElement("div");
          before.className = "justify-self-start";
          before.innerHTML = `<button class="${c.before}">${c.text}</button>`;
          const label = document.createElement("div");
          label.className = "text-muted-foreground text-xs justify-self-center";
          label.textContent = c.label;
          const after = document.createElement("div");
          after.className = "justify-self-start";
          const afterClasses = c.afterUsesButtonVariant
            ? `${variantClasses} ${c.after}`.trim()
            : c.after;
          after.innerHTML = `<button class="${afterClasses}">${c.text}</button>`;
          grid.append(before, label, after);
        }
      },
      { cases: CASES, variantClasses: BUTTON_VARIANT_CLASSES },
    );

    await page.screenshot({ path: path.join(OUT, `before-after-${theme}.png`), fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
  fs.rmSync(probeDir, { recursive: true, force: true });
}

const beforeInvisible = results.filter((r) => r.phase === "before" && r.rendersInvisible);
const afterInvisible = results.filter((r) => r.phase === "after" && r.rendersInvisible);
const utilitiesOk = utilityFindings.every((u) => u.ok);
const pass =
  utilitiesOk &&
  afterInvisible.length === 0 &&
  beforeInvisible.length === results.filter((r) => r.phase === "before").length;

fs.writeFileSync(
  path.join(OUT, "computed-styles.json"),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      sourceSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
      status: pass ? "PASS" : "FAIL",
      utilityFindings,
      results,
    },
    null,
    2,
  ) + "\n",
);

for (const u of utilityFindings) {
  console.log(
    `${u.ok ? "ok  " : "FAIL"} ${u.cls.padEnd(24)} ${u.rules} rule(s)  — ${u.note}`,
  );
}
console.log("");
for (const r of results.filter((r) => r.theme === "light")) {
  console.log(`  [${r.phase.padEnd(6)}] ${r.case.padEnd(27)} bg=${r.background.padEnd(22)} fg=${r.color}`);
}
console.log(`\nstatus: ${pass ? "PASS" : "FAIL"}`);
process.exit(pass ? 0 : 1);
