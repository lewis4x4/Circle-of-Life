import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * COL-653 — clinical and financial write forms open empty.
 *
 * A category, severity, shift, resident, outcome, amount or ratio that is already chosen
 * when the form opens gets saved by whoever does not change it, and a default on a
 * regulatory record biases it. This is the no-prefill rule the quiet primitives already
 * follow (an empty picker stays empty), applied to the forms that write records.
 *
 * Every form below is checked for:
 * - a `useState` whose initial value is a non-empty literal (string, number, or a list of
 *   strings) — unless the state is listed in `uiState` as a filter/loading/toggle that
 *   never reaches the record;
 * - a placeholder that looks like a real amount ("4250.00", "1650.00"); "0.00" is a format hint;
 * - the specific prefill each form shipped with, so it cannot come back under a new name.
 *
 * Across all app code, no money input is labelled or entered in cents.
 */

const ROOT = path.resolve(__dirname, "../../..");

const RECORD_FORMS: Record<string, { uiState?: string[]; forbidden?: RegExp[] }> = {
  "src/app/(admin)/incidents/new/page.tsx": {
    forbidden: [/category:\s*"[a-z_]+"/, /severity:\s*"level_\d"/, /shift:\s*"(day|evening|night|custom)"/],
  },
  "src/app/(admin)/admin/medications/errors/new/page.tsx": {},
  "src/lib/medications/medication-error-form.ts": {
    forbidden: [/errorType:\s*"[a-z_]+"/, /severity:\s*"[a-z_]+"/, /shift:\s*"[a-z_]+"/],
  },
  "src/components/dietary/AdminDietaryPageClient.tsx": {
    uiState: ["dietOrderStatusFilter"],
    forbidden: [/meal_type:\s*"[a-z]+"/, /status:\s*"ate"/, /intake_percent:\s*"\d+"/, /residents\[0\]/],
  },
  "src/app/(admin)/admin/dietary/new/page.tsx": {},
  "src/app/(admin)/admin/infection-control/new/page.tsx": {},
  "src/app/(admin)/staffing/new/page.tsx": {},
  "src/app/(admin)/billing/rates/new/page.tsx": {},
  "src/app/(admin)/billing/invoices/opening-balance/page.tsx": {},
  "src/app/(admin)/vendors/purchase-orders/new/page.tsx": {},
  "src/app/(admin)/admin/settings/notifications/page.tsx": {
    forbidden: [/setRouteChannels\(\["/, /setRouteRoles\(\["/, /setRouteSeverity\("level_\d"\)/],
  },
  "src/app/(admin)/admin/compliance/rules/new/page.tsx": {
    uiState: ["selectedPreset"],
    forbidden: [/useState\("220"\)/],
  },
  "src/app/(admin)/admin/knowledge/seed-targets/page.tsx": { uiState: ["filter"] },
  "src/app/(admin)/training/page.tsx": { forbidden: [/Jane Supervisor/] },
  "src/app/(admin)/reputation/accounts/new/page.tsx": {},
  // COL-676: quoted care level / room, 1823 status, Medicaid stage, and the resident rate agreement.
  "src/app/(admin)/admin/admissions/[id]/page.tsx": {
    forbidden: [/setRateCareLevelDraft\("[123]"\)/, /setRateAccommodationDraft\("private"\)/, /\?\? "pending"\)/, /\?\? "prospect"\)/],
  },
  // COL-332: a tour's time, who gives it and its result are chosen, never defaulted.
  "src/components/referrals/ReferralTours.tsx": {
    forbidden: [/outcome:\s*"(completed|cancelled|no_show)"/, /ownerUserId:\s*self/],
  },
  "src/app/(admin)/residents/[id]/billing/page.tsx": {
    forbidden: [/"legacy_rate_lock" :/, /setRoomClass\("private"\)/, /Imported from current Homewood A\/R/],
  },
};

/** `const [name, setName] = useState<T>(<literal>)` with a non-empty string, a number, or a list of strings. */
const LITERAL_STATE =
  /const \[(\w+), set\w+\] = useState(?:<[^>]*>)?\(\s*(?:"[^"]+"|'[^']+'|-?\d[\d.]*|\[\s*["'])/g;

/** A placeholder that reads as an amount: digits with an optional $ and separators, but not zero. */
const AMOUNT_PLACEHOLDER = /placeholder="\$?(?!0+(?:\.0+)?")\d[\d,]*(?:\.\d+)?"/g;

/** A money field labelled or described in cents. */
const CENTS_LABEL = /[A-Za-z] \((?:in )?cents\)/i;

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("clinical and financial write forms open empty (COL-653)", () => {
  for (const [file, rules] of Object.entries(RECORD_FORMS)) {
    it(`${file} has no prefilled record value`, () => {
      const source = read(file);
      const findings: string[] = [];

      for (const match of source.matchAll(LITERAL_STATE)) {
        if (!(rules.uiState ?? []).includes(match[1])) findings.push(`prefilled state: ${match[0]}`);
      }
      for (const match of source.matchAll(AMOUNT_PLACEHOLDER)) {
        findings.push(`amount-looking placeholder: ${match[0]}`);
      }
      for (const pattern of rules.forbidden ?? []) {
        const hit = source.match(pattern);
        if (hit) findings.push(`known prefill: ${hit[0]}`);
      }

      expect(findings).toEqual([]);
    });
  }

  it("every listed UI-only state still exists (the allowance does not outlive the code)", () => {
    const stale = Object.entries(RECORD_FORMS).flatMap(([file, rules]) =>
      (rules.uiState ?? [])
        .filter((name) => !read(file).includes(`const [${name}, `))
        .map((name) => `${file}: ${name}`),
    );
    expect(stale).toEqual([]);
  });

  it("no money input in the app is labelled or entered in cents", () => {
    const findings = [path.join(ROOT, "src/app"), path.join(ROOT, "src/components")]
      .flatMap((dir) => walk(dir))
      .flatMap((file) =>
        read(path.relative(ROOT, file))
          .split(/\r?\n/)
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => CENTS_LABEL.test(line))
          .map(({ line, index }) => `${path.relative(ROOT, file)}:${index + 1} ${line.trim()}`),
      );
    expect(findings).toEqual([]);
  });
});
