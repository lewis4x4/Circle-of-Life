import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PILLARS } from "@/lib/navigation/pillars";
import { LEGACY_REDIRECTS } from "@/lib/routing/legacy-redirects";

/**
 * COL-707: Brian's rulings (2026-09-23) on pages that did the same job twice. The loser
 * URL 308s to the winner, no page renders at the loser, and no nav entry links to it.
 */
const RULINGS: { loser: string; winner: string }[] = [
  { loser: "/admin/cash", winner: "/admin/finance/trust" },
  { loser: "/admin/vendors/new", winner: "/admin/vendors/directory" },
];

const APP_ADMIN = path.resolve(__dirname, "../../app/(admin)/admin");
const SHELL_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../../components/layout/AdminShell.tsx"),
  "utf8",
);

describe("COL-707 canonical surfaces", () => {
  it("no admin page is only a redirect() call; server redirects live in LEGACY_REDIRECTS", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "page.tsx") {
          const body = fs.readFileSync(full, "utf8");
          const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
          if (/^\s*import \{ redirect \} from "next\/navigation";\s*export default (?:async )?function \w+\(\) \{\s*redirect\("[^"]+"\);\s*\}\s*$/.test(code)) {
            offenders.push(path.relative(APP_ADMIN, full));
          }
        }
      }
    };
    walk(APP_ADMIN);
    expect(offenders).toEqual([]);
  });

  for (const { loser, winner } of RULINGS) {
    it(`${loser} permanently redirects to ${winner}`, () => {
      const rule = LEGACY_REDIRECTS.find((r) => r.source === loser);
      expect(rule).toEqual({ source: loser, destination: winner, permanent: true });
    });

    it(`${loser} has no page of its own`, () => {
      const dir = path.join(APP_ADMIN, loser.replace(/^\/admin\/?/, ""));
      expect(fs.existsSync(path.join(dir, "page.tsx"))).toBe(false);
    });

    it(`no nav entry links to ${loser}`, () => {
      const hrefs = PILLARS.flatMap((pillar) => pillar.items.map((item) => item.href));
      expect(hrefs).not.toContain(loser);
      expect(SHELL_SOURCE).not.toContain(`href: "${loser}"`);
    });
  }
});
