import ts from "typescript";

/**
 * COL-652 — words staff should never read.
 *
 * Production screens carried build and ticket references ("Module 17", "Slice 9F", "spec 07",
 * "COL-357"), access-control notes ("RLS-scoped"), seed markers, migration notes, "pilot
 * build", environment-variable and secret names, and raw snake_case keys. Each rule below
 * names one of those shapes. `findInternalLanguage` reads a source file's user-visible text
 * (string literals, template text and JSX text, never comments, imports, class names or
 * query arguments) and returns every match.
 */
export type InternalLanguageRule = {
  id: string;
  pattern: RegExp;
  /** Only JSX text is checked (for shapes that are legitimate inside code strings). */
  jsxTextOnly?: boolean;
  /** Only text containing a space is checked: a bare identifier string is code, a sentence is copy. */
  proseOnly?: boolean;
};

export const INTERNAL_LANGUAGE_RULES: InternalLanguageRule[] = [
  { id: "module-ref", pattern: /\bModule \d+\b/ },
  { id: "slice-ref", pattern: /\bSlice \d+[A-Z]?\b/ },
  { id: "spec-ref", pattern: /\bspec \d+\b/i },
  { id: "ticket-ref", pattern: /\bCOL-(?:\d+|[A-Z]+-\d+)\b/ },
  { id: "access-control", pattern: /\b(?:RLS|RBAC)\b/ },
  { id: "seed-marker", pattern: /\[seed:|\bAcceptance seed\b/i },
  { id: "migration-ref", pattern: /\bmigration \d+/i },
  { id: "developer-note", pattern: /\bUI should\b/ },
  { id: "pilot-build", pattern: /\bpilot build\b/i },
  { id: "secret-name", pattern: /\b[A-Z][A-Z0-9]*_[A-Z0-9_]*(?:SECRET|API_KEY|TOKEN|PASSWORD)\b/, proseOnly: true },
  { id: "build-tier", pattern: /\b(?:remain|remains|Enhanced) (?:Enhanced|sync jobs)\b|\bout of Core scope\b|\bin a later iteration\b/ },
  { id: "tech-jargon", pattern: /\b(?:UUID|Idempotency|idempotent|application-layer|org-scoped|Storage bucket|SQL editor|schema cache|PostgREST|service role)\b/, proseOnly: true },
  { id: "repo-path", pattern: /\bdocs\/specs\/|\bx-cron-secret\b/ },
  { id: "snake-case-text", pattern: /\b[a-z][a-z0-9]*_[a-z0-9_]*[a-z0-9]\b/, jsxTextOnly: true },
];

export type InternalLanguageFinding = { rule: string; line: number; text: string };

/** Call names whose string arguments are data-layer identifiers, not copy. */
const CODE_CALLS = new Set([
  "from",
  "select",
  "rpc",
  "eq",
  "neq",
  "in",
  "is",
  "order",
  "channel",
  "require",
  "cn",
  "clsx",
  "cva",
  "getItem",
  "setItem",
  "removeItem",
  "fetch",
  "get",
  "push",
  "replace",
  "redirect",
  "startsWith",
  "includes",
  "matches",
  "test",
]);

/** JSX attributes whose values are code, not copy. */
const CODE_ATTRIBUTES = new Set(["className", "href", "id", "htmlFor", "name", "type", "data-testid", "key", "value", "src", "role"]);

function isCodeString(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) return true;
  if (ts.isLiteralTypeNode(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isElementAccessExpression(parent)) return true;
  if (ts.isCaseClause(parent)) return true;
  if (ts.isBinaryExpression(parent) && /^(===|!==|==|!=)$/.test(parent.operatorToken.getText())) return true;
  if (ts.isJsxAttribute(parent) && CODE_ATTRIBUTES.has(parent.name.getText())) return true;
  if (ts.isCallExpression(parent)) {
    const callee = parent.expression;
    const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
    if (CODE_CALLS.has(name)) return true;
  }
  if (ts.isJsxExpression(parent) && parent.parent && ts.isJsxAttribute(parent.parent)) {
    return CODE_ATTRIBUTES.has(parent.parent.name.getText());
  }
  return false;
}

export function findInternalLanguage(fileName: string, source: string): InternalLanguageFinding[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const findings: InternalLanguageFinding[] = [];

  const check = (node: ts.Node, text: string, jsxText: boolean) => {
    for (const rule of INTERNAL_LANGUAGE_RULES) {
      if (rule.jsxTextOnly && !jsxText) continue;
      if (rule.proseOnly && !/\s/.test(text.trim())) continue;
      const match = rule.pattern.exec(text);
      if (!match) continue;
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      findings.push({ rule: rule.id, line: line + 1, text: match[0] });
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      check(node, node.text, true);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!isCodeString(node)) check(node, node.text, false);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      check(node, node.text, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}
