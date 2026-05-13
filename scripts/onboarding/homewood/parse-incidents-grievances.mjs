import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { createNormalizedArtifact, writeNormalizedArtifact } from './ingestion-lib.mjs';

const DEFAULT_LOG_PATHS = [
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/HR - Forms/Incident Reporting Forms/Grievance Reports Log.xlsx',
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/HR - Forms/Incident Reporting Forms/Incident Reports Log.xlsx',
  '/Users/brianlewis/Documents/CIRCLE OF LIFE/Grievance Reports Log.xlsx'
];
const PDF_SOURCES = [
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/HR - Forms/Incident Reporting Forms/Grievance Reports Log.pdf',
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/HR - Forms/Incident Reporting Forms/Medication Incident Report.pdf',
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/HR - Forms/Incident Reporting Forms/Incident Reporting Procedure.pdf',
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/HR - Forms/Incident Reporting Forms/Grievance Form.pdf',
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/HR - Forms/Incident Reporting Forms/Elopement Incident Form.pdf',
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/HR - Forms/Incident Reporting Forms/Incident Reports Log.pdf'
];
const logPath = process.env.HOMEWOOD_INCIDENT_LOG_PATH || DEFAULT_LOG_PATHS.find((path) => existsSync(path)) || DEFAULT_LOG_PATHS[0];

function pdfTextLength(path) {
  try {
    return execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\s/g, '').length;
  } catch {
    return 0;
  }
}

const records = [];
const gaps = [];
if (!existsSync(logPath)) {
  gaps.push({ moduleCode: 'M16', fieldOrRecord: 'structured incident/grievance log workbook', reason: 'Structured incident/grievance workbook is not present locally; only PDF forms/log templates were found.', round: 'round_1', sourceId: 'src-incidents-grievances' });
}

let presentPdfCount = 0;
let extractablePdfCount = 0;
for (const path of PDF_SOURCES) {
  if (!existsSync(path)) {
    gaps.push({ moduleCode: 'M16', fieldOrRecord: basename(path), reason: `Expected incident/grievance PDF missing at ${path}`, round: 'round_1', sourceId: 'src-incidents-grievances' });
    continue;
  }
  presentPdfCount += 1;
  const textLength = pdfTextLength(path);
  const textExtractable = textLength > 25;
  if (textExtractable) extractablePdfCount += 1;
  records.push({
    targetEntity: 'incident_grievance_template_summary',
    sourceRowRef: `incidents-grievances:${basename(path).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    validationStatus: textExtractable ? 'ready' : 'needs_review',
    moduleCodes: ['M16'],
    data: { file: basename(path), sizeBytes: statSync(path).size, textExtractable },
    issues: textExtractable ? [] : ['PDF appears scanned/image-based; OCR/manual template transcription required for field-level import.']
  });
}
if (presentPdfCount > 0 && extractablePdfCount === 0) {
  gaps.push({ moduleCode: 'M16', fieldOrRecord: 'incident/grievance PDF field extraction', reason: 'Incident/grievance PDFs are present but not text-extractable locally; OCR/manual transcription required.', round: 'round_1', sourceId: 'src-incidents-grievances' });
}

const artifact = createNormalizedArtifact({
  sourceId: 'src-incidents-grievances',
  parserName: 'parse-incidents-grievances',
  sourceRefs: [
    { label: 'Structured incident/grievance log workbook', location: logPath },
    ...PDF_SOURCES.map((path) => ({ label: basename(path), location: path }))
  ],
  records,
  gaps,
  extraSummary: {
    structuredLogFound: existsSync(logPath),
    presentPdfCount,
    extractablePdfCount,
    phiSafeOutput: true
  }
});
const outPath = writeNormalizedArtifact(artifact);
console.log(`Wrote ${outPath}`);
console.log(`Incident/grievance parser summary: structuredLogFound=${artifact.summary.structuredLogFound}, presentPdfCount=${presentPdfCount}, extractablePdfCount=${extractablePdfCount}, gaps=${gaps.length}.`);
