// AST codemod — removes `bg-gradient-to-{br,r,t,b,bl,tr,tl,l}` className
// tokens (and their paired `from-*` / `via-* `/ `to-*` color stops) from
// page-level chrome.
//
// Targets ~20 DRIFT routes per PHASE_D_PLAN.md §2. The forbidden-table
// rule in DESIGN_PRINCIPLES.md §12 is unconditional — chrome is flat
// semantic tokens, no gradients.
//
// Implementation note: `from-*` / `to-*` tokens are ambiguous. They're
// usually paired with `bg-gradient-to-*` but Tailwind also uses them in
// `border-*` and `ring-*` utilities. To avoid stripping legit non-gradient
// usages, the codemod only strips `from-*` / `via-*` / `to-*` tokens that
// co-occur with a `bg-gradient-to-*` token in the SAME className string.
// Standalone `from-blue-500/10` (no gradient sibling) stays untouched.
//
// Idempotent.
//
// Run with:
//   npx tsx scripts/codemods/strip-gradient-backgrounds.ts

import { Project, SyntaxKind, type JsxAttribute } from "ts-morph";
import path from "node:path";

const GRADIENT_TOKEN_RE = /\bbg-gradient-to-(?:br|r|t|b|bl|tr|tl|l)\b/g;
// from-*, via-*, to-* with color values. Match against the WHOLE token form
// `from-<name>(-shade)?(/[0-9]+)?` so we don't accidentally consume part of
// a longer compound class.
const COLOR_STOP_RE = /\b(?:from|via|to)-[a-z]+(?:-\d{2,3})?(?:\/\d+)?\b/g;

/** Strip gradient tokens from a className string, ONLY if a gradient is present. */
function stripGradient(className: string): { changed: boolean; result: string } {
  if (!GRADIENT_TOKEN_RE.test(className)) {
    // Reset lastIndex from the test() call.
    GRADIENT_TOKEN_RE.lastIndex = 0;
    return { changed: false, result: className };
  }
  GRADIENT_TOKEN_RE.lastIndex = 0;
  const cleaned = className
    .replace(GRADIENT_TOKEN_RE, "")
    .replace(COLOR_STOP_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  return { changed: cleaned !== className, result: cleaned };
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
    // Skip UI primitive sources — they may legitimately ship gradient
    // tokens (none currently do, but no need to scan them).
    if (relPath.startsWith("src/components/ui/")) continue;

    const before = file.getFullText();
    let fileTouched = false;

    file.forEachDescendant((node) => {
      if (node.getKind() !== SyntaxKind.JsxAttribute) return;
      const attr = node as JsxAttribute;
      if (attr.getNameNode().getText() !== "className") return;

      const initializer = attr.getInitializer();
      if (!initializer) return;

      // Three shapes:
      //   className="..."                       → StringLiteral
      //   className={`...`}                     → JsxExpression → TemplateExpression / NoSubstitutionTemplateLiteral
      //   className={cn("...", "...", maybe)}   → JsxExpression → CallExpression with string-literal args
      //
      // Walk every StringLiteral / NoSubstitutionTemplateLiteral / TemplateHead-or-Span
      // descendant of the initializer and run the strip on its TEXT value.
      initializer.forEachDescendant((leaf) => {
        const stringLit = leaf.asKind(SyntaxKind.StringLiteral);
        if (stringLit) {
          const text = stringLit.getLiteralText();
          const { changed, result } = stripGradient(text);
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
          const { changed, result } = stripGradient(text);
          if (changed) {
            noSubTmpl.replaceWithText("`" + result + "`");
            strippedAttrs++;
            fileTouched = true;
          }
        }
        // TemplateExpression head/tail spans are harder to safely strip
        // (the static segments are interleaved with interpolations); skip
        // them. Phase D residue PRs catch any that survive.
      });
    });

    if (fileTouched && file.getFullText() !== before) {
      mutated++;
      touched.push(relPath);
    }
  }

  await project.save();
  console.log(
    `[strip-gradient-backgrounds] mutated ${mutated} files — stripped ${strippedAttrs} className-string occurrences`,
  );
  for (const f of touched) console.log(`  ${f}`);
}

main().catch((err) => {
  console.error("[strip-gradient-backgrounds] fatal:", err);
  process.exit(1);
});
