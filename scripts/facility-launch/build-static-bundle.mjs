import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const rootArgIndex = args.findIndex((arg) => arg === '--root');
const staticRoot = rootArgIndex >= 0 && args[rootArgIndex + 1]
  ? resolve(process.cwd(), args[rootArgIndex + 1])
  : resolve(scriptDir, '../../facility-launch-center');

const srcDir = resolve(staticRoot, 'src');
const entryFile = resolve(srcDir, 'app.js');
const outFile = resolve(staticRoot, 'dist/app.bundle.js');

const importRegex = /^\s*import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm;

function stripImportQuery(specifier = '') {
  return specifier.split('?')[0];
}

function stripModuleSyntax(code) {
  return code
    .replace(/^\s*import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*export\s+(?=(async\s+)?function\b|const\b|let\b|var\b|class\b)/gm, '')
    .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '')
    .trim();
}

async function collectModules(filePath, ordered, seen) {
  if (seen.has(filePath)) return;
  seen.add(filePath);
  const source = await readFile(filePath, 'utf8');

  const deps = [];
  for (const match of source.matchAll(importRegex)) {
    const specifier = stripImportQuery(match[2]);
    if (!specifier.startsWith('.')) continue;
    deps.push(resolve(dirname(filePath), specifier));
  }

  for (const dep of deps) {
    const depPath = dep.endsWith('.js') ? dep : `${dep}.js`;
    await collectModules(depPath, ordered, seen);
  }

  ordered.push({ filePath, source });
}

const ordered = [];
await collectModules(entryFile, ordered, new Set());

const bundle = ordered.map(({ filePath, source }) => {
  const relativePath = filePath.slice(staticRoot.length + 1);
  return `// ---- ${relativePath} ----\n${stripModuleSyntax(source)}\n`;
}).join('\n');

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, `${bundle}\n`, 'utf8');
console.log(`Bundled ${ordered.length} modules -> ${outFile}`);
