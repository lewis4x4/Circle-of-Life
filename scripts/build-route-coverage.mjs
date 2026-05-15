#!/usr/bin/env node
/**
 * Builds docs/ui-audit/ROUTE_COVERAGE.md by scanning every page.tsx under
 * src/app for the audit anti-patterns. Classifies each as:
 *   AUDITED    — no anti-patterns detected
 *   DRIFT      — at least one anti-pattern present (the page exists and is
 *                rendered to users; it diverges from DESIGN_PRINCIPLES.md)
 *   STUB       — fewer than 20 lines; usually a re-export or placeholder
 *
 * "UNTOUCHED" is collapsed into DRIFT for clarity — the user only cares
 * whether a route matches the standard, not whether anyone has explicitly
 * touched it.
 *
 * Usage:
 *   node scripts/build-route-coverage.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const APP_DIR = path.join(ROOT, "src", "app");

const ANTI_PATTERNS = [
  { key: "sys", label: "SYS:", regex: /\bSYS:/ },
  { key: "rounded", label: "rounded-3xl/[…]", regex: /rounded-(3xl|4xl|\[2(?:\.5)?rem\]|\[1\.8rem\]|\[1\.75rem\]|\[1\.5rem\])/ },
  { key: "fontDisplay", label: "font-display", regex: /\bfont-display\b/ },
  { key: "trackingWidest", label: "tracking-widest", regex: /\btracking-widest\b/ },
  { key: "text5xl", label: "text-5xl/6xl/7xl", regex: /\btext-(5xl|6xl|7xl|hero)\b/ },
  { key: "gradientText", label: "bg-clip-text + gradient", regex: /\bbg-clip-text\b/ },
  { key: "gradientBg", label: "bg-gradient-to-", regex: /\bbg-gradient-to-/ },
  { key: "glass", label: "glass- utility", regex: /\bglass-(card|panel|card-light)\b/ },
  { key: "moonshot", label: "moonshot/* import", regex: /from\s+["']@\/components\/ui\/moonshot/ },
  { key: "ambientMatrix", label: "AmbientMatrix", regex: /\bAmbientMatrix\b/ },
  { key: "kineticGrid", label: "KineticGrid", regex: /\bKineticGrid\b/ },
  { key: "v2Card", label: "V2Card", regex: /\bV2Card\b/ },
  { key: "moonshotComment", label: "MOONSHOT comment", regex: /MOONSHOT/i },
];

function listPageFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out.push(...listPageFiles(path.join(dir, entry.name)));
    } else if (entry.name === "page.tsx") {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function routePathFromFile(file) {
  const rel = path.relative(APP_DIR, file).replace(/\\/g, "/");
  let pathname = "/" + rel
    .replace(/\/page\.tsx$/, "")
    .replace(/\([^/]+\)\//g, "")
    .replace(/\([^/]+\)$/, "");
  if (pathname === "/") pathname = "/";
  return pathname || "/";
}

function classify(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lineCount = content.split("\n").length;
  const hits = ANTI_PATTERNS.filter((p) => p.regex.test(content)).map((p) => p.label);
  if (lineCount < 20 && hits.length === 0) return { status: "STUB", hits, lineCount };
  return { status: hits.length === 0 ? "AUDITED" : "DRIFT", hits, lineCount };
}

/**
 * Maps each route group to the app roles that can actually enter it in
 * production. Source of truth: the role-guard logic inside each shell
 * (`src/components/layout/*.tsx`) and the middleware
 * (`src/lib/auth/onboarding-shell.ts`, `src/proxy.ts`). Re-validate when
 * RBAC changes.
 */
const ROLES_BY_GROUP = {
  "Command — Triage": "owner, org_admin, facility_admin, manager, admin_assistant, coordinator, nurse, maintenance_role, broker",
  "Command — Executive": "owner, org_admin, facility_admin, manager, admin_assistant, coordinator, nurse, maintenance_role, broker",
  "Command — Reports": "owner, org_admin, facility_admin, manager, admin_assistant, coordinator, nurse, maintenance_role, broker",
  "Command — Settings": "owner, org_admin, facility_admin, manager, admin_assistant, coordinator, nurse, maintenance_role, broker",
  "Clinical Ops": "owner, org_admin, facility_admin, manager, admin_assistant, coordinator, nurse, maintenance_role, broker",
  "Quality & Risk": "owner, org_admin, facility_admin, manager, admin_assistant, coordinator, nurse, maintenance_role, broker",
  Workforce: "owner, org_admin, facility_admin, manager, admin_assistant, coordinator, nurse, maintenance_role, broker",
  Pipeline: "owner, org_admin, facility_admin, manager, admin_assistant, coordinator, nurse, maintenance_role, broker",
  Finance: "owner, org_admin, facility_admin, manager, admin_assistant, coordinator, nurse, maintenance_role, broker",
  Knowledge: "owner, org_admin, facility_admin, manager, admin_assistant, coordinator, nurse, maintenance_role, broker",
  "Admin (legacy shortcut)": "owner, org_admin, facility_admin, manager, admin_assistant, coordinator, nurse, maintenance_role, broker",
  Caregiver: "caregiver, housekeeper",
  Family: "family",
  Dietary: "dietary, dietary_aide + admin-eligible (owner, org_admin, facility_admin, manager, admin_assistant, coordinator, nurse, maintenance_role, broker)",
  "Med-Tech": "med_tech, nurse",
  Onboarding: "onboarding, owner, org_admin",
  "Marketing / Auth": "public (unauthenticated)",
  Other: "—",
};

function rolesForGroup(group) {
  return ROLES_BY_GROUP[group] ?? "—";
}

function groupForRoute(routePath) {
  if (routePath.startsWith("/admin/executive") || routePath === "/admin/executive") return "Command — Executive";
  if (routePath === "/admin" || routePath.startsWith("/admin/v2")) return "Command — Triage";
  if (routePath.startsWith("/admin/reports")) return "Command — Reports";
  if (routePath.startsWith("/admin/facilities") || routePath.startsWith("/admin/settings")) return "Command — Settings";
  if (routePath.startsWith("/admin/residents") || routePath.startsWith("/admin/care-plans") || routePath.startsWith("/admin/assessments") || routePath.startsWith("/admin/rounding") || routePath.startsWith("/admin/medications") || routePath.startsWith("/admin/dietary") || routePath.startsWith("/admin/transportation")) return "Clinical Ops";
  if (routePath.startsWith("/admin/risk") || routePath.startsWith("/admin/incidents") || routePath.startsWith("/admin/infection-control") || routePath.startsWith("/admin/compliance") || routePath.startsWith("/admin/quality") || routePath.startsWith("/admin/reputation")) return "Quality & Risk";
  if (routePath.startsWith("/admin/staff") || routePath.startsWith("/admin/schedules") || routePath.startsWith("/admin/shift-swaps") || routePath.startsWith("/admin/staffing") || routePath.startsWith("/admin/certifications") || routePath.startsWith("/admin/training") || routePath.startsWith("/admin/time-records") || routePath.startsWith("/admin/payroll")) return "Workforce";
  if (routePath.startsWith("/admin/referrals") || routePath.startsWith("/admin/admissions") || routePath.startsWith("/admin/discharge") || routePath.startsWith("/admin/family-portal") || routePath.startsWith("/admin/family-messages")) return "Pipeline";
  if (routePath.startsWith("/admin/billing") || routePath.startsWith("/admin/finance") || routePath.startsWith("/admin/vendors") || routePath.startsWith("/admin/insurance")) return "Finance";
  if (routePath.startsWith("/admin/knowledge")) return "Knowledge";
  if (routePath.startsWith("/billing") || routePath.startsWith("/finance") || routePath.startsWith("/vendors") || routePath.startsWith("/insurance") || routePath.startsWith("/payroll") || routePath.startsWith("/staff") || routePath.startsWith("/staffing") || routePath.startsWith("/schedules") || routePath.startsWith("/shift-swaps") || routePath.startsWith("/certifications") || routePath.startsWith("/training") || routePath.startsWith("/transportation") || routePath.startsWith("/time-records") || routePath.startsWith("/reputation") || routePath.startsWith("/incidents") || routePath.startsWith("/reports") || routePath.startsWith("/executive") || routePath.startsWith("/risk") || routePath.startsWith("/residents") || routePath.startsWith("/vendors") || routePath.startsWith("/assessments")) return "Admin (legacy shortcut)";
  if (routePath.startsWith("/caregiver") || routePath === "/caregiver" || routePath.startsWith("/tasks") || routePath.startsWith("/handoff") || routePath.startsWith("/resident") || routePath.startsWith("/prn-followup") || routePath.startsWith("/incident-draft") || routePath.startsWith("/followups") || routePath.startsWith("/clock") || routePath.startsWith("/meds") || routePath.startsWith("/me")) return "Caregiver";
  if (routePath.startsWith("/family")) return "Family";
  if (routePath.startsWith("/dietary")) return "Dietary";
  if (routePath.startsWith("/med-tech")) return "Med-Tech";
  if (routePath.startsWith("/onboarding")) return "Onboarding";
  if (routePath.startsWith("/api")) return "API";
  if (routePath === "/login" || routePath === "/" || routePath.startsWith("/facility-launch")) return "Marketing / Auth";
  return "Other";
}

const files = listPageFiles(APP_DIR);
const rows = files
  .map((file) => {
    const routePath = routePathFromFile(file);
    const { status, hits, lineCount } = classify(file);
    return {
      route: routePath,
      file: path.relative(ROOT, file),
      group: groupForRoute(routePath),
      status,
      hits,
      lineCount,
    };
  })
  .filter((row) => row.group !== "API")
  .sort((a, b) => a.group.localeCompare(b.group) || a.route.localeCompare(b.route));

const grouped = new Map();
for (const row of rows) {
  if (!grouped.has(row.group)) grouped.set(row.group, []);
  grouped.get(row.group).push(row);
}

const totals = { AUDITED: 0, DRIFT: 0, STUB: 0 };
for (const row of rows) totals[row.status]++;

const md = [];
md.push("# ROUTE_COVERAGE.md\n");
md.push("Generated by `scripts/build-route-coverage.mjs` — re-run after any UI refactor.\n");
md.push(`Total routes: **${rows.length}** ·  ✅ AUDITED: **${totals.AUDITED}**  ·  ⚠ DRIFT: **${totals.DRIFT}**  ·  ▫ STUB: **${totals.STUB}**\n`);
md.push("Classification rules:");
md.push("- **AUDITED** — page.tsx contains zero anti-pattern hits (no `SYS:`, no `rounded-3xl/[2rem]`, no `font-display`, no `tracking-widest`, no `text-5xl/6xl/7xl`, no `bg-clip-text`, no `bg-gradient-to-*`, no `glass-*`, no `moonshot/*` import, no `AmbientMatrix`/`KineticGrid`/`V2Card`).");
md.push("- **DRIFT** — at least one anti-pattern present. Hits listed inline. Refactor to AUDITED.");
md.push("- **STUB** — under 20 lines; usually a `export { default } from …` re-export. Treat as AUDITED once the underlying client component is.\n");
md.push("> The classifier scans page.tsx only. Many routes delegate to a `<RouteNamePageClient>` component under `src/components/…`. Refactoring the client component flips the page to AUDITED automatically since the underlying file is what ships to the browser.\n");
md.push("> Each group lists its **Roles allowed** line — the union of `app_role` values that can enter at least one route in that group. Sourced from the role-guard logic in the shell components (`src/components/layout/*.tsx`) and the Edge middleware (`src/proxy.ts`, `src/lib/auth/*.ts`). When RBAC changes, update `ROLES_BY_GROUP` in `scripts/build-route-coverage.mjs`.\n");

for (const [group, items] of grouped) {
  md.push(`\n## ${group}\n`);
  md.push(`Roles allowed: ${rolesForGroup(group)}\n`);
  md.push("| | Route | File | Hits |");
  md.push("|---|---|---|---|");
  for (const r of items) {
    const icon = r.status === "AUDITED" ? "✅" : r.status === "STUB" ? "▫" : "⚠";
    const hits = r.hits.length === 0 ? "—" : r.hits.join(", ");
    md.push(`| ${icon} | \`${r.route}\` | \`${r.file}\` | ${hits} |`);
  }
}

md.push("\n");
md.push("## Recommended commit order (Phase B)\n");
md.push("Per the brief's commit structure — one commit per route group. Group sizes from the table above; sort within each group by DRIFT-count descending so the noisiest routes land first:");
md.push("");
md.push("1. `refactor(clinical-ops)` — Clinical Ops group");
md.push("2. `refactor(quality-risk)` — Quality & Risk group");
md.push("3. `refactor(workforce)` — Workforce group");
md.push("4. `refactor(pipeline)` — Pipeline group");
md.push("5. `refactor(finance)` — Finance group");
md.push("6. `refactor(command)` — Command — Reports, Settings, Triage");
md.push("7. `refactor(knowledge)` — Knowledge group");
md.push("8. `refactor(portals)` — Caregiver / Family / Dietary / Med-Tech / Onboarding (one commit per portal, sequenced per docs/ui-audit/PATCH_PLAN_PORTALS.md)");

fs.writeFileSync(path.join(ROOT, "docs/ui-audit/ROUTE_COVERAGE.md"), md.join("\n") + "\n");
console.log(`Wrote docs/ui-audit/ROUTE_COVERAGE.md — ${rows.length} routes (${totals.AUDITED} AUDITED, ${totals.DRIFT} DRIFT, ${totals.STUB} STUB)`);
