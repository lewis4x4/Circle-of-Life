import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noRawColor from "./eslint-rules/no-raw-color.mjs";
import noRawSpacing from "./eslint-rules/no-raw-spacing.mjs";
import requireKpiInfo from "./eslint-rules/require-kpi-info.mjs";
import noDirectPrimitiveImport from "./eslint-rules/no-direct-primitive-import.mjs";
import primitiveEnforcementRoute from "./eslint-rules/primitive-enforcement-route.mjs";

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
]);

export default eslintConfig;
