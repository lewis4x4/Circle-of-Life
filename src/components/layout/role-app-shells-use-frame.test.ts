/**
 * COL-714: one layout for all staff and family apps. Every role-app shell renders
 * `RoleAppFrame` and none hand-builds its own header or tab bar. The pending list
 * holds the shells not yet converted; it may only shrink.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROLE_APP_SHELLS = [
  "src/components/layout/CaregiverShell.tsx",
  "src/components/layout/MedTechShell.tsx",
  "src/components/layout/DietaryShell.tsx",
  "src/components/layout/FamilyShell.tsx",
] as const;

const PENDING: readonly string[] = [
  "src/components/layout/CaregiverShell.tsx",
  "src/components/layout/MedTechShell.tsx",
  "src/components/layout/DietaryShell.tsx",
  "src/components/layout/FamilyShell.tsx",
];

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

function usesFrame(source: string): boolean {
  return /from "@\/design-system\/components\/RoleAppFrame"/.test(source) && /<RoleAppFrame\b/.test(source);
}

function handBuildsChrome(source: string): boolean {
  return /<header\b/.test(source) || /<BottomNav\b/.test(source) || /<nav\b/.test(source);
}

describe("role-app shells use the shared RoleAppFrame", () => {
  for (const file of ROLE_APP_SHELLS) {
    if (PENDING.includes(file)) {
      it(`${file} is still pending conversion (drop it from PENDING once converted)`, () => {
        expect(usesFrame(read(file))).toBe(false);
      });
      continue;
    }
    it(`${file} renders RoleAppFrame and no chrome of its own`, () => {
      const source = read(file);
      expect(usesFrame(source)).toBe(true);
      expect(handBuildsChrome(source)).toBe(false);
    });
  }
});
