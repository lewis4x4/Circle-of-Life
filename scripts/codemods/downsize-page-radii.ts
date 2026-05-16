// AST codemod — downsizes oversized hero/card radii on page chrome.
//
// Per DESIGN_PRINCIPLES.md §12, card radii max out at `rounded-xl`.
// The legacy moonshot patterns shipped `rounded-3xl`, `rounded-[2rem]`,
// `rounded-[2.5rem]`, `rounded-[1.8rem]`, `rounded-[1.75rem]`, and
// `rounded-[3rem]` on hero tiles + floating docks. All get collapsed
// to `rounded-xl`.
//
// Scoped to `src/app/**` and `src/components/**` EXCEPT `src/components/ui/**`
// — UI primitives may legitimately ship larger radii; the residue check
// in the residue PR will spot any that need attention.
//
// Idempotent.
//
// Run with:
//   npx tsx scripts/codemods/downsize-page-radii.ts

import { Project, SyntaxKind, type JsxAttribute } from "ts-morph";
import path from "node:path";

// Two alternations because `\b` after `]` doesn't fire (`]` and the
// following space are both non-word characters, so no boundary). The
// word-form tokens (`3xl`, `4xl`) keep `\b`; the bracketed tokens use
// `(?=[\s"\`}]|$)` to require a className separator instead.
const RADIUS_RE =
  /\brounded-(?:3xl|4xl)\b|\brounded-(?:\[2rem\]|\[2\.5rem\]|\[1\.8rem\]|\[1\.75rem\]|\[3rem\])(?=[\s"`}]|$)/g;

function rewrite(className: string): { changed: boolean; result: string } {
  if (!RADIUS_RE.test(className)) {
    RADIUS_RE.lastIndex = 0;
    return { changed: false, result: className };
  }
  RADIUS_RE.lastIndex = 0;
  const working = className.replace(RADIUS_RE, "rounded-xl");
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

      // Handle three className initializer shapes:
      //   className="..."                       → StringLiteral (direct)
      //   className={`...`}                     → JsxExpression containing NoSubstitutionTemplateLiteral
      //   className={cn("...", "...", maybe)}   → JsxExpression containing CallExpression with string args
      //
      // StringLiteral has no descendants — process it directly. The other
      // forms have descendant StringLiterals / NoSubstitutionTemplateLiterals
      // reached via the walker below.
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
    `[downsize-page-radii] mutated ${mutated} files — downsized ${strippedAttrs} className-string occurrences`,
  );
  for (const f of touched) console.log(`  ${f}`);
}

main().catch((err) => {
  console.error("[downsize-page-radii] fatal:", err);
  process.exit(1);
});
