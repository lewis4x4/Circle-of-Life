import { existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { createNormalizedArtifact, writeNormalizedArtifact } from './ingestion-lib.mjs';

const DOCS = [
  { group: 'gl_cert', title: 'HOMEWOOD GL CERT.pdf', path: '/Users/brianlewis/Documents/CIRCLE OF LIFE/HOMEWOOD GL CERT.pdf', sourceOfTruth: true, duplicateIgnored: false, moduleCode: 'M17' },
  { group: 'property_policy', title: 'HOMEWOOD PROPERTY Policy.pdf', path: '/Users/brianlewis/Documents/CIRCLE OF LIFE/HOMEWOOD PROPERTY Policy.pdf', sourceOfTruth: true, duplicateIgnored: false, moduleCode: 'M17' },
  { group: 'bond_certificate', title: 'HOMEWOOD BOND CERTIFICATE.pdf', path: '/Users/brianlewis/Documents/CIRCLE OF LIFE/HOMEWOOD BOND CERTIFICATE.pdf', sourceOfTruth: true, duplicateIgnored: false, moduleCode: 'M17' },
  { group: 'loss_run', title: 'Smith & Sorensen Loss Run.pdf', path: '/Users/brianlewis/Documents/CIRCLE OF LIFE/Smith & Sorensen Loss Run.pdf', sourceOfTruth: true, duplicateIgnored: false, moduleCode: 'M17' },
  { group: 'gl_cert', title: 'HOMEWOOD GL CERT 2.pdf', path: '/Users/brianlewis/Documents/CIRCLE OF LIFE/HOMEWOOD GL CERT 2.pdf', sourceOfTruth: false, duplicateIgnored: true, moduleCode: 'M17' },
  { group: 'property_policy', title: 'HOMEWOOD PROPERTY POLICY 2.pdf', path: '/Users/brianlewis/Documents/CIRCLE OF LIFE/HOMEWOOD PROPERTY POLICY 2.pdf', sourceOfTruth: false, duplicateIgnored: true, moduleCode: 'M17' }
];

const records = [];
const gaps = [];
for (const doc of DOCS) {
  if (!existsSync(doc.path)) {
    gaps.push({ moduleCode: doc.moduleCode, fieldOrRecord: doc.title, reason: `Expected insurance/compliance document missing at ${doc.path}`, round: 'round_1', sourceId: 'src-insurance-docs' });
    continue;
  }
  records.push({
    targetEntity: 'document_source_of_truth',
    sourceRowRef: `insurance-doc:${doc.group}:${basename(doc.path).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    validationStatus: doc.duplicateIgnored ? 'skipped' : 'ready',
    moduleCodes: [doc.moduleCode],
    data: {
      artifactType: doc.group,
      title: doc.title,
      filePresent: true,
      sourceOfTruth: doc.sourceOfTruth,
      duplicateIgnored: doc.duplicateIgnored,
      sizeBytes: statSync(doc.path).size
    },
    issues: doc.duplicateIgnored ? ['Duplicate re-upload intentionally ignored per owner decision.'] : []
  });
}

const sourceTruthByGroup = new Map();
for (const record of records) {
  const data = record.data;
  if (!data.duplicateIgnored && data.sourceOfTruth) sourceTruthByGroup.set(data.artifactType, (sourceTruthByGroup.get(data.artifactType) || 0) + 1);
}
for (const group of ['gl_cert', 'property_policy']) {
  if ((sourceTruthByGroup.get(group) || 0) !== 1) gaps.push({ moduleCode: 'M17', fieldOrRecord: `${group} source-of-truth`, reason: `Expected exactly one active source-of-truth for ${group}.`, round: 'round_1', sourceId: 'src-insurance-docs' });
}

const artifact = createNormalizedArtifact({
  sourceId: 'src-insurance-docs',
  parserName: 'parse-insurance-docs',
  sourceRefs: DOCS.map((doc) => ({ label: doc.title, location: doc.path })),
  records,
  gaps,
  extraSummary: {
    presentDocumentCount: records.length,
    activeSourceOfTruthCount: records.filter((record) => record.data.sourceOfTruth && !record.data.duplicateIgnored).length,
    ignoredDuplicateCount: records.filter((record) => record.data.duplicateIgnored).length,
    phiSafeOutput: true
  }
});
const outPath = writeNormalizedArtifact(artifact);
console.log(`Wrote ${outPath}`);
console.log(`Insurance parser summary: present=${artifact.summary.presentDocumentCount}, activeSot=${artifact.summary.activeSourceOfTruthCount}, ignoredDuplicates=${artifact.summary.ignoredDuplicateCount}, gaps=${gaps.length}.`);
