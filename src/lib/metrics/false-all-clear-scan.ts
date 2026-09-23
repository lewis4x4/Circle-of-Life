/**
 * Static scan behind the COL-649 guard (false-all-clear.source.test.ts).
 *
 * Four shapes turn "we could not read it" into "there is nothing wrong":
 *
 * 1. `silent-zero` — `x ?? 0`, `x || 0`, `?? 100`, `|| 100` inside a JSX
 *    expression (a rendered value or a prop such as `value={x ?? 0}`). A failed
 *    or unscoped read then prints a confident 0 / 100%.
 * 2. `count-or-zero` — `count ?? 0` anywhere: a Supabase head count is null
 *    when the query failed, and `?? 0` makes the failure read as "none".
 * 3. `empty-is-ok` — `if (list.length === 0) return "current"` and friends:
 *    no records mapped straight to a green state.
 * 4. `all-clear-copy` — reassuring copy ("All clear", "All verified", "In good
 *    standing", "Coverage is currently sufficient", …) in a file that never
 *    asks `canClaimAllClear`, so nothing proves the read succeeded over a
 *    non-empty scope before the reassurance renders.
 *
 * A finding that is genuinely not a displayed metric (a pagination total, an
 * arithmetic accumulator) is exempt when the same line or the line above
 * carries `false-all-clear-ok: <reason>` with a reason of at least ten
 * characters. The reason is the review record; there is no bare opt-out.
 *
 * Arrow functions and function bodies inside JSX (event handlers, reducers)
 * are skipped for rule 1: `(prev ?? 0) + 1` in an onClick is arithmetic, not a
 * displayed metric.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export type FalseAllClearRule = "silent-zero" | "count-or-zero" | "empty-is-ok" | "all-clear-copy";

export type FalseAllClearFinding = {
  file: string;
  rule: FalseAllClearRule;
  line: number;
  snippet: string;
};

export const SCANNED_ROOTS = ["src/app", "src/components", "src/features", "src/lib", "src/hooks"] as const;

const DEFAULT_FALLBACKS = new Set(["0", "100"]);

const EMPTY_IS_OK =
  /\.length\s*===?\s*0\s*\)?\s*(?:return\s+|\?\s*)["'`](?:current|clear|ok|compliant|verified|sufficient|good|all_clear|in_good_standing)["'`]/i;

const COUNT_OR_ZERO = /\bcount\s*\?\?\s*0\b/;

/** Reassurance that must be gated by `canClaimAllClear` (case-insensitive). */
export const ALL_CLEAR_PHRASES: readonly RegExp[] = [
  /\ball clear\b/i,
  /\ball verified\b/i,
  /\bin good standing\b/i,
  /\bcoverage is currently sufficient\b/i,
  /\btriage queue clear\b/i,
  /\boperationally clear\b/i,
  /\bcerts ok\b/i,
  /\bno credential blockers\b/i,
  /\binbox zero\b/i,
  /\bgreat work keeping operations\b/i,
];

export const ALL_CLEAR_GATE = "canClaimAllClear";

function isTestFile(file: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(file) || file.includes("__lint_fixture__") || file.endsWith(".preview.tsx");
}

export function listScannedFiles(repoRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = path.join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
        const rel = path.relative(repoRoot, full).split(path.sep).join("/");
        if (!isTestFile(rel)) out.push(rel);
      }
    }
  };
  for (const root of SCANNED_ROOTS) walk(path.join(repoRoot, root));
  return out.sort();
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node)
  );
}

function isDefaultFallback(node: ts.Expression): boolean {
  let inner: ts.Expression = node;
  while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
  return ts.isNumericLiteral(inner) && DEFAULT_FALLBACKS.has(inner.text);
}

function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

/** Rule 1: `?? 0` / `|| 0` / `?? 100` / `|| 100` rendered through JSX. */
export function findSilentZeros(file: string, source: string): FalseAllClearFinding[] {
  if (!file.endsWith(".tsx")) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings: FalseAllClearFinding[] = [];

  const scanJsxExpression = (node: ts.Node) => {
    if (isFunctionLike(node)) return;
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken) &&
      isDefaultFallback(node.right)
    ) {
      findings.push({
        file,
        rule: "silent-zero",
        line: lineOf(sf, node.getStart(sf)),
        snippet: node.getText(sf).slice(0, 120),
      });
    }
    ts.forEachChild(node, scanJsxExpression);
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxExpression(node) && node.expression) {
      scanJsxExpression(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

function lineFindings(
  file: string,
  source: string,
  rule: FalseAllClearRule,
  pattern: RegExp,
): FalseAllClearFinding[] {
  const findings: FalseAllClearFinding[] = [];
  source.split("\n").forEach((text, index) => {
    const trimmed = text.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    if (pattern.test(text)) findings.push({ file, rule, line: index + 1, snippet: trimmed.slice(0, 120) });
  });
  return findings;
}

export function findAllClearCopy(file: string, source: string): FalseAllClearFinding[] {
  if (source.includes(ALL_CLEAR_GATE)) return [];
  const findings: FalseAllClearFinding[] = [];
  for (const phrase of ALL_CLEAR_PHRASES) {
    findings.push(...lineFindings(file, source, "all-clear-copy", phrase));
  }
  return findings;
}

/** `false-all-clear-ok: <reason>` — the reason must say why (10+ characters). */
export const JUSTIFIED_EXEMPTION = /false-all-clear-ok:\s*\S.{9,}/;

function isJustified(lines: string[], line: number): boolean {
  return [lines[line - 1], lines[line - 2]].some((text) => text !== undefined && JUSTIFIED_EXEMPTION.test(text));
}

export function scanSource(file: string, source: string): FalseAllClearFinding[] {
  const lines = source.split("\n");
  return [
    ...findSilentZeros(file, source),
    ...lineFindings(file, source, "count-or-zero", COUNT_OR_ZERO),
    ...lineFindings(file, source, "empty-is-ok", EMPTY_IS_OK),
    ...findAllClearCopy(file, source),
  ].filter((finding) => !isJustified(lines, finding.line));
}

export type FalseAllClearCounts = Record<string, Partial<Record<FalseAllClearRule, number>>>;

export function scanRepo(repoRoot: string): { findings: FalseAllClearFinding[]; counts: FalseAllClearCounts } {
  const findings: FalseAllClearFinding[] = [];
  for (const file of listScannedFiles(repoRoot)) {
    findings.push(...scanSource(file, readFileSync(path.join(repoRoot, file), "utf8")));
  }
  const counts: FalseAllClearCounts = {};
  for (const f of findings) {
    const entry = (counts[f.file] ??= {});
    entry[f.rule] = (entry[f.rule] ?? 0) + 1;
  }
  return { findings, counts };
}
