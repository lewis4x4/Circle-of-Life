import { RuleTester } from "eslint";
import { describe, it } from "vitest";

import rule from "../../../eslint-rules/icon-button-needs-name.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const icons = 'import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";\n';

tester.run("icon-button-needs-name (COL-658)", rule, {
  valid: [
    { code: `${icons}const a = <button aria-label="Refresh"><RefreshCw /></button>;` },
    { code: `${icons}const a = <Button title="Refresh"><RefreshCw /></Button>;` },
    { code: `${icons}const a = <button><RefreshCw /> Refresh</button>;` },
    { code: `${icons}const a = <button><RefreshCw /><span className="sr-only">Refresh</span></button>;` },
    { code: `${icons}const a = <button {...props}><RefreshCw /></button>;` },
    { code: `import { Avatar } from "./avatar";\nconst a = <button><Avatar /></button>;` },
  ],
  invalid: [
    { code: `${icons}const a = <button><RefreshCw /></button>;`, errors: [{ messageId: "unnamed" }] },
    { code: `${icons}const a = <Button size="sm"><RefreshCw className="h-4" /></Button>;`, errors: [{ messageId: "unnamed" }] },
    {
      code: `${icons}const a = <button aria-expanded={open}>{open ? <ChevronDown /> : <ChevronRight />}</button>;`,
      errors: [{ messageId: "unnamed" }],
    },
  ],
});
