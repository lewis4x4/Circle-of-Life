/**
 * AST codemod — strips JSX usage + imports of the audit-defanged
 * null-return moonshot stubs (`AmbientMatrix`, `Sparkline`, `PulseDot`).
 *
 * These three components render visually-decorative effects that the
 * audit has already stubbed to return null (or render an irrelevant
 * dot). Every JSX usage is dead code; every import is unused noise that
 * the ROUTE_COVERAGE classifier still flags as DRIFT. Strip both.
 *
 * Out of scope for this codemod:
 *   - `V2Card` — a real semantic-token card primitive (renders
 *     `rounded-lg border-border bg-card`). Renamed/moved separately.
 *   - `KineticGrid` — a real semantic grid wrapper. Reclassified
 *     out of DRIFT separately.
 *   - `MOONSHOT` comments — stripped by `strip-moonshot-comments.ts`.
 *   - Typography (`SysLabel`, `TitleH1`, `Subtitle`, `MonoLabel`,
 *     `MetricValue`) — still render actual content; need manual
 *     migration to standard typography in residue PRs.
 *
 * Algorithm:
 *   1. For every file under `src/app/**` and `src/components/**`,
 *      find imports from `@/components/ui/moonshot/ambient-matrix`,
 *      `@/components/ui/moonshot/sparkline`, and
 *      `@/components/ui/moonshot/pulse-dot`.
 *   2. Collect the local bindings (handle aliases per the
 *      strip-dead-sys-imports template).
 *   3. Walk every JsxElement / JsxSelfClosingElement. If its tagName
 *      resolves to a tainted local binding, remove the element.
 *      Decorative stubs have no children of consequence, so removal
 *      is straightforward — no fragment shimming needed.
 *   4. Remove the import declarations entirely (after JSX walk, the
 *      local bindings are dead).
 *
 * Idempotent. Re-running on a clean tree is a no-op.
 *
 * Run with:
 *   npx tsx scripts/codemods/strip-null-moonshot.ts
 */
import { Project, SyntaxKind, type JsxElement, type JsxSelfClosingElement } from "ts-morph";
import path from "node:path";

const TAINTED_MODULES = new Set([
  "@/components/ui/moonshot/ambient-matrix",
  "@/components/ui/moonshot/sparkline",
  "@/components/ui/moonshot/pulse-dot",
]);

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
  let removedJsx = 0;
  let removedImports = 0;
  const touched: string[] = [];

  for (const file of project.getSourceFiles()) {
    // Skip the stub files themselves — we don't strip the source, only consumers.
    const relPath = path.relative(process.cwd(), file.getFilePath());
    if (relPath.startsWith("src/components/ui/moonshot/")) continue;

    const before = file.getFullText();

    // STEP 1: collect tainted local bindings from imports of TAINTED_MODULES.
    /** @type {Set<string>} */
    const tainted = new Set<string>();
    for (const decl of file.getImportDeclarations()) {
      const spec = decl.getModuleSpecifierValue();
      if (!TAINTED_MODULES.has(spec)) continue;
      for (const named of decl.getNamedImports()) {
        const aliasNode = named.getAliasNode();
        const localNode = aliasNode ?? named.getNameNode();
        tainted.add(localNode.getText());
      }
    }
    if (tainted.size === 0) continue;

    // STEP 2: walk JSX, remove tainted-tagName usages.
    // Iterate descendants without mutation first — collect targets — then mutate
    // to avoid invalidating the traversal.
    const targets: (JsxElement | JsxSelfClosingElement)[] = [];
    file.forEachDescendant((node) => {
      if (
        node.getKind() === SyntaxKind.JsxElement ||
        node.getKind() === SyntaxKind.JsxSelfClosingElement
      ) {
        const jsx = node as JsxElement | JsxSelfClosingElement;
        const tagName =
          jsx.getKind() === SyntaxKind.JsxElement
            ? (jsx as JsxElement).getOpeningElement().getTagNameNode().getText()
            : (jsx as JsxSelfClosingElement).getTagNameNode().getText();
        if (tainted.has(tagName)) targets.push(jsx);
      }
    });

    for (const jsx of targets) {
      // Parent may have already been removed (nested case). Skip if so.
      if (jsx.wasForgotten()) continue;
      // Replace with an empty fragment instead of empty text — `{cond &&
      // <Element />}` would become `{cond && }` (syntax error) under
      // text-replace, but `{cond && <></>}` is valid in every JSX
      // context (children list, expression, ternary branch, array item).
      jsx.replaceWithText("<></>");
      removedJsx++;
    }

    // STEP 3: drop the tainted import declarations entirely.
    for (const decl of file.getImportDeclarations()) {
      const spec = decl.getModuleSpecifierValue();
      if (TAINTED_MODULES.has(spec)) {
        decl.remove();
        removedImports++;
      }
    }

    if (file.getFullText() !== before) {
      mutated++;
      touched.push(relPath);
    }
  }

  await project.save();
  console.log(
    `[strip-null-moonshot] mutated ${mutated} files — removed ${removedJsx} JSX usages + ${removedImports} imports`,
  );
  for (const f of touched) console.log(`  ${f}`);
}

main().catch((err) => {
  console.error("[strip-null-moonshot] fatal:", err);
  process.exit(1);
});
