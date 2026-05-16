// AST codemod — removes `font-display` className tokens and the paired
// `font-light` weight that travels with the moonshot moonshot heading
// pattern.
//
// Per DESIGN_PRINCIPLES.md §11 / §12, headings use `font-semibold` on
// the system sans stack. `font-display` aliases to Inter today (same as
// `font-sans`), and the typical pairing was `font-display font-light` —
// the wrong weight in a moonshot-leaning font alias. Both go.
//
// Codemod logic:
//   - Strip `font-display`.
//   - Strip `font-light` only when it co-occurs with `font-display` in
//     the same className string.
//   - If neither a `font-{weight}` nor `font-{family}` token remains
//     after the strip, append `font-semibold` so the heading inherits a
//     sensible weight from the design system.
//
// Idempotent.
//
// Run with:
//   npx tsx scripts/codemods/strip-font-display.ts

import { Project, SyntaxKind, type JsxAttribute } from "ts-morph";
import path from "node:path";

const FONT_WEIGHT_RE = /\bfont-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b/;
const FONT_FAMILY_RE = /\bfont-(?:sans|serif|mono)\b/;

function rewrite(className: string): { changed: boolean; result: string } {
  if (!/\bfont-display\b/.test(className)) {
    return { changed: false, result: className };
  }
  let working = className.replace(/\bfont-display\b/g, "");
  // Only drop font-light when it co-occurred with font-display.
  working = working.replace(/\bfont-light\b/g, "");
  working = working.replace(/\s+/g, " ").trim();

  const hasWeight = FONT_WEIGHT_RE.test(working);
  const hasFamily = FONT_FAMILY_RE.test(working);
  if (!hasWeight && !hasFamily) {
    working = working.length > 0 ? `${working} font-semibold` : "font-semibold";
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
    `[strip-font-display] mutated ${mutated} files — stripped ${strippedAttrs} className-string occurrences`,
  );
  for (const f of touched) console.log(`  ${f}`);
}

main().catch((err) => {
  console.error("[strip-font-display] fatal:", err);
  process.exit(1);
});
