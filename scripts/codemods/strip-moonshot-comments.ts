// AST codemod — strips MOONSHOT block/line comments from page + component
// source files.
//
// The Phase B audit-defanging pass left behind a lot of
// `/* MOONSHOT: ... */` and `// MOONSHOT: ...` breadcrumbs
// explaining what each stripped pattern used to be. The breadcrumbs served
// their purpose (helping the next reviewer understand the codemod's intent);
// now that the patterns are gone they're noise. Stripping them clears the
// last ROUTE_COVERAGE classifier signal `MOONSHOT comment` from ~70 routes.
//
// Uses raw text replacement against `getFullText()` because the comments
// are always bounded by their delimiters and there's no chance of consuming
// code. Idempotent — re-running on a clean tree is a no-op.
//
// Run with:
//   npx tsx scripts/codemods/strip-moonshot-comments.ts
//
// (Note: docstring uses line comments instead of block comments to avoid
// the `*/` sequence in this file — block-comment style would terminate
// the docstring prematurely.)
import { Project } from "ts-morph";
import path from "node:path";

const BLOCK_COMMENT_RE = /\/\*\s*MOONSHOT[\s\S]*?\*\//gi;
const LINE_COMMENT_RE = /^\s*\/\/\s*MOONSHOT.*$/gim;
const JSX_BLOCK_COMMENT_RE = /\{\/\*\s*MOONSHOT[\s\S]*?\*\/\}/gi;

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
  let removedComments = 0;
  const touched: string[] = [];

  for (const file of project.getSourceFiles()) {
    const before = file.getFullText();

    // Apply each regex; count matches first, then replace.
    let working = before;
    let countThisFile = 0;
    for (const re of [JSX_BLOCK_COMMENT_RE, BLOCK_COMMENT_RE, LINE_COMMENT_RE]) {
      const matches = working.match(re);
      countThisFile += matches?.length ?? 0;
      working = working.replace(re, "");
    }
    // Collapse double-blank-lines that the comment removal can leave.
    working = working.replace(/\n\n\n+/g, "\n\n");

    if (working !== before) {
      file.replaceWithText(working);
      mutated++;
      removedComments += countThisFile;
      touched.push(path.relative(process.cwd(), file.getFilePath()));
    }
  }

  await project.save();
  console.log(
    `[strip-moonshot-comments] mutated ${mutated} files — removed ${removedComments} MOONSHOT comments`,
  );
  for (const f of touched) console.log(`  ${f}`);
}

main().catch((err) => {
  console.error("[strip-moonshot-comments] fatal:", err);
  process.exit(1);
});
