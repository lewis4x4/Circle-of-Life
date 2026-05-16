// AST codemod — rewrites tracking-widest to tracking-wider, and bumps
// paired text-[10px] to text-[11px] when the className is an uppercase
// micro-cap label.
//
// Per DESIGN_PRINCIPLES.md §11: chrome eyebrows / labels use
// `text-[11px] uppercase tracking-wider text-muted-foreground`. The
// `tracking-widest` (`letter-spacing: 0.1em`) + `text-[10px]` pairing
// is the legacy moonshot micro-cap pattern; this codemod flips both
// tokens in one pass.
//
// Idempotent.
//
// Run with:
//   npx tsx scripts/codemods/rewrite-tracking-widest.ts

import { Project, SyntaxKind, type JsxAttribute } from "ts-morph";
import path from "node:path";

function rewriteTracking(className: string): { changed: boolean; result: string } {
  if (!/\btracking-widest\b/.test(className)) {
    return { changed: false, result: className };
  }
  let working = className.replace(/\btracking-widest\b/g, "tracking-wider");
  // Bump text-[10px] → text-[11px] only when the className contains `uppercase`
  // — bare 10px text inside non-uppercase chrome stays at 10px.
  if (/\buppercase\b/.test(working) && /\btext-\[10px\]\b/.test(working)) {
    working = working.replace(/\btext-\[10px\]\b/g, "text-[11px]");
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

      // Direct StringLiteral initializer (className="...") — has no
      // descendants, so forEachDescendant skips it.
      const directStr = initializer.asKind(SyntaxKind.StringLiteral);
      if (directStr) {
        const text = directStr.getLiteralText();
        const { changed, result } = rewriteTracking(text);
        if (changed) {
          directStr.replaceWithText(`"${result.replace(/"/g, '\\"')}"`);
          strippedAttrs++;
          fileTouched = true;
        }
        return;
      }

      initializer.forEachDescendant((leaf) => {
        const stringLit = leaf.asKind(SyntaxKind.StringLiteral);
        if (stringLit) {
          const text = stringLit.getLiteralText();
          const { changed, result } = rewriteTracking(text);
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
          const { changed, result } = rewriteTracking(text);
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
    `[rewrite-tracking-widest] mutated ${mutated} files — rewrote ${strippedAttrs} className-string occurrences`,
  );
  for (const f of touched) console.log(`  ${f}`);
}

main().catch((err) => {
  console.error("[rewrite-tracking-widest] fatal:", err);
  process.exit(1);
});
