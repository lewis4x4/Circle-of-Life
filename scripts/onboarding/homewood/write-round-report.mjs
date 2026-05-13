import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listNormalizedArtifacts } from './ingestion-lib.mjs';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const manifestPath = resolve(root, 'facility-launch-center/data/homewood-ingestion-manifest.json');
const validationSummaryPath = resolve(root, '.omx/artifacts/homewood-ingestion/manifest-validation-summary.json');
const outDir = resolve(root, '.omx/artifacts/homewood-ingestion');
const roundOnePath = resolve(outDir, 'HOMEWOOD-ROUND-1-STATUS.md');
const roundTwoPath = resolve(outDir, 'HOMEWOOD-ROUND-2-GAPS.md');
const durableStatusPath = resolve(root, 'docs/specs/HOMEWOOD-ROUND-1-INGESTION-STATUS-2026-05-13.md');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function row(cells) {
  return `| ${cells.map((cell) => String(cell ?? '').replace(/\n/g, ' ')).join(' | ')} |`;
}

const manifest = readJson(manifestPath);
const summary = readJson(validationSummaryPath);
const sources = [...manifest.sources].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
const roundOneSources = sources.filter((source) => source.round === 'round_1');
const gapSeeds = sources.filter((source) => source.round === 'round_2' || String(source.status).startsWith('gap'));
const normalizedArtifacts = listNormalizedArtifacts();
const artifactGaps = normalizedArtifacts.flatMap((artifact) =>
  (artifact.gaps || []).map((gap) => ({
    sourceId: artifact.sourceId,
    moduleCode: gap.moduleCode,
    round: gap.round,
    fieldOrRecord: gap.fieldOrRecord,
    reason: gap.reason
  }))
);
const roundOneArtifactGapCount = artifactGaps.filter((gap) => gap.round === 'round_1').length;
const roundTwoArtifactGapCount = artifactGaps.filter((gap) => gap.round === 'round_2').length;
const totalReadyRecords = normalizedArtifacts.reduce((sum, artifact) => sum + (artifact.summary.readyCount || 0), 0);
const totalNeedsReviewRecords = normalizedArtifacts.reduce((sum, artifact) => sum + (artifact.summary.needsReviewCount || 0), 0);
const totalRecords = normalizedArtifacts.reduce((sum, artifact) => sum + (artifact.summary.recordCount || 0), 0);

const generatedAt = new Date().toISOString();

const roundOneLines = [
  '# Homewood Round 1 Ingestion Status',
  '',
  `Generated: ${generatedAt}`,
  `Facility: ${manifest.facilityName} (${manifest.facilityId})`,
  '',
  'This is a generated control report. It contains source/module/status metadata only; do not add PHI here.',
  '',
  '## Summary',
  '',
  `- Sources in manifest: ${summary.sourceCount}`,
  `- Round 1 sources: ${roundOneSources.length}`,
  `- Sensitive/PHI source categories: ${summary.phiSourceCount}`,
  `- Manifest validation errors: ${summary.errorCount}`,
  `- Round 2 seed gaps: ${gapSeeds.length}`,
  `- Normalized artifacts generated: ${normalizedArtifacts.length}`,
  `- Parsed records: ${totalRecords}`,
  `- Ready records: ${totalReadyRecords}`,
  `- Needs-review records: ${totalNeedsReviewRecords}`,
  `- Parser-discovered Round 1 gaps: ${roundOneArtifactGapCount}`,
  `- Parser-discovered Round 2 gaps: ${roundTwoArtifactGapCount}`,
  '',
  '## Round 1 Source Queue',
  '',
  row(['Source ID', 'Modules', 'Status', 'Target entities', 'Validation rules']),
  row(['---', '---', '---', '---', '---']),
  ...roundOneSources.map((source) => row([
    source.sourceId,
    source.moduleCodes.join(', '),
    source.status,
    source.targetEntities.join(', '),
    source.validationRules.join('; ')
  ])),
  '',
  '## Normalized Artifacts Generated',
  '',
  normalizedArtifacts.length ? row(['Source ID', 'Records', 'Ready', 'Needs review', 'Gaps', 'Parser']) : '_No normalized artifacts generated yet._',
  normalizedArtifacts.length ? row(['---', '---', '---', '---', '---', '---']) : '',
  ...normalizedArtifacts.map((artifact) => row([
    artifact.sourceId,
    artifact.summary.recordCount,
    artifact.summary.readyCount,
    artifact.summary.needsReviewCount,
    artifact.summary.gapCount,
    `${artifact.parser.name}@${artifact.parser.version}`
  ])),
  '',
  '## Current Rule',
  '',
  'Import every available Round 1 source. If a field, resident, staff member, vendor, prospect, or source file is missing or ambiguous, write a gap record and continue with the next importable source.',
  '',
  '## Parser-Discovered Gaps',
  '',
  artifactGaps.length ? row(['Source ID', 'Module', 'Round', 'Field/source', 'Reason']) : '_No parser-discovered gaps._',
  artifactGaps.length ? row(['---', '---', '---', '---', '---']) : '',
  ...artifactGaps.map((gap) => row([
    gap.sourceId,
    gap.moduleCode,
    gap.round,
    gap.fieldOrRecord,
    gap.reason
  ]))
];

const roundTwoLines = [
  '# Homewood Round 2 Gap Seeds',
  '',
  `Generated: ${generatedAt}`,
  `Facility: ${manifest.facilityName} (${manifest.facilityId})`,
  '',
  'These are not blockers for Round 1 unless a downstream import cannot link records safely.',
  '',
  row(['Source ID', 'Modules', 'Status', 'Known gaps']),
  row(['---', '---', '---', '---']),
  ...gapSeeds.map((source) => row([
    source.sourceId,
    source.moduleCodes.join(', '),
    source.status,
    source.knownGaps.join('; ') || 'TBD after parser run'
  ])),
  '',
  '## Parser-Discovered Gaps',
  '',
  artifactGaps.length ? row(['Source ID', 'Module', 'Round', 'Field/source', 'Reason']) : '_No parser-discovered gaps._',
  artifactGaps.length ? row(['---', '---', '---', '---', '---']) : '',
  ...artifactGaps.map((gap) => row([
    gap.sourceId,
    gap.moduleCode,
    gap.round,
    gap.fieldOrRecord,
    gap.reason
  ]))
];

const durableStatusLines = [
  '# Homewood Round 1 Real Ingestion Status — 2026-05-13',
  '',
  `Generated: ${generatedAt}`,
  '',
  'This report is intentionally PHI-safe. It records source coverage, parser readiness, and missing-source gaps only.',
  '',
  '## What is now in place',
  '',
  '- Seed reset path now preserves an empty onboarding shell instead of repopulating demo Homewood data.',
  '- Homewood ingestion manifest defines 16 source categories and their target modules/entities.',
  '- Round 1 parsers generate normalized artifacts for every manifest source category, including explicit gap artifacts when a source is missing.',
  '- Insurance source-of-truth is resolved to `HOMEWOOD GL CERT.pdf` and `HOMEWOOD PROPERTY Policy.pdf`; duplicate uploads are ignored.',
  '- QuickMar remains external; Haven expects a daily QuickMar export sample/folder for the n8n import workflow.',
  '',
  '## Current artifact totals',
  '',
  `- Normalized source artifacts: ${normalizedArtifacts.length}/${sources.length}`,
  `- Parsed records: ${totalRecords}`,
  `- Ready records: ${totalReadyRecords}`,
  `- Needs-review records: ${totalNeedsReviewRecords}`,
  `- Parser-discovered gaps: ${artifactGaps.length}`,
  '',
  '## Normalized artifacts generated',
  '',
  normalizedArtifacts.length ? row(['Source ID', 'Records', 'Ready', 'Needs review', 'Gaps', 'Parser']) : '_No normalized artifacts generated yet._',
  normalizedArtifacts.length ? row(['---', '---', '---', '---', '---', '---']) : '',
  ...normalizedArtifacts.map((artifact) => row([
    artifact.sourceId,
    artifact.summary.recordCount,
    artifact.summary.readyCount,
    artifact.summary.needsReviewCount,
    artifact.summary.gapCount,
    `${artifact.parser.name}@${artifact.parser.version}`
  ])),
  '',
  '## Remaining gaps for second pass',
  '',
  artifactGaps.length ? row(['Source ID', 'Module', 'Round', 'Field/source', 'Reason']) : '_No parser-discovered gaps._',
  artifactGaps.length ? row(['---', '---', '---', '---', '---']) : '',
  ...artifactGaps.map((gap) => row([
    gap.sourceId,
    gap.moduleCode,
    gap.round,
    gap.fieldOrRecord,
    gap.reason
  ])),
  '',
  '## Next best step',
  '',
  'Use the generated normalized artifacts as the Round 1 input package, import everything with `validationStatus: ready`, queue `needs_review` records for human review, and collect the listed gaps for Round 2. Do not wait on Round 2 sources before loading ready Round 1 data.'
];

mkdirSync(dirname(roundOnePath), { recursive: true });
writeFileSync(roundOnePath, `${roundOneLines.join('\n')}\n`);
writeFileSync(roundTwoPath, `${roundTwoLines.join('\n')}\n`);
writeFileSync(durableStatusPath, `${durableStatusLines.join('\n')}\n`);

console.log(`Wrote ${roundOnePath}`);
console.log(`Wrote ${roundTwoPath}`);
console.log(`Wrote ${durableStatusPath}`);
