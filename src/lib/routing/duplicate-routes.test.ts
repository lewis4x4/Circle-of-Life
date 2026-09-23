import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LEGACY_REDIRECTS, RETIRED_V2_SEGMENTS } from "@/lib/routing/legacy-redirects";

/**
 * COL-654: the audit found the same page body served at two or three live URLs
 * (`/admin/v2/*` re-exporting `/admin/*`, `/admin/finance/close` re-exporting period
 * close, `/clock` beside `/caregiver/clock`). A page file that only re-exports another
 * page is fine when one of the two URLs redirects (the `(admin)/<segment>` mirrors all
 * 308 into `/admin/...`); it is a duplicate when both URLs still render.
 */

const SRC_DIR = path.resolve(__dirname, "../..");
const APP_DIR = path.join(SRC_DIR, "app");
const RE_EXPORT = /^\s*(?:\/\/[^\n]*\n\s*)*export \{ default(?: as \w+)? \} from "([^"]+)";?\s*$/;

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pageFiles(full));
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

/** URL of an app-router page file: route groups dropped, dynamic segments kept as `[x]`. */
function urlOf(pageFile: string): string {
  const rel = path.relative(APP_DIR, path.dirname(pageFile));
  const parts = rel.split(path.sep).filter((p) => p && !/^\(.*\)$/.test(p));
  return `/${parts.join("/")}`;
}

function resolveTarget(pageFile: string, specifier: string): string {
  const base = specifier.startsWith("@/")
    ? path.join(SRC_DIR, specifier.slice(2))
    : path.resolve(path.dirname(pageFile), specifier);
  return base.endsWith(".tsx") ? base : `${base}.tsx`;
}

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

function isRedirected(url: string): boolean {
  const concrete = url.replace(/\[[^\]]+\]/g, "x");
  return LEGACY_REDIRECTS.some((r) => sourceMatches(r.source, concrete));
}

/** Follows `export { default } from` chains to the file that actually implements the page. */
function implementationOf(file: string, seen = new Set<string>()): string {
  if (seen.has(file) || !fs.existsSync(file)) return file;
  seen.add(file);
  const match = fs.readFileSync(file, "utf8").match(RE_EXPORT);
  if (!match) return file;
  const target = resolveTarget(file, match[1]);
  return path.basename(target) === "page.tsx" ? implementationOf(target, seen) : file;
}

/** Every page body reachable at more than one live (non-redirected) URL, as "a = b". */
export function liveDuplicatePages(): string[] {
  const urlsByImplementation = new Map<string, string[]>();
  for (const file of pageFiles(APP_DIR)) {
    const url = urlOf(file);
    if (isRedirected(url)) continue;
    const impl = implementationOf(file);
    urlsByImplementation.set(impl, [...(urlsByImplementation.get(impl) ?? []), url]);
  }
  const duplicates: string[] = [];
  for (const urls of urlsByImplementation.values()) {
    const unique = [...new Set(urls)].sort();
    if (unique.length > 1) duplicates.push(unique.join(" = "));
  }
  return duplicates.sort();
}

/**
 * Duplicates that still exist, each owned by a named follow-up. The list may only
 * shrink: remove an entry when its duplicate is resolved.
 */
const KNOWN_DUPLICATES: Record<string, string> = {
  // Role shells deliberately share the self-service page inside their own chrome.
  "/admin/acknowledgments/my = /caregiver/acknowledgments = /dietary/acknowledgments":
    "one self-service page mounted in three role shells",
};

describe("duplicate URL trees (COL-654)", () => {
  it("serves no page body at two live URLs", () => {
    const unexpected = liveDuplicatePages().filter((d) => !(d in KNOWN_DUPLICATES));
    expect(unexpected).toEqual([]);
  });

  it("keeps the known-duplicate list honest", () => {
    const live = new Set(liveDuplicatePages());
    expect(Object.keys(KNOWN_DUPLICATES).filter((d) => !live.has(d))).toEqual([]);
  });
});

describe("retired /admin/v2 tree (COL-654)", () => {
  const V2_DIR = path.join(APP_DIR, "(admin)", "admin", "v2");

  it("renders nothing under /admin/v2 except the flag-gated design preview", () => {
    const rendered = pageFiles(V2_DIR)
      .map(urlOf)
      .filter((url) => !url.startsWith("/admin/v2/design-preview"));
    expect(rendered).toEqual([]);
  });

  it.each([
    ["/admin/v2", "/admin"],
    ["/admin/v2/executive", "/admin/executive"],
    ["/admin/v2/executive/standup", "/admin/executive/standup"],
    ["/admin/v2/executive/facility/abc", "/admin/executive/facility/abc"],
    ["/admin/v2/executive/alerts/al-1", "/admin/executive/alerts"],
    ["/admin/v2/residents/abc", "/admin/residents/abc"],
    ["/admin/v2/settings/audit-log", "/admin/settings/audit-log"],
    ["/admin/v2/finance/trial-balance", "/admin/finance/trial-balance"],
  ])("308s %s to %s", (from, to) => {
    const redirect = LEGACY_REDIRECTS.find((r) => sourceMatches(r.source, from));
    expect(redirect?.permanent).toBe(true);
    const target = redirect!.source.endsWith("/:path*")
      ? redirect!.destination.replace("/:path*", from.slice(redirect!.source.length - "/:path*".length))
      : redirect!.destination;
    expect(target).toBe(to);
  });

  it("never redirects the design preview", () => {
    expect(isRedirected("/admin/v2/design-preview")).toBe(false);
    expect(isRedirected("/admin/v2/design-preview/panel")).toBe(false);
    expect(RETIRED_V2_SEGMENTS).not.toContain("design-preview");
  });
});
