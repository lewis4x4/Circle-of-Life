import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
export const artifactDir = resolve(root, '.omx/artifacts/homewood-ingestion');
export const normalizedDir = resolve(artifactDir, 'normalized');
export const manifestPath = resolve(root, 'facility-launch-center/data/homewood-ingestion-manifest.json');

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function readManifest() {
  return readJson(manifestPath);
}

export function sourceById(sourceId) {
  const source = readManifest().sources.find((entry) => entry.sourceId === sourceId);
  if (!source) throw new Error(`Unknown sourceId ${sourceId}`);
  return source;
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function writeJson(path, payload) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

export function normalizedArtifactPath(sourceId) {
  return resolve(normalizedDir, `${sourceId}.json`);
}

export function createNormalizedArtifact({ sourceId, parserName, parserVersion = '1.0.0', sourceRefs = [], records = [], gaps = [], extraSummary = {} }) {
  const source = sourceById(sourceId);
  const readyCount = records.filter((record) => record.validationStatus === 'ready').length;
  const needsReviewCount = records.filter((record) => record.validationStatus === 'needs_review').length;
  const skippedCount = records.filter((record) => record.validationStatus === 'skipped').length;
  return {
    artifactVersion: 'homewood-normalized-v1',
    facilityId: 'fac-homewood',
    sourceId,
    parser: { name: parserName, version: parserVersion },
    generatedAt: new Date().toISOString(),
    sourceRefs,
    summary: {
      recordCount: records.length,
      readyCount,
      needsReviewCount,
      skippedCount,
      gapCount: gaps.length,
      containsPhiOrSensitiveData: Boolean(source.containsPhiOrSensitiveData),
      moduleCodes: source.moduleCodes,
      targetEntities: source.targetEntities,
      ...extraSummary
    },
    records,
    gaps
  };
}

export function validateNormalizedArtifact(artifact) {
  const errors = [];
  if (artifact.artifactVersion !== 'homewood-normalized-v1') errors.push('artifactVersion must be homewood-normalized-v1');
  if (artifact.facilityId !== 'fac-homewood') errors.push('facilityId must be fac-homewood');
  if (!artifact.sourceId) errors.push('sourceId is required');
  if (!artifact.parser?.name || !artifact.parser?.version) errors.push('parser.name and parser.version are required');
  if (!Date.parse(artifact.generatedAt)) errors.push('generatedAt must be an ISO date-time');
  if (!artifact.summary || typeof artifact.summary !== 'object') errors.push('summary is required');
  for (const key of ['recordCount', 'readyCount', 'needsReviewCount', 'gapCount']) {
    if (!Number.isInteger(artifact.summary?.[key]) || artifact.summary[key] < 0) errors.push(`summary.${key} must be a non-negative integer`);
  }
  if (typeof artifact.summary?.containsPhiOrSensitiveData !== 'boolean') errors.push('summary.containsPhiOrSensitiveData must be boolean');
  if (!Array.isArray(artifact.records)) errors.push('records must be an array');
  if (!Array.isArray(artifact.gaps)) errors.push('gaps must be an array');
  for (const [index, record] of (artifact.records || []).entries()) {
    if (!record.targetEntity) errors.push(`records[${index}].targetEntity is required`);
    if (!record.sourceRowRef) errors.push(`records[${index}].sourceRowRef is required`);
    if (!['ready', 'needs_review', 'gap', 'skipped'].includes(record.validationStatus)) errors.push(`records[${index}].validationStatus is invalid`);
    if (!record.data || typeof record.data !== 'object') errors.push(`records[${index}].data object is required`);
  }
  for (const [index, gap] of (artifact.gaps || []).entries()) {
    if (!gap.moduleCode) errors.push(`gaps[${index}].moduleCode is required`);
    if (!gap.fieldOrRecord) errors.push(`gaps[${index}].fieldOrRecord is required`);
    if (!gap.reason) errors.push(`gaps[${index}].reason is required`);
    if (!['round_1', 'round_2'].includes(gap.round)) errors.push(`gaps[${index}].round is invalid`);
  }
  return errors;
}

export function writeNormalizedArtifact(artifact) {
  const errors = validateNormalizedArtifact(artifact);
  if (errors.length > 0) throw new Error(`Invalid normalized artifact ${artifact.sourceId}: ${errors.join('; ')}`);
  const path = normalizedArtifactPath(artifact.sourceId);
  writeJson(path, artifact);
  return path;
}

export function listNormalizedArtifacts() {
  try {
    return readdirSync(normalizedDir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => readJson(resolve(normalizedDir, name)));
  } catch {
    return [];
  }
}

export function decodeXmlEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function extractDocxText(path) {
  const xml = execFileSync('unzip', ['-p', path, 'word/document.xml'], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
  return decodeXmlEntities(xml)
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, '').trimStart())
    .filter(Boolean)
    .join('\n');
}

export function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function columnLettersToIndex(ref) {
  const letters = String(ref || '').match(/^[A-Z]+/i)?.[0]?.toUpperCase() || '';
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return Math.max(0, index - 1);
}

function xmlAttr(tag, name) {
  return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] || '';
}

function extractXmlText(xml) {
  return decodeXmlEntities(String(xml || '').replace(/<[^>]+>/g, ''));
}

export function extractXlsxSheets(path) {
  const sharedStringsXml = (() => {
    try {
      return execFileSync('unzip', ['-p', path, 'xl/sharedStrings.xml'], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return '';
    }
  })();
  const sharedStrings = [];
  for (const match of sharedStringsXml.matchAll(/<si[\s\S]*?<\/si>/g)) {
    sharedStrings.push(extractXmlText(match[0]));
  }

  const workbookXml = execFileSync('unzip', ['-p', path, 'xl/workbook.xml'], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
  const relsXml = execFileSync('unzip', ['-p', path, 'xl/_rels/workbook.xml.rels'], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
  const relTargets = new Map();
  for (const relMatch of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = relMatch[0];
    const id = xmlAttr(tag, 'Id');
    const target = xmlAttr(tag, 'Target');
    if (id && target) relTargets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  }

  const sheets = [];
  for (const sheetMatch of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const tag = sheetMatch[0];
    const name = decodeXmlEntities(xmlAttr(tag, 'name'));
    const relId = xmlAttr(tag, 'r:id');
    const target = relTargets.get(relId);
    if (!target) continue;
    const sheetXml = execFileSync('unzip', ['-p', path, target], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 }).replace(/<c\b([^>]*)\/>/g, '<c$1></c>');
    const rows = [];
    for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g)) {
      const cells = [];
      for (const cellMatch of rowMatch[0].matchAll(/<c\b[^>]*>[\s\S]*?<\/c>/g)) {
        const cellXml = cellMatch[0];
        const cellOpen = cellXml.match(/<c\b[^>]*>/)?.[0] || '';
        const ref = xmlAttr(cellOpen, 'r');
        const type = xmlAttr(cellOpen, 't');
        const index = columnLettersToIndex(ref);
        let value = '';
        if (type === 's') {
          const sharedIndex = Number.parseInt(cellXml.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] || '', 10);
          value = Number.isInteger(sharedIndex) ? sharedStrings[sharedIndex] || '' : '';
        } else if (type === 'inlineStr') {
          value = extractXmlText(cellXml.match(/<is[^>]*>[\s\S]*?<\/is>/)?.[0] || '');
        } else {
          value = decodeXmlEntities(cellXml.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] || '');
        }
        cells[index] = String(value).trim();
      }
      rows.push(Array.from({ length: cells.length }, (_, index) => cells[index] || ''));
    }
    sheets.push({ name, rows });
  }
  return sheets;
}
