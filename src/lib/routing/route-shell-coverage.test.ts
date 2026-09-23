import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ADMIN_ALIAS_SEGMENTS, LEGACY_REDIRECTS } from "@/lib/routing/legacy-redirects";

/**
 * COL-644: /risk, /risk/survey-bundle and /pipeline/discharge-management rendered their
 * page bodies with no header, nav or facility selector. The admin shell is mounted only
 * by `(admin)/admin/layout.tsx`, so any URL that reaches an admin page some other way
 * must redirect into `/admin/...` — or be a route that deliberately owns its own shell.
 */

const APP_DIR = path.resolve(__dirname, "../../app");
const ADMIN_GROUP = path.join(APP_DIR, "(admin)");

function isDir(p: string): boolean {
  return fs.existsSync(p) && fs.statSync(p).isDirectory();
}

function pagesUnder(dir: string, segments: string[] = []): string[][] {
  const out: string[][] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const urlSegment = /^\(.*\)$/.test(entry.name) ? [] : [entry.name];
      out.push(...pagesUnder(path.join(dir, entry.name), [...segments, ...urlSegment]));
    } else if (entry.name === "page.tsx") {
      out.push(segments);
    }
  }
  return out;
}

/** Matches a concrete path against a next.config redirect `source` (`:param`, `:path*`). */
function sourceMatches(source: string, pathname: string): boolean {
  const pattern = source
    .split("/")
    .map((part) => {
      if (part === ":path*") return "(?:/.*)?";
      if (part.startsWith(":")) return "/[^/]+";
      return part ? `/${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` : "";
    })
    .join("");
  return new RegExp(`^${pattern}$`).test(pathname);
}

function redirectFor(pathname: string) {
  return LEGACY_REDIRECTS.find((r) => sourceMatches(r.source, pathname)) ?? null;
}

function resolveDestination(source: string, destination: string, pathname: string): string {
  if (!source.endsWith("/:path*")) return destination;
  const prefix = source.slice(0, -"/:path*".length);
  return destination.replace("/:path*", pathname.slice(prefix.length));
}

const ADMIN_PAGES = pagesUnder(path.join(ADMIN_GROUP, "admin"), ["admin"]).map((s) => `/${s.join("/")}`);

function isAdminShellPage(pathname: string): boolean {
  const parts = pathname.split("?")[0].split("/").filter(Boolean);
  return ADMIN_PAGES.some((page) => {
    const pattern = page.split("/").filter(Boolean);
    return pattern.length === parts.length && pattern.every((p, i) => /^\[.+\]$/.test(p) || p === parts[i]);
  });
}

/**
 * Top-level `src/app` folders outside the `(admin)` group, and why each is allowed to
 * render without the admin shell. A new folder fails until it is classified here.
 */
const TOP_LEVEL_ROUTES: Record<string, string> = {
  // Public marketing / sign-in surfaces.
  about: "public",
  "assessment-quiz": "public",
  campuses: "public",
  "care-services": "public",
  contact: "public",
  pricing: "public",
  tour: "public",
  login: "public",
  "reset-password": "public",
  "stand-up-connector": "public connector landing, own layout",
  kiosk: "shared-device kiosk, deliberately chrome-less",
  api: "route handlers, no pages",
  // Authenticated surfaces that deliberately own their own chrome.
  "change-password": "forced password change gate; no navigation until the password is changed",
  "facility-launch": "static launch app with its own global styles (see admin-shell.ts)",
  // Legacy aliases: every page must redirect (checked below).
  pipeline: "aliases into /admin",
  "employee-file": "self-service; employee-file/layout.tsx mounts the signed-in role's own shell (COL-654)",
};

describe("route shell coverage (COL-644)", () => {
  it("redirects every (admin) short path that mirrors an /admin page", () => {
    const mirrored = fs
      .readdirSync(ADMIN_GROUP)
      .filter((name) => name !== "admin" && isDir(path.join(ADMIN_GROUP, name)))
      .filter((name) => isDir(path.join(ADMIN_GROUP, "admin", name)));
    const aliases = new Set<string>(ADMIN_ALIAS_SEGMENTS);
    expect(mirrored.filter((name) => !aliases.has(name))).toEqual([]);
  });

  it("sends every page under an (admin) short path into a page inside the admin shell", () => {
    const unshelled: string[] = [];
    for (const name of fs.readdirSync(ADMIN_GROUP)) {
      const dir = path.join(ADMIN_GROUP, name);
      if (name === "admin" || !isDir(dir)) continue;
      for (const segments of pagesUnder(dir, [name])) {
        const pathname = `/${segments.join("/")}`;
        const redirect = redirectFor(pathname);
        const target = redirect ? resolveDestination(redirect.source, redirect.destination, pathname) : null;
        if (!target || !isAdminShellPage(target)) unshelled.push(`${pathname} -> ${target ?? "(no redirect)"}`);
      }
    }
    expect(unshelled).toEqual([]);
  });

  it("classifies every top-level route folder outside the (admin) group", () => {
    const unclassified = fs
      .readdirSync(APP_DIR)
      .filter((name) => isDir(path.join(APP_DIR, name)) && !/^\(.*\)$/.test(name))
      .filter((name) => !(name in TOP_LEVEL_ROUTES));
    expect(unclassified).toEqual([]);
  });

  it("makes every /pipeline page a redirect into /admin", () => {
    const rendered: string[] = [];
    for (const segments of pagesUnder(path.join(APP_DIR, "pipeline"), ["pipeline"])) {
      const pathname = `/${segments.join("/")}`;
      if (redirectFor(pathname.replace(/\[[^\]]+\]/g, "x"))) continue;
      const source = fs.readFileSync(path.join(APP_DIR, ...segments, "page.tsx"), "utf8");
      if (!/router\.replace\(\s*[`"'(]?[^)]*\/admin\//.test(source)) rendered.push(pathname);
    }
    expect(rendered).toEqual([]);
  });

  it.each([
    ["/risk", "/admin/risk"],
    ["/risk/survey-bundle", "/admin/risk/survey-bundle"],
    ["/search", "/admin/search"],
    ["/assessments/overdue", "/admin/assessments/overdue"],
    ["/pipeline/discharge-management", "/admin/discharge"],
    ["/pipeline/discharge-management/new-reconciliation", "/admin/discharge/new"],
    ["/pipeline/discharge-transition", "/admin/discharge"],
    ["/clinical/residents", "/admin/residents"],
    ["/clinical/residents/abc", "/admin/residents/abc"],
    ["/clinical/residents/add", "/admin/residents/new"],
    ["/admin/finance/close", "/admin/finance/period-close"],
  ])("permanently redirects %s to %s", (from, to) => {
    const redirect = redirectFor(from);
    expect(redirect).not.toBeNull();
    expect(resolveDestination(redirect!.source, redirect!.destination, from)).toBe(to);
    expect(isAdminShellPage(to)).toBe(true);
    if (from !== "/pipeline/discharge-transition") expect(redirect!.permanent).toBe(true);
  });
});

describe("floor app short paths (COL-654)", () => {
  it.each([
    ["/clock", "/caregiver/clock"],
    ["/me", "/caregiver/me"],
    ["/tasks", "/caregiver/tasks"],
    ["/resident/abc/log", "/caregiver/resident/abc/log"],
  ])("permanently redirects %s to %s", (from, to) => {
    const redirect = redirectFor(from);
    expect(redirect?.permanent).toBe(true);
    expect(resolveDestination(redirect!.source, redirect!.destination, from)).toBe(to);
    expect(fs.existsSync(path.join(APP_DIR, "(caregiver)", ...to.replace(/abc/, "[id]").split("/").filter(Boolean), "page.tsx"))).toBe(true);
  });
});
