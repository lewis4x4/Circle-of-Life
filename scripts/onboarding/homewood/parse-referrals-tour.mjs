import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import {
  createNormalizedArtifact,
  writeNormalizedArtifact
} from './ingestion-lib.mjs';

const DEFAULT_REFERRAL_LOG_PATHS = [
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/Daily Logs/Referral Log.xlsx',
  '/Users/brianlewis/Documents/CIRCLE OF LIFE/Referral Log.xlsx'
];
const TOUR_FORMS = [
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/HR - Forms/Tour Satisfactory Forms/Tour Inquiry Form.pdf',
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/HR - Forms/Tour Satisfactory Forms/Tour Checklist.pdf',
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/HR - Forms/Tour Satisfactory Forms/Tour Survey.pdf'
];
const referralLogPath = process.env.HOMEWOOD_REFERRAL_LOG_PATH || DEFAULT_REFERRAL_LOG_PATHS.find((path) => existsSync(path)) || DEFAULT_REFERRAL_LOG_PATHS[0];
const tourFormPaths = (process.env.HOMEWOOD_TOUR_FORM_PATHS || TOUR_FORMS.join(':')).split(':').filter(Boolean);

function pdfTextLength(path) {
  try {
    return execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\s/g, '').length;
  } catch {
    return 0;
  }
}

const gaps = [];
const records = [];

if (!existsSync(referralLogPath)) {
  gaps.push({ moduleCode: 'M14', fieldOrRecord: 'Referral Log.xlsx', reason: 'Active referral log is not present locally yet. Set HOMEWOOD_REFERRAL_LOG_PATH when available.', round: 'round_1', sourceId: 'src-referrals-tour' });
} else {
  records.push({
    targetEntity: 'admissions_pipeline_source_summary',
    sourceRowRef: 'referrals-tour:referral-log',
    validationStatus: 'needs_review',
    moduleCodes: ['M14'],
    data: { sourceType: 'referral_log', file: basename(referralLogPath), sizeBytes: statSync(referralLogPath).size },
    issues: ['Workbook source exists; active Homewood filter and row-level mapping still need PHI-safe parser pass.']
  });
}

let presentTourForms = 0;
let extractableTourForms = 0;
for (const path of tourFormPaths) {
  if (!existsSync(path)) {
    gaps.push({ moduleCode: 'M14', fieldOrRecord: basename(path), reason: `Tour form missing locally at ${path}`, round: 'round_1', sourceId: 'src-referrals-tour' });
    continue;
  }
  presentTourForms += 1;
  const textLength = pdfTextLength(path);
  if (textLength > 25) extractableTourForms += 1;
  records.push({
    targetEntity: 'tour_form_template_summary',
    sourceRowRef: `referrals-tour:${basename(path).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    validationStatus: textLength > 25 ? 'ready' : 'needs_review',
    moduleCodes: ['M14'],
    data: { sourceType: 'tour_form_template', file: basename(path), sizeBytes: statSync(path).size, textExtractable: textLength > 25 },
    issues: textLength > 25 ? [] : ['PDF appears scanned/image-based; field extraction requires OCR or manual template transcription.']
  });
}

if (presentTourForms > 0 && extractableTourForms === 0) {
  gaps.push({ moduleCode: 'M14', fieldOrRecord: 'tour form field extraction', reason: 'Tour form PDFs are present but not text-extractable with local pdftotext; OCR/manual transcription required before field-level import.', round: 'round_1', sourceId: 'src-referrals-tour' });
}

const artifact = createNormalizedArtifact({
  sourceId: 'src-referrals-tour',
  parserName: 'parse-referrals-tour',
  sourceRefs: [
    { label: 'Referral Log.xlsx', location: referralLogPath },
    ...tourFormPaths.map((path) => ({ label: basename(path), location: path }))
  ],
  records,
  gaps,
  extraSummary: {
    referralLogFound: existsSync(referralLogPath),
    presentTourForms,
    extractableTourForms,
    phiSafeOutput: true
  }
});
const outPath = writeNormalizedArtifact(artifact);
console.log(`Wrote ${outPath}`);
console.log(`Referral/tour parser summary: referralLogFound=${artifact.summary.referralLogFound}, presentTourForms=${presentTourForms}, extractableTourForms=${extractableTourForms}, gaps=${gaps.length}.`);
