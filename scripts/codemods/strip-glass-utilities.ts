// AST codemod — strips `glass-card`, `glass-card-light`, `glass-panel`
// className tokens from page chrome.
//
// Per DESIGN_PRINCIPLES.md §12, chrome is flat `bg-card border-border`.
// The legacy moonshot glass-* utility set has been retired across all
// audited shells; this catches the page-level residue (caregiver/tasks,
// caregiver/meds, family/calendar, family/billing).
//
// Codemod logic:
//   - Strip `glass-card`, `glass-card-light`, `glass-panel`.
//   - If the resulting className no longer contains any `bg-*` token,
//     append `bg-card border border-border` so the card retains chrome.
//   - Skip files under `src/components/ui/moonshot/` (the defanged
//     `v2-card.tsx` stub has the word `glass-card` only inside a
//     JSX/JS comment; the AST-scoped className-only walker skips comments
//     by construction, but the exclude is belt-and-suspenders).
//
// Idempotent.
//
// Run with:
//   npx tsx scripts/codemods/strip-glass-utilities.ts

import { Project, SyntaxKind, type JsxAttribute } from "ts-morph";
import path from "node:path";

const GLASS_RE = /\bglass-(?:card-light|card|panel)\b/g;
const BG_TOKEN_RE = /\bbg-[a-z][a-z0-9-]*(?:\/\d+)?\b/;

function rewrite(className: string): { changed: boolean; result: string } {
  if (!GLASS_RE.test(className)) {
    GLASS_RE.lastIndex = 0;
    return { changed: false, result: className };
  }
  GLASS_RE.lastIndex = 0;
  let working = className.replace(GLASS_RE, "").replace(/\s+/g, " ").trim();
  if (!BG_TOKEN_RE.test(working)) {
    working = working.length > 0
      ? `${working} bg-card border border-border`
      : "bg-card border border-border";
  }
  return { changed: working !== className, result: working };
}

async function main() {
  const project = new Project({
    tsConfigFilePath: path.resolve("tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });

  project.addSourceFilesAtPaths([
    "src/app/**/*.tsx",
    "src/components/**/*.tsx",
  ]);

  let mutated = 0;
  let strippedAttrs = 0;
  const touched: string[] = [];

  for (const file of project.getSourceFiles()) {
    const relPath = path.relative(process.cwd(), file.getFilePath());
    if (relPath.startsWith("src/components/ui/")) continue;

    const before = file.getFullText();
    let fileTouched = false;

    file.forEachDescendant((node) => {
      if (node.getKind() !== SyntaxKind.JsxAttribute) return;
      const attr = node as JsxAttribute;
      if (attr.getNameNode().getText() !== "className") return;
      const initializer = attr.getInitializer();
      if (!initializer) return;

      // Direct StringLiteral initializer (className="...").
      const directStr = initializer.asKind(SyntaxKind.StringLiteral);
      if (directStr) {
        const text = directStr.getLiteralText();
        const { changed, result } = rewrite(text);
        if (changed) {
          directStr.replaceWithText(`"${result.replace(/"/g, '\\"')}"`);
          strippedAttrs++;
          fileTouched = true;
        }
        return;
      }

      // JsxExpression initializer (className={...}) — walk descendant
      // strings.
      initializer.forEachDescendant((leaf) => {
        const stringLit = leaf.asKind(SyntaxKind.StringLiteral);
        if (stringLit) {
          const text = stringLit.getLiteralText();
          const { changed, result } = rewrite(text);
          if (changed) {
            stringLit.replaceWithText(`"${result.replace(/"/g, '\\"')}"`);
            strippedAttrs++;
            fileTouched = true;
          }
          return;
        }
        const noSubTmpl = leaf.asKind(SyntaxKind.NoSubstitutionTemplateLiteral);
        if (noSubTmpl) {
          const text = noSubTmpl.getLiteralText();
          const { changed, result } = rewrite(text);
          if (changed) {
            noSubTmpl.replaceWithText("`" + result + "`");
            strippedAttrs++;
            fileTouched = true;
          }
        }
      });
    });

    if (fileTouched && file.getFullText() !== before) {
      mutated++;
      touched.push(relPath);
    }
  }

  await project.save();
  console.log(
    `[strip-glass-utilities] mutated ${mutated} files — stripped ${strippedAttrs} className-string occurrences`,
  );
  for (const f of touched) console.log(`  ${f}`);
}

main().catch((err) => {
  console.error("[strip-glass-utilities] fatal:", err);
  process.exit(1);
});
