import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FACILITY_ROUTES } from "@/lib/executive/facility-overview-model";

/**
 * COL-641: "View deficiencies" pointed at /admin/compliance/deficiencies, a folder with
 * only [id]/, analysis/ and new/ pages, so every drill-down load 404'd (and its prefetch
 * logged a 404). Every href the facility overview model builds must resolve to a page.
 */

const APP_DIR = path.resolve(__dirname, "../../app");
const MODEL_FILE = path.resolve(__dirname, "facility-overview-model.ts");
const SAMPLE_ID = "11111111-1111-4111-8111-111111111111";

function pageRoutes(dir: string, segments: string[] = []): string[][] {
  const routes: string[][] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "api" && segments.length === 0) continue;
      // Route groups and parallel-route slots do not appear in the URL.
      const urlSegment = /^\(.*\)$/.test(entry.name) || entry.name.startsWith("@") ? [] : [entry.name];
      routes.push(...pageRoutes(path.join(dir, entry.name), [...segments, ...urlSegment]));
    } else if (entry.name === "page.tsx") {
      routes.push(segments);
    }
  }
  return routes;
}

const ROUTES = pageRoutes(APP_DIR);

function matches(pattern: string[], parts: string[]): boolean {
  if (pattern.length === 0) return parts.length === 0;
  const [head, ...rest] = pattern;
  if (/^\[\[\.\.\..+\]\]$/.test(head)) return true;
  if (/^\[\.\.\..+\]$/.test(head)) return parts.length > 0;
  if (parts.length === 0) return false;
  if (/^\[.+\]$/.test(head) || head === parts[0]) return matches(rest, parts.slice(1));
  return false;
}

function resolvesToPage(href: string): boolean {
  const pathname = href.split(/[?#]/)[0];
  const parts = pathname.split("/").filter(Boolean);
  return ROUTES.some((pattern) => matches(pattern, parts));
}

/** Every absolute app path written in the model, with template expressions filled in. */
function hrefsInModelSource(): string[] {
  const source = fs.readFileSync(MODEL_FILE, "utf8");
  const literals = [...source.matchAll(/["'`](\/admin[^"'`\s]*)["'`]/g)].map((m) => m[1]);
  return literals.map((href) => href.replace(/\$\{[^}]+\}/g, SAMPLE_ID));
}

describe("facility overview links (COL-641)", () => {
  it("resolves every FACILITY_ROUTES href to an existing page", () => {
    const dead = Object.entries(FACILITY_ROUTES)
      .filter(([, href]) => !resolvesToPage(href))
      .map(([key, href]) => `${key}: ${href}`);
    expect(dead).toEqual([]);
  });

  it("resolves every path literal in the model source to an existing page", () => {
    const hrefs = hrefsInModelSource();
    expect(hrefs.length).toBeGreaterThan(Object.keys(FACILITY_ROUTES).length);
    expect(hrefs.filter((href) => !resolvesToPage(href))).toEqual([]);
  });

  it("does not resolve the old deficiencies path, which has no index page", () => {
    expect(resolvesToPage("/admin/compliance/deficiencies")).toBe(false);
    expect(resolvesToPage(`/admin/compliance/deficiencies/${SAMPLE_ID}`)).toBe(true);
  });

  it("lands 'View deficiencies' on the compliance hub's open-deficiency list", () => {
    const [pathname, anchor] = FACILITY_ROUTES.deficiencies.split("#");
    expect(pathname).toBe("/admin/compliance");
    const hub = fs.readFileSync(path.resolve(__dirname, "../../components/compliance/AdminCompliancePageClient.tsx"), "utf8");
    expect(hub).toContain(`id="${anchor}"`);
  });
});
