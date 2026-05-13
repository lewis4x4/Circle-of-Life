import { resolve } from 'node:path';
import {
  listNormalizedArtifacts,
  normalizedDir,
  normalizedArtifactPath,
  readManifest,
  validateNormalizedArtifact
} from './ingestion-lib.mjs';

const manifest = readManifest();
const artifacts = listNormalizedArtifacts();
const bySource = new Map(artifacts.map((artifact) => [artifact.sourceId, artifact]));
const errors = [];
const sensitiveSourceIds = new Set(manifest.sources.filter((source) => source.containsPhiOrSensitiveData).map((source) => source.sourceId));

for (const source of manifest.sources) {
  const artifact = bySource.get(source.sourceId);
  if (!artifact) {
    errors.push(`Missing normalized artifact for ${source.sourceId}`);
    continue;
  }
  for (const error of validateNormalizedArtifact(artifact)) errors.push(`${source.sourceId}: ${error}`);
  if (artifact.facilityId !== manifest.facilityId) errors.push(`${source.sourceId}: facilityId ${artifact.facilityId} does not match manifest ${manifest.facilityId}`);
  if (Boolean(artifact.summary.containsPhiOrSensitiveData) !== Boolean(source.containsPhiOrSensitiveData)) errors.push(`${source.sourceId}: sensitive flag does not match manifest`);
  const artifactPath = resolve(normalizedArtifactPath(source.sourceId));
  if (!artifactPath.startsWith(resolve(normalizedDir))) errors.push(`${source.sourceId}: artifact path outside normalized artifact dir`);

  if (sensitiveSourceIds.has(source.sourceId)) {
    if (artifact.summary.phiSafeOutput !== true) errors.push(`${source.sourceId}: sensitive source must set summary.phiSafeOutput=true`);
    const serialized = JSON.stringify({ records: artifact.records, gaps: artifact.gaps });
    const forbiddenPatterns = [
      [/\b\d{3}-\d{2}-\d{4}\b/, 'SSN-like value'],
      [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, 'email-like value'],
      [/\b\d{3}[-.]\d{3}[-.]\d{4}\b/, 'phone-like value']
    ];
    for (const [pattern, label] of forbiddenPatterns) {
      if (pattern.test(serialized)) errors.push(`${source.sourceId}: sensitive artifact contains ${label}`);
    }
  }
}

for (const artifact of artifacts) {
  if (!manifest.sources.some((source) => source.sourceId === artifact.sourceId)) errors.push(`Artifact exists for source not in manifest: ${artifact.sourceId}`);
}

if (errors.length > 0) {
  console.error(`Homewood normalized artifact validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Homewood normalized artifacts valid: ${artifacts.length}/${manifest.sources.length} source artifact(s), ${sensitiveSourceIds.size} sensitive source(s) PHI-guarded.`);
