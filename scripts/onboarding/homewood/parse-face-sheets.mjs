import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import {
  createNormalizedArtifact,
  extractDocxText,
  writeNormalizedArtifact
} from './ingestion-lib.mjs';

const DEFAULT_FACE_SHEET_PATHS = [
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/Haven - Brian/HW Face Sheets',
  '/Users/brianlewis/Circle of Life/Haven - Brian/HW Face Sheets',
  '/Users/brianlewis/Documents/CIRCLE OF LIFE/HW Face Sheets',
  '/Users/brianlewis/Downloads/HW Face Sheets'
];
const sourceFolder = process.env.HOMEWOOD_FACE_SHEETS_PATH || DEFAULT_FACE_SHEET_PATHS.find((path) => existsSync(path)) || DEFAULT_FACE_SHEET_PATHS[0];

const FIELD_DETECTORS = [
  ['admissionDate', /admission\s*date|admit\s*date/i, 'M5'],
  ['roomAssignment', /room\s*(number|#)|\broom\b/i, 'M5'],
  ['dateOfBirth', /\bDOB\b|date\s*of\s*birth/i, 'M5'],
  ['responsiblePartyOrPoa', /responsible\s*party|\bPOA\b|power\s*of\s*attorney/i, 'M15'],
  ['emergencyContact', /emergency\s*contact/i, 'M15'],
  ['physicianOrProvider', /physician|doctor|provider/i, 'M5'],
  ['pharmacy', /pharmacy/i, 'M10'],
  ['allergies', /allerg/i, 'M11'],
  ['diet', /\bdiet\b|texture|thickened|regular\s*diet/i, 'M11'],
  ['insuranceOrPayer', /insurance|medicaid|medicare|payer/i, 'M6'],
  ['codeStatus', /code\s*status|\bDNR\b|\bDNRO\b|full\s*code/i, 'M7']
];

function walkFiles(root) {
  const out = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walkFiles(path));
    else out.push(path);
  }
  return out;
}

function tryExtractPdfText(path) {
  try {
    return execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 50, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function extractText(path) {
  const ext = extname(path).toLowerCase();
  if (ext === '.docx') return extractDocxText(path);
  if (['.txt', '.md', '.csv'].includes(ext)) return readFileSync(path, 'utf8');
  if (ext === '.pdf') return tryExtractPdfText(path);
  return null;
}

function emptyCoverage() {
  return Object.fromEntries(FIELD_DETECTORS.map(([field]) => [field, 0]));
}

if (!existsSync(sourceFolder)) {
  const artifact = createNormalizedArtifact({
    sourceId: 'src-face-sheets',
    parserName: 'parse-face-sheets',
    sourceRefs: [{ label: 'HW Face Sheets folder', location: sourceFolder }],
    gaps: [{
      moduleCode: 'M5',
      fieldOrRecord: 'HW Face Sheets folder',
      reason: 'Face sheets folder is not present locally yet. Set HOMEWOOD_FACE_SHEETS_PATH when the Drive folder is available.',
      round: 'round_1',
      sourceId: 'src-face-sheets'
    }],
    extraSummary: {
      sourceFound: false,
      documentCount: 0,
      parseableDocumentCount: 0,
      phiSafeOutput: true
    }
  });
  const outPath = writeNormalizedArtifact(artifact);
  console.log(`Wrote ${outPath}`);
  console.log('Face sheets folder not found locally; emitted non-blocking Round 1 gap artifact.');
  process.exit(0);
}

const files = walkFiles(sourceFolder).filter((path) => ['.docx', '.pdf', '.txt', '.md', '.csv'].includes(extname(path).toLowerCase()));
const coverage = emptyCoverage();
const extensionCounts = {};
const unparseableExtensionCounts = {};
let parseableDocumentCount = 0;

for (const path of files) {
  const ext = extname(path).toLowerCase() || 'none';
  extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
  const text = extractText(path);
  if (!text) {
    unparseableExtensionCounts[ext] = (unparseableExtensionCounts[ext] || 0) + 1;
    continue;
  }
  parseableDocumentCount += 1;
  for (const [field, regex] of FIELD_DETECTORS) {
    if (regex.test(text)) coverage[field] += 1;
  }
}

const gaps = [];
if (files.length === 0) {
  gaps.push({ moduleCode: 'M5', fieldOrRecord: 'face sheet documents', reason: 'Folder exists but contains no parseable face-sheet document files.', round: 'round_1', sourceId: 'src-face-sheets' });
}
if (files.length > 0 && parseableDocumentCount === 0) {
  gaps.push({ moduleCode: 'M5', fieldOrRecord: 'face sheet text extraction', reason: 'Documents were found but none could be text-extracted locally.', round: 'round_1', sourceId: 'src-face-sheets' });
}
for (const [field, , moduleCode] of FIELD_DETECTORS) {
  if (parseableDocumentCount > 0 && coverage[field] === 0) {
    gaps.push({ moduleCode, fieldOrRecord: field, reason: `No parsed face sheets contained detectable ${field} content.`, round: 'round_1', sourceId: 'src-face-sheets' });
  }
}

const artifact = createNormalizedArtifact({
  sourceId: 'src-face-sheets',
  parserName: 'parse-face-sheets',
  sourceRefs: [{ label: 'HW Face Sheets folder', location: sourceFolder }],
  records: [{
    targetEntity: 'resident_face_sheet_field_coverage',
    sourceRowRef: 'face-sheets:aggregate-field-coverage',
    validationStatus: gaps.length ? 'needs_review' : 'ready',
    moduleCodes: ['M5', 'M7', 'M10', 'M11', 'M15'],
    data: {
      documentCount: files.length,
      parseableDocumentCount,
      extensionCounts,
      unparseableExtensionCounts,
      fieldPresenceCounts: coverage
    },
    issues: gaps.map((gap) => gap.reason)
  }],
  gaps,
  extraSummary: {
    sourceFound: true,
    documentCount: files.length,
    parseableDocumentCount,
    phiSafeOutput: true
  }
});
const outPath = writeNormalizedArtifact(artifact);
console.log(`Wrote ${outPath}`);
console.log(`Face sheet parser summary: ${files.length} document(s), ${parseableDocumentCount} text-extracted, ${gaps.length} gap(s).`);
