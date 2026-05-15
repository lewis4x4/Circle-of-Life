/**
 * AST codemod — rewrites moonshot class strings inside `className` attribute
 * VALUES on JSX elements. Operates on `*PageClient.tsx` + `src/app/**\/page.tsx`
 * only (matches the style-regression CI workflow scope).
 *
 * Class-by-class transforms applied to each className string literal:
 *   text-5xl / text-6xl / text-7xl   → text-2xl
 *   text-4xl                          → text-2xl  (when paired with tracking-tight)
 *   font-display                      → (removed)
 *   font-light                        → font-semibold
 *   tracking-widest                   → tracking-wider
 *   rounded-3xl                       → rounded-lg
 *   rounded-4xl                       → rounded-lg
 *   rounded-[2.5rem]                  → rounded-lg
 *   rounded-[2rem]                    → rounded-lg
 *   rounded-[1.8rem]                  → rounded-lg
 *   rounded-[1.75rem]                 → rounded-lg
 *   rounded-[1.5rem]                  → rounded-lg
 *   backdrop-blur-3xl                 → (removed)
 *   backdrop-blur-2xl                 → (removed)
 *   backdrop-blur-xl                  → (removed)
 *   glass-panel                       → (removed)
 *   glass-card                        → (removed)
 *   glass-card-light                  → (removed)
 *   bg-clip-text text-transparent bg-gradient-to-(b|t|tr|tl|bl|br) … → (removed)
 *   bg-white/40                       → bg-card
 *   bg-white/60                       → bg-card
 *   dark:bg-black/20                  → (removed)
 *   dark:bg-black/30                  → (removed)
 *   dark:bg-white/[0.015]             → (removed)
 *   dark:bg-white/[0.02]              → (removed)
 *   dark:bg-white/[0.03]              → (removed)
 *
 * Only touches the VALUE inside `className="..."` (or
 * `className={cn("...")}`). JSX structure is never modified — no element
 * removed, no children moved. That keeps blast radius small.
 *
 * Run with:
 *   npx tsx scripts/codemods/strip-moonshot-classes.ts
 */
import { Project, SyntaxKind, type JsxAttribute, type StringLiteral } from "ts-morph";
import path from "node:path";

const CLASS_REWRITES: Array<{ pattern: RegExp; replacement: string }> = [
  // Oversized numerics
  { pattern: /\btext-5xl\b/g, replacement: "text-2xl" },
  { pattern: /\btext-6xl\b/g, replacement: "text-2xl" },
  { pattern: /\btext-7xl\b/g, replacement: "text-2xl" },
  { pattern: /\btext-8xl\b/g, replacement: "text-2xl" },
  { pattern: /\btext-9xl\b/g, replacement: "text-2xl" },
  // font-display has no real backing face here; drop with surrounding spaces
  { pattern: /\bfont-display\s+/g, replacement: "" },
  { pattern: /\s+font-display\b/g, replacement: "" },
  { pattern: /\bfont-display\b/g, replacement: "" },
  // font-light on display-sized text reads as marketing
  { pattern: /\bfont-light\b/g, replacement: "font-semibold" },
  // tracking-widest is restricted to text-[11px] tiny labels per
  // DESIGN_PRINCIPLES.md §3; downgrade ambient uses to tracking-wider.
  { pattern: /\btracking-widest\b/g, replacement: "tracking-wider" },
  // Hero radii
  { pattern: /\brounded-3xl\b/g, replacement: "rounded-lg" },
  { pattern: /\brounded-4xl\b/g, replacement: "rounded-lg" },
  { pattern: /\brounded-\[2\.5rem\]/g, replacement: "rounded-lg" },
  { pattern: /\brounded-\[2rem\]/g, replacement: "rounded-lg" },
  { pattern: /\brounded-\[1\.8rem\]/g, replacement: "rounded-lg" },
  { pattern: /\brounded-\[1\.75rem\]/g, replacement: "rounded-lg" },
  { pattern: /\brounded-\[1\.5rem\]/g, replacement: "rounded-lg" },
  // Glass utilities
  { pattern: /\bglass-panel\s+/g, replacement: "" },
  { pattern: /\s+glass-panel\b/g, replacement: "" },
  { pattern: /\bglass-panel\b/g, replacement: "" },
  { pattern: /\bglass-card-light\s+/g, replacement: "" },
  { pattern: /\s+glass-card-light\b/g, replacement: "" },
  { pattern: /\bglass-card-light\b/g, replacement: "" },
  { pattern: /\bglass-card\s+/g, replacement: "" },
  { pattern: /\s+glass-card\b/g, replacement: "" },
  { pattern: /\bglass-card\b/g, replacement: "" },
  // Backdrop blurs (admin chrome — only the topbar should blur)
  { pattern: /\bbackdrop-blur-3xl\s+/g, replacement: "" },
  { pattern: /\s+backdrop-blur-3xl\b/g, replacement: "" },
  { pattern: /\bbackdrop-blur-3xl\b/g, replacement: "" },
  { pattern: /\bbackdrop-blur-2xl\s+/g, replacement: "" },
  { pattern: /\s+backdrop-blur-2xl\b/g, replacement: "" },
  { pattern: /\bbackdrop-blur-2xl\b/g, replacement: "" },
  { pattern: /\bbackdrop-blur-xl\s+/g, replacement: "" },
  { pattern: /\s+backdrop-blur-xl\b/g, replacement: "" },
  { pattern: /\bbackdrop-blur-xl\b/g, replacement: "" },
  // Gradient text on chrome — strip the whole 4-utility chain
  // `bg-clip-text text-transparent bg-gradient-to-(b|t|tr|tl|bl|br) from-X to-Y`
  // when paired with dark: variants. The numeric color survives because
  // surrounding text-foreground / role color is what the new design uses.
  {
    pattern:
      /\bbg-clip-text\s+text-transparent\s+bg-gradient-to-[btlr]+\s+from-[a-z0-9-]+(\s+via-[a-z0-9-]+)?\s+to-[a-z0-9-]+(\s+dark:from-[a-z0-9-]+(\s+dark:via-[a-z0-9-]+)?\s+dark:to-[a-z0-9-]+)?/g,
    replacement: "",
  },
  // Hero-card backgrounds
  { pattern: /\bbg-white\/40\b/g, replacement: "bg-card" },
  { pattern: /\bbg-white\/60\b/g, replacement: "bg-card" },
  { pattern: /\bdark:bg-black\/20\s+/g, replacement: "" },
  { pattern: /\s+dark:bg-black\/20\b/g, replacement: "" },
  { pattern: /\bdark:bg-black\/20\b/g, replacement: "" },
  { pattern: /\bdark:bg-black\/30\s+/g, replacement: "" },
  { pattern: /\s+dark:bg-black\/30\b/g, replacement: "" },
  { pattern: /\bdark:bg-black\/30\b/g, replacement: "" },
  { pattern: /\bdark:bg-white\/\[0\.0[123]\]\s+/g, replacement: "" },
  { pattern: /\s+dark:bg-white\/\[0\.0[123]\]\b/g, replacement: "" },
  { pattern: /\bdark:bg-white\/\[0\.0[123]\]\b/g, replacement: "" },
];

function rewriteClassValue(input: string): string {
  let out = input;
  for (const { pattern, replacement } of CLASS_REWRITES) {
    out = out.replace(pattern, replacement);
  }
  // Collapse double / leading / trailing whitespace introduced by removals.
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

async function main() {
  const project = new Project({
    tsConfigFilePath: path.resolve("tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });

  project.addSourceFilesAtPaths([
    "src/app/**/*PageClient.tsx",
    "src/app/**/page.tsx",
    "src/components/**/*PageClient.tsx",
    "src/app/(admin)/billing/billing-invoice-ledger.tsx",
  ]);

  const files = project.getSourceFiles();
  let mutated = 0;
  let edits = 0;
  const touched: string[] = [];

  for (const file of files) {
    const before = file.getFullText();

    // Walk every JsxAttribute. If it's a className and its value is a string
    // literal, rewrite. Don't touch className={cn(…)} expression values —
    // those need a different pass.
    file.forEachDescendant((node) => {
      if (node.getKind() !== SyntaxKind.JsxAttribute) return;
      const attr = node as JsxAttribute;
      const nameNode = attr.getNameNode();
      if (nameNode.getText() !== "className") return;

      const init = attr.getInitializer();
      if (!init) return;
      if (init.getKind() !== SyntaxKind.StringLiteral) return;
      const lit = init as StringLiteral;
      const value = lit.getLiteralText();
      const rewritten = rewriteClassValue(value);
      if (rewritten !== value) {
        lit.setLiteralValue(rewritten);
        edits++;
      }
    });

    // ALSO rewrite string-literal arguments of cn("…", "…", …). These are
    // template-tagged-like calls in JSX className={cn("…")} patterns.
    file.forEachDescendant((node) => {
      if (node.getKind() !== SyntaxKind.StringLiteral) return;
      const parent = node.getParent();
      if (!parent) return;
      // Only string literals that are arguments to a `cn(...)` call.
      if (parent.getKind() !== SyntaxKind.CallExpression) return;
      const call = parent.asKindOrThrow(SyntaxKind.CallExpression);
      const expr = call.getExpression();
      if (expr.getText() !== "cn") return;
      const lit = node as StringLiteral;
      const value = lit.getLiteralText();
      const rewritten = rewriteClassValue(value);
      if (rewritten !== value) {
        lit.setLiteralValue(rewritten);
        edits++;
      }
    });

    if (file.getFullText() !== before) {
      mutated++;
      touched.push(path.relative(process.cwd(), file.getFilePath()));
    }
  }

  await project.save();
  console.log(`Mutated ${mutated} files (${edits} className edits).`);
  for (const f of touched) console.log(`  ${f}`);
}

main().catch((err) => {
  console.error("[strip-moonshot-classes] fatal:", err);
  process.exit(1);
});
