import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findInternalLanguage } from "@/lib/copy/internal-language";

/**
 * COL-652 — the copy guard. No user-visible text in `src` may carry a build or ticket
 * reference, an access-control note, a seed marker, a migration note, "pilot build",
 * a secret or environment-variable name, a repo path, a raw snake_case key in JSX text,
 * or developer jargon. See `internal-language.ts` for the rules.
 *
 * `REVIEWED` holds the only files allowed a finding, each with the reason it is not
 * staff-facing. Anything else fails. If a reviewed file stops matching, remove it.
 */
const REVIEWED: Record<string, { count: number; why: string }> = {
  "src/components/landing/landing-home.tsx": { count: 2, why: "Marketing landing page for buyers; not mounted by any route." },
  "src/design-system/templates/T6Settings.preview.tsx": { count: 1, why: "Design-system preview fixture; not a product route." },
  "src/lib/navigation/staff-launch-hidden.ts": { count: 1, why: "`note` is a code comment kept as data; never rendered." },
};

const ROOT = path.resolve(__dirname, "../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$|\.d\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("no internal or developer language in user-visible copy (COL-652)", () => {
  const found = new Map<string, string[]>();
  for (const file of walk(path.join(ROOT, "src"))) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    if (rel === "src/types/database.ts" || rel === "src/lib/copy/internal-language.ts") continue;
    const findings = findInternalLanguage(rel, fs.readFileSync(file, "utf8"));
    if (findings.length > 0) found.set(rel, findings.map((f) => `${rel}:${f.line} [${f.rule}] ${f.text}`));
  }

  it("no file shows staff a ticket, spec, RLS, seed, migration, secret or snake_case reference", () => {
    const over = [...found].filter(([file, list]) => list.length > (REVIEWED[file]?.count ?? 0)).flatMap(([, list]) => list);
    expect(over).toEqual([]);
  });

  it("the reviewed exceptions do not outlive the code they describe", () => {
    const stale = Object.entries(REVIEWED)
      .filter(([file, { count }]) => (found.get(file)?.length ?? 0) < count)
      .map(([file, { count }]) => `${file}: now ${found.get(file)?.length ?? 0}, reviewed ${count} — lower it`);
    expect(stale).toEqual([]);
  });
});

describe("findInternalLanguage", () => {
  const rules = (source: string, file = "x.tsx") => findInternalLanguage(file, source).map((f) => f.rule);

  it("flags the shapes the audit found", () => {
    expect(rules(`const a = <p>General ledger (Module 17).</p>;`)).toEqual(["module-ref"]);
    expect(rules(`const a = <h2>Drill Log (Slice 9F)</h2>;`)).toEqual(["slice-ref"]);
    expect(rules(`const d = "Structured RCA per spec 07";`)).toEqual(["spec-ref"]);
    expect(rules(`const d = "Must match ADP (COL-357).";`)).toEqual(["ticket-ref"]);
    expect(rules(`const d = "Live and RLS-scoped.";`)).toEqual(["access-control"]);
    expect(rules(`const d = "Not live in this pilot build.";`)).toEqual(["pilot-build"]);
    expect(rules(`const d = "Set YELP_FUSION_API_KEY on the server.";`)).toEqual(["secret-name"]);
    expect(rules(`const a = <p>Create work orders from maintenance_tickets.</p>;`)).toEqual(["snake-case-text"]);
  });

  it("ignores comments, class names, query arguments and bare identifiers", () => {
    expect(rules(`// COL-652: Module 17 RLS note\nconst a = <p className="font_mono">Ledger</p>;`)).toEqual([]);
    expect(rules(`const q = supabase.from("maintenance_tickets").select("id");`)).toEqual([]);
    expect(rules(`const k = process.env["YELP_FUSION_API_KEY"]; const n = "YELP_FUSION_API_KEY";`)).toEqual([]);
    expect(rules(`const h = request.headers.get("x-cron-secret");`)).toEqual([]);
  });
});
