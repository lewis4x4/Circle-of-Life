import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { createNormalizedArtifact, writeNormalizedArtifact } from './ingestion-lib.mjs';

const INSPECTIONS_PATH = process.env.HOMEWOOD_INSPECTIONS_PATH || '/Users/brianlewis/Circle of Life/Circle of Life Wiki/Haven - Brian/2026 Inspections.xlsx';
const MAINTENANCE_CONTACT_PATH = process.env.HOMEWOOD_MAINTENANCE_CONTACT_PATH || '/Users/brianlewis/Circle of Life/Circle of Life Wiki/HR - Forms/Maintenance Contact List.pdf';
const HOMEWOOD_CONTRACTS = [
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/Management/Agreements/Homewood Lodge Termite Contract.pdf',
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/Management/Agreements/RingPower.Homewood.pdf',
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/Management/Agreements/NextSteps.Homewood.pdf',
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/Management/Agreements/FloridaLab.Homewood.pdf'
];

function pdfText(path) {
  try {
    return execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function countPhones(text) {
  return (text.match(/\b\d{3}[-.]\d{3}[-.]\d{4}\b/g) || []).length;
}

const records = [];
const gaps = [];
if (!existsSync(INSPECTIONS_PATH)) {
  gaps.push({ moduleCode: 'M13', fieldOrRecord: '2026 Inspections.xlsx', reason: '2026 inspections workbook is not present locally at the expected Haven - Brian path.', round: 'round_1', sourceId: 'src-inspections-vendors' });
}

if (existsSync(MAINTENANCE_CONTACT_PATH)) {
  const text = pdfText(MAINTENANCE_CONTACT_PATH);
  records.push({
    targetEntity: 'vendor_contact_directory_summary',
    sourceRowRef: 'inspections-vendors:maintenance-contact-list',
    validationStatus: text ? 'ready' : 'needs_review',
    moduleCodes: ['M18'],
    data: {
      file: basename(MAINTENANCE_CONTACT_PATH),
      textExtractable: Boolean(text),
      phoneEntryCount: countPhones(text),
      mentionsHomewood: /homewood/i.test(text),
      sizeBytes: statSync(MAINTENANCE_CONTACT_PATH).size
    },
    issues: text ? [] : ['Maintenance Contact List PDF was present but not text-extractable.']
  });
} else {
  gaps.push({ moduleCode: 'M18', fieldOrRecord: 'Maintenance Contact List.pdf', reason: 'Maintenance contact list is not present locally.', round: 'round_1', sourceId: 'src-inspections-vendors' });
}

let contractCount = 0;
let extractableContractCount = 0;
for (const path of HOMEWOOD_CONTRACTS) {
  if (!existsSync(path)) {
    gaps.push({ moduleCode: 'M18', fieldOrRecord: basename(path), reason: `Homewood vendor/contract PDF missing at ${path}`, round: 'round_1', sourceId: 'src-inspections-vendors' });
    continue;
  }
  contractCount += 1;
  const text = pdfText(path);
  const textExtractable = text.replace(/\s/g, '').length > 25;
  if (textExtractable) extractableContractCount += 1;
  records.push({
    targetEntity: 'vendor_contract_summary',
    sourceRowRef: `inspections-vendors:${basename(path).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    validationStatus: textExtractable ? 'ready' : 'needs_review',
    moduleCodes: ['M18'],
    data: { file: basename(path), sizeBytes: statSync(path).size, textExtractable },
    issues: textExtractable ? [] : ['Contract PDF appears scanned/image-based; OCR/manual review required for contract term and after-hours details.']
  });
}

const artifact = createNormalizedArtifact({
  sourceId: 'src-inspections-vendors',
  parserName: 'parse-inspections-vendors',
  sourceRefs: [
    { label: '2026 Inspections.xlsx', location: INSPECTIONS_PATH },
    { label: 'Maintenance Contact List.pdf', location: MAINTENANCE_CONTACT_PATH },
    ...HOMEWOOD_CONTRACTS.map((path) => ({ label: basename(path), location: path }))
  ],
  records,
  gaps,
  extraSummary: {
    inspectionsWorkbookFound: existsSync(INSPECTIONS_PATH),
    maintenanceContactFound: existsSync(MAINTENANCE_CONTACT_PATH),
    contractCount,
    extractableContractCount,
    phiSafeOutput: true
  }
});
const outPath = writeNormalizedArtifact(artifact);
console.log(`Wrote ${outPath}`);
console.log(`Inspections/vendors parser summary: inspectionsWorkbookFound=${artifact.summary.inspectionsWorkbookFound}, maintenanceContactFound=${artifact.summary.maintenanceContactFound}, contractCount=${contractCount}, gaps=${gaps.length}.`);
