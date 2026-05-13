import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const manifestPath = resolve(root, 'facility-launch-center/data/homewood-ingestion-manifest.json');
const outPath = resolve(root, '.omx/artifacts/homewood-ingestion/manifest-validation-summary.json');

const REQUIRED_SOURCE_FIELDS = [
  'sourceId',
  'moduleCodes',
  'sourceName',
  'sourceType',
  'targetEntities',
  'containsPhiOrSensitiveData',
  'status',
  'round',
  'validationRules',
  'knownGaps'
];
const ALLOWED_STATUSES = new Set([
  'ready_to_parse',
  'ready_to_parse_sensitive',
  'ready_for_workflow_design',
  'parsed_reference',
  'source_resolved',
  'ready_to_parse_needs_scope_review',
  'gap_pending_source',
  'parsed',
  'imported',
  'gap',
  'deferred',
  'needs_review'
]);
const ALLOWED_ROUNDS = new Set(['round_1', 'round_2']);
const ALLOWED_MODULE_CODES = new Set(Array.from({ length: 19 }, (_, index) => `M${index + 1}`));

function fail(message) {
  throw new Error(message);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!manifest.facilityId) fail('manifest.facilityId is required');
if (!manifest.facilityName) fail('manifest.facilityName is required');
if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) fail('manifest.sources must be a non-empty array');

const seen = new Set();
const issues = [];
const statusCounts = {};
const moduleCoverage = {};
const roundCounts = {};
const phiSources = [];
const roundTwoSeeds = [];

for (const [index, source] of manifest.sources.entries()) {
  for (const field of REQUIRED_SOURCE_FIELDS) {
    if (!(field in source)) issues.push({ sourceId: source.sourceId || `index:${index}`, severity: 'error', message: `Missing required field ${field}` });
  }
  if (source.sourceId) {
    if (seen.has(source.sourceId)) issues.push({ sourceId: source.sourceId, severity: 'error', message: 'Duplicate sourceId' });
    seen.add(source.sourceId);
  }
  if (!ALLOWED_STATUSES.has(source.status)) issues.push({ sourceId: source.sourceId, severity: 'error', message: `Unknown status ${source.status}` });
  if (!ALLOWED_ROUNDS.has(source.round)) issues.push({ sourceId: source.sourceId, severity: 'error', message: `Unknown round ${source.round}` });
  if (!asArray(source.moduleCodes).length) issues.push({ sourceId: source.sourceId, severity: 'error', message: 'At least one moduleCode is required' });
  if (!asArray(source.targetEntities).length) issues.push({ sourceId: source.sourceId, severity: 'warning', message: 'No targetEntities listed' });
  if (!asArray(source.validationRules).length) issues.push({ sourceId: source.sourceId, severity: 'warning', message: 'No validationRules listed' });

  statusCounts[source.status] = (statusCounts[source.status] || 0) + 1;
  roundCounts[source.round] = (roundCounts[source.round] || 0) + 1;
  for (const moduleCode of asArray(source.moduleCodes)) {
    if (!ALLOWED_MODULE_CODES.has(moduleCode)) {
      issues.push({ sourceId: source.sourceId, severity: 'error', message: `Unknown moduleCode ${moduleCode}` });
      continue;
    }
    moduleCoverage[moduleCode] = moduleCoverage[moduleCode] || [];
    moduleCoverage[moduleCode].push(source.sourceId);
  }
  if (source.containsPhiOrSensitiveData) phiSources.push(source.sourceId);
  if (source.round === 'round_2' || String(source.status || '').startsWith('gap')) {
    roundTwoSeeds.push({ sourceId: source.sourceId, moduleCodes: source.moduleCodes, knownGaps: source.knownGaps || [] });
  }
}

const errorCount = issues.filter((issue) => issue.severity === 'error').length;
const summary = {
  validatedAt: new Date().toISOString(),
  manifestPath,
  facilityId: manifest.facilityId,
  facilityName: manifest.facilityName,
  sourceCount: manifest.sources.length,
  statusCounts,
  roundCounts,
  moduleCoverage,
  phiSourceCount: phiSources.length,
  phiSources,
  roundTwoSeeds,
  issueCount: issues.length,
  errorCount,
  issues
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log(`Homewood ingestion manifest: ${manifest.sources.length} sources, ${phiSources.length} sensitive/PHI sources, ${roundTwoSeeds.length} Round 2 seed(s).`);
console.log(`Wrote ${outPath}`);
if (errorCount > 0) fail(`Manifest validation failed with ${errorCount} error(s)`);
