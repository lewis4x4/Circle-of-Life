/**
 * AST codemod — strips the "SYS: MODULE …" / "SYS: <SECTION>" eyebrow pill
 * div from every PageClient.tsx and from src/app/**\/page.tsx.
 *
 * Scope: only matches a JsxElement whose text content begins with `SYS:` and
 * whose serialized text is short (<200 chars) — that fingerprints the single
 * small pill div without consuming surrounding hero containers (the failure
 * mode of the prior regex sweep).
 *
 * Run with:
 *   npx tsx scripts/codemods/strip-sys-eyebrow.ts
 */
import { Project, SyntaxKind, type JsxElement } from "ts-morph";
import path from "node:path";

async function main() {
  const project = new Project({
    tsConfigFilePath: path.resolve("tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });

  project.addSourceFilesAtPaths([
    "src/app/**/*PageClient.tsx",
    "src/app/**/page.tsx",
    "src/components/**/*PageClient.tsx",
  ]);

  const files = project.getSourceFiles();

  let mutated = 0;
  let removed = 0;
  const touched: string[] = [];

  for (const file of files) {
    const before = file.getFullText();

    // Walk every JsxElement; if any child JsxText starts with `SYS:`, remove
    // the smallest ancestor JsxElement that contains only that eyebrow.
    file.forEachDescendant((node) => {
      if (node.getKind() !== SyntaxKind.JsxElement) return;
      const jsx = node as JsxElement;

      // The whole element text must mention SYS: somewhere
      const text = jsx.getText();
      if (!/>\s*SYS:\s*[A-Z]/.test(text)) return;

      // Only fire when this element directly contains the SYS: text node — not
      // a deeper descendant that contains it via a sibling chain.
      const children = jsx.getJsxChildren();
      const hasSysText = children.some((c) => {
        if (c.getKind() !== SyntaxKind.JsxText) return false;
        return /\bSYS:\s*[A-Z]/.test(c.getText());
      });
      if (!hasSysText) return;

      // Guardrail: only remove if the element is small (a real eyebrow pill,
      // not a hero wrapper that happens to contain SYS:). 500 chars covers
      // the longest legit eyebrow seen in the codebase (long className
      // chains with backdrop-blur + caps tracking + border + bg + text).
      if (text.length > 500) return;

      // Replace the JSX element with nothing.
      jsx.replaceWithText("");
      removed++;
    });

    if (file.getFullText() !== before) {
      mutated++;
      touched.push(path.relative(process.cwd(), file.getFilePath()));
    }
  }

  await project.save();
  console.log(`Mutated ${mutated} files, removed ${removed} eyebrows.`);
  for (const f of touched) console.log(`  ${f}`);
}

main().catch((err) => {
  console.error("[strip-sys-eyebrow] fatal:", err);
  process.exit(1);
});
