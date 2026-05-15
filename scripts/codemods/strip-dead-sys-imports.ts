/**
 * AST codemod — strips dead named imports left over after the Phase B
 * SYS-eyebrow / moonshot-class codemods removed their JSX usages.
 *
 * Scope: every PageClient.tsx and src/app/**\/page.tsx plus the shell
 * components, executive dashboard clients, and the moonshot/ stubs that
 * carry an unused `import React from "react"`. The Phase B codemods cut
 * `<SysLabel>…</SysLabel>` (and similar) usages but left the `import {
 * SysLabel } from …` declaration untouched; ESLint's `--max-warnings 0`
 * gate then catches them on every PR. This codemod is the standing
 * scrub for future Phase B residue — re-run it after any SYS / moonshot
 * sweep.
 *
 * Algorithm:
 *   1. For every named import in every import declaration, count
 *      references to the imported binding anywhere else in the file
 *      (excluding the import's own NameNode).
 *   2. If references = 0, remove the named import.
 *   3. After all named imports are processed, drop the whole import
 *      declaration when no named, default, or namespace specifier
 *      remains — `import "side-effect-only"` is preserved.
 *
 * The `import React from "react"` case is handled by the same pass:
 * defaultImport is treated symmetrically — if `React` is referenced
 * nowhere (true on Next.js 16's automatic-JSX-runtime under our config),
 * the default specifier is removed; the declaration is then dropped if
 * nothing else remains.
 *
 * Run with:
 *   npx tsx scripts/codemods/strip-dead-sys-imports.ts
 *
 * Idempotent. Safe to re-run; no-op when the tree is already clean.
 */
import { Project, SyntaxKind } from "ts-morph";
import path from "node:path";

async function main() {
  const project = new Project({
    tsConfigFilePath: path.resolve("tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });

  project.addSourceFilesAtPaths([
    "src/app/**/*.tsx",
    "src/components/**/*.tsx",
  ]);

  const files = project.getSourceFiles();

  let mutated = 0;
  let removedNamed = 0;
  let removedDefault = 0;
  let removedDeclarations = 0;
  const touched: string[] = [];

  for (const file of files) {
    const before = file.getFullText();

    for (const decl of file.getImportDeclarations()) {
      // Skip side-effect-only imports outright (`import "./globals.css"`).
      // These have no ImportClause and must never be removed.
      const startedWithClause = decl.getImportClause() !== undefined;
      if (!startedWithClause) continue;

      let touchedThisDecl = false;

      // Drop unused named imports. For aliased imports
      // (`import { Dialog as SheetPrimitive }`), the local binding is
      // the alias node, not the original name — check references
      // against whichever node the rest of the file would touch.
      for (const named of decl.getNamedImports()) {
        const aliasNode = named.getAliasNode();
        const localNode = aliasNode ?? named.getNameNode();
        const localName = localNode.getText();
        const refs = file
          .getDescendantsOfKind(SyntaxKind.Identifier)
          .filter((id) => id.getText() === localName && id !== localNode);
        if (refs.length === 0) {
          named.remove();
          removedNamed++;
          touchedThisDecl = true;
        }
      }

      // Drop unused default import (e.g. `import React from "react"` in
      // a file that uses the automatic JSX runtime).
      const def = decl.getDefaultImport();
      if (def) {
        const name = def.getText();
        const refs = file
          .getDescendantsOfKind(SyntaxKind.Identifier)
          .filter((id) => id.getText() === name && id !== def);
        if (refs.length === 0) {
          decl.removeDefaultImport();
          removedDefault++;
          touchedThisDecl = true;
        }
      }

      // Drop the whole declaration only when (a) we just removed
      // something from it and (b) nothing else remains. This preserves
      // side-effect-only imports and any namespace import that we
      // currently never strip.
      if (
        touchedThisDecl &&
        decl.getNamedImports().length === 0 &&
        !decl.getDefaultImport() &&
        !decl.getNamespaceImport()
      ) {
        decl.remove();
        removedDeclarations++;
      }
    }

    if (file.getFullText() !== before) {
      mutated++;
      touched.push(path.relative(process.cwd(), file.getFilePath()));
    }
  }

  await project.save();
  console.log(
    `Mutated ${mutated} files — removed ${removedNamed} named, ` +
      `${removedDefault} default, ${removedDeclarations} declarations.`,
  );
  for (const f of touched) console.log(`  ${f}`);
}

main().catch((err) => {
  console.error("[strip-dead-sys-imports] fatal:", err);
  process.exit(1);
});
