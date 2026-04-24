import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noRawColor from "./eslint-rules/no-raw-color.mjs";
import noRawSpacing from "./eslint-rules/no-raw-spacing.mjs";
import requireKpiInfo from "./eslint-rules/require-kpi-info.mjs";

const uiV2Plugin = {
  rules: {
    "no-raw-color": noRawColor,
    "no-raw-spacing": noRawSpacing,
    "require-kpi-info": requireKpiInfo,
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
    files: ["src/design-system/components/**/*.{ts,tsx}", "src/app/(admin)/v2/**/*.{ts,tsx}"],
    plugins: {
      "ui-v2": uiV2Plugin,
    },
    rules: {
      "ui-v2/no-raw-color": "error",
      "ui-v2/no-raw-spacing": "error",
      "ui-v2/require-kpi-info": "error",
    },
  },
]);

export default eslintConfig;
