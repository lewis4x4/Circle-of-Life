import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noRawColor from "./eslint-rules/no-raw-color.mjs";
import noRawSpacing from "./eslint-rules/no-raw-spacing.mjs";
import requireKpiInfo from "./eslint-rules/require-kpi-info.mjs";
import noDirectPrimitiveImport from "./eslint-rules/no-direct-primitive-import.mjs";
import primitiveEnforcementRoute from "./eslint-rules/primitive-enforcement-route.mjs";
import requireTimeZone from "./eslint-rules/require-time-zone.mjs";
import noAdhocBackLink from "./eslint-rules/no-adhoc-back-link.mjs";
import iconButtonNeedsName from "./eslint-rules/icon-button-needs-name.mjs";

const uiV2Plugin = {
  rules: {
    "no-raw-color": noRawColor,
    "no-raw-spacing": noRawSpacing,
    "require-kpi-info": requireKpiInfo,
    "no-direct-primitive-import": noDirectPrimitiveImport,
  },
};

const quietOperatorPrimitivesPlugin = {
  rules: {
    "enforce-route-markup-quiet-operator": primitiveEnforcementRoute,
  },
};

const havenTimePlugin = {
  rules: {
    "require-time-zone": requireTimeZone,
  },
};

const havenBackLinkPlugin = {
  rules: {
    "no-adhoc-back-link": noAdhocBackLink,
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    ".sfdx/**",
    "next-env.d.ts",
    // Local agent tooling (CommonJS specs, Playwright runners)
    ".agents/**",
    "scripts/**",
  ]),
  {
    // Baseline: eslint-plugin-react-hooks 7 (via eslint-config-next 16) added
    // the React Compiler rules, which flag 420 pre-existing patterns across
    // 242 files (mostly `useEffect(() => { void load(); }, [load])`). They are
    // switched off here for the legacy surface so `npm run lint` reflects new
    // work, and re-enabled below for the 07A care-events code, which passes
    // them. Remove entries from this block as the legacy surfaces are migrated.
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    // These two carry their own justified per-rule disables; keep the rules
    // live there so those directives stay in use.
    ignores: ["src/design-system/components/DataTable/DataTable.tsx", "src/hooks/useHeldRoleHomeChrome.ts"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/static-components": "off",
    },
  },
  {
    // Spec 07A surfaces keep the React Compiler rules as errors.
    files: [
      "src/components/care-events/**/*.{ts,tsx}",
      "src/components/incidents/IncidentsTodayStrip.tsx",
      "src/components/incidents/IncidentCareEventNotifications.tsx",
      "src/lib/care-events/**/*.{ts,tsx}",
      "src/lib/offline/**/*.{ts,tsx}",
      "src/app/api/care-events/**/*.{ts,tsx}",
      "src/app/(caregiver)/caregiver/report/**/*.{ts,tsx}",
      "src/app/(caregiver)/caregiver/resident/[id]/timeline/**/*.{ts,tsx}",
      "src/app/(admin)/admin/care-events/**/*.{ts,tsx}",
      "src/app/(admin)/admin/residents/[id]/timeline/**/*.{ts,tsx}",
      "src/app/(admin)/incidents/reports-log/**/*.{ts,tsx}",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/preserve-manual-memoization": "error",
      "react-hooks/purity": "error",
      "react-hooks/immutability": "error",
      "react-hooks/refs": "error",
      "react-hooks/incompatible-library": "error",
      "react-hooks/static-components": "error",
    },
  },
  {
    files: [
      "src/design-system/components/**/*.{ts,tsx}",
      "src/design-system/templates/**/*.{ts,tsx}",
      "src/app/(admin)/admin/v2/**/*.{ts,tsx}",
      "src/app/(admin)/v2/**/*.{ts,tsx}",
    ],
    plugins: {
      "ui-v2": uiV2Plugin,
    },
    rules: {
      "ui-v2/no-raw-color": "error",
      "ui-v2/no-raw-spacing": "error",
      "ui-v2/require-kpi-info": "error",
    },
  },
  {
    // Phase 2: widen to `"src/app/**/*.{ts,tsx,js,jsx}"` after legacy routes migrate
    // (see `npm run audit:primitive-enforcement` counts + backlog issues).
    files: ["src/app/(admin)/admin/referrals/hl7-inbound/**/*.{ts,tsx,js,jsx}"],
    plugins: {
      "quiet-primitives": quietOperatorPrimitivesPlugin,
    },
    rules: {
      "quiet-primitives/enforce-route-markup-quiet-operator": "error",
    },
  },
  {
    // S7+: pages under /admin/v2 must compose via templates, not import primitives.
    // The dev preview surface intentionally references the primitive registry
    // (`design-preview/**`), so it is excluded.
    files: ["src/app/(admin)/admin/v2/**/*.{ts,tsx}"],
    ignores: ["src/app/(admin)/admin/v2/design-preview/**"],
    plugins: {
      "ui-v2": uiV2Plugin,
    },
    rules: {
      "ui-v2/no-direct-primitive-import": "error",
    },
  },
  {
    // COL-659: display dates must name their time zone. Pre-existing call sites
    // are baselined in `eslint-suppressions.json`; convert them to
    // `@/lib/format/datetime` and prune.
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    ignores: ["src/**/*.test.{ts,tsx}", "src/**/*.spec.{ts,tsx}"],
    plugins: {
      "haven-time": havenTimePlugin,
    },
    rules: {
      "haven-time/require-time-zone": "error",
    },
  },
  {
    // COL-656: one back-link style. Pre-existing ad-hoc back links are
    // baselined in `eslint-suppressions.json`; convert them to BackLink and prune.
    files: ["src/**/*.{tsx,jsx}"],
    ignores: ["src/**/*.test.tsx", "src/**/*.spec.tsx", "src/design-system/components/BackLink/**"],
    plugins: {
      "haven-back-link": havenBackLinkPlugin,
    },
    rules: {
      "haven-back-link/no-adhoc-back-link": "error",
    },
  },
  {
    // React Compiler is not enabled in this app. `incompatible-library` only
    // warns that React Hook Form's `watch()` could not be auto-memoized by the
    // compiler; with no compiler there is nothing to act on, and warnings fail
    // `--max-warnings 0`. Revisit when the compiler is switched on.
    rules: {
      "react-hooks/incompatible-library": "off",
    },
  },
  {
    // COL-658: a visible <label> must name its control — either `htmlFor` the
    // control's `id`, or wrap the control. A sibling label with neither leaves
    // the select/input unnamed for screen readers (axe `label` / `select-name`,
    // critical). Pre-existing violations are recorded in eslint-suppressions.json
    // and are being fixed route by route; new ones fail lint.
    files: ["src/**/*.{tsx,jsx}"],
    rules: {
      "jsx-a11y/label-has-associated-control": [
        "error",
        {
          labelComponents: ["Label", "FormLabel"],
          controlComponents: [
            "Input",
            "Textarea",
            "Select",
            "SelectTrigger",
            "Checkbox",
            "Switch",
            "NumberInput",
            "DateInput",
            "Combobox",
          ],
          assert: "either",
          depth: 4,
        },
      ],
    },
  },
  {
    // COL-658: icon-only buttons must carry an accessible name. The Button
    // primitive's icon sizes and SelectTrigger enforce this in their types;
    // this covers native <button> and non-icon-size <Button>.
    files: ["src/**/*.{tsx,jsx}"],
    plugins: {
      a11y: { rules: { "icon-button-needs-name": iconButtonNeedsName } },
    },
    rules: {
      "a11y/icon-button-needs-name": "error",
    },
  },
]);

// Pre-existing React Compiler-rule violations (react-hooks/set-state-in-effect
// and friends, ~420 on 2026-09-15) are recorded in `eslint-suppressions.json`
// (ESLint bulk suppressions). Lint fails only on NEW violations. After fixing
// some, run `npx eslint src --prune-suppressions` so the ratchet only tightens;
// never `--suppress-all` again without a review of what it would hide.
// `npm run lint` passes `--pass-on-unpruned-suppressions` because the compiler
// rules report slightly fewer findings on the CI runner than on a Mac checkout
// (2026-09-16: CI failed only on "suppressions left that do not occur"), and a
// suppression that is no longer needed is not a defect.

export default eslintConfig;
