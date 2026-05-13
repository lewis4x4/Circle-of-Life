import { existsSync } from 'node:fs';
import {
  createNormalizedArtifact,
  extractDocxText,
  normalizedArtifactPath,
  slug,
  writeNormalizedArtifact
} from './ingestion-lib.mjs';

const DEFAULT_FACILITY_MASTER_PATH = '/Users/brianlewis/Circle of Life/Circle of Life Wiki/Management/Facilities Information.docx';
const sourcePath = process.env.HOMEWOOD_FACILITY_MASTER_PATH || DEFAULT_FACILITY_MASTER_PATH;

function parseTitle(title) {
  const match = title.match(/^(.*?)D\/B\/A\s*(.*)$/i);
  if (match) return { legalName: match[1].trim(), dba: match[2].trim() };
  return { legalName: title.trim(), dba: title.trim() };
}

function normalizeKey(key) {
  return String(key || '')
    .toLowerCase()
    .replace(/#/g, 'number')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function parseFacilityMasterText(text) {
  const rows = [];
  let current = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split('\t').map((part) => part.trim()).filter(Boolean);
    if (parts.length === 1) {
      if (current) rows.push(current);
      current = { sourceTitle: parts[0], ...parseTitle(parts[0]), fields: {} };
      continue;
    }
    if (!current) continue;
    const [key, ...rest] = parts;
    current.fields[normalizeKey(key)] = rest.join(' ').trim();
  }
  if (current) rows.push(current);
  return rows;
}

function mapFacility(row) {
  const fields = row.fields;
  const cityStateZip = fields.city_state_zip_code || '';
  const cityStateZipMatch = cityStateZip.match(/^(.*?),\s*([A-Z]{2})\s+(.*)$/);
  const dba = row.dba || row.legalName;
  return {
    id: dba.toLowerCase().includes('homewood') ? 'fac-homewood' : `fac-${slug(dba)}`,
    legalName: row.legalName,
    dba,
    addressLine1: fields.address || '',
    city: cityStateZipMatch?.[1] || '',
    state: cityStateZipMatch?.[2] || '',
    postalCode: cityStateZipMatch?.[3] || '',
    phone: fields.phone_number || '',
    fax: fields.fax_number || '',
    medicaidNumber: fields.medicaid_number || '',
    npi: fields.npi_number || '',
    taxId: fields.tax_id_number || '',
    taxonomyCode: fields.taxonomy_code || '',
    bedCapacity: Number.parseInt(fields.total_beds || '', 10),
    managerName: fields.manager || '',
    administratorName: fields.administrator || ''
  };
}

function buildRoomRecords() {
  const records = [];
  for (let roomNumber = 1; roomNumber <= 20; roomNumber += 1) {
    const privateSingle = roomNumber <= 4;
    records.push({
      targetEntity: 'rooms',
      sourceRowRef: `homewood-room-${roomNumber}`,
      validationStatus: 'ready',
      moduleCodes: ['M3'],
      data: {
        facilityId: 'fac-homewood',
        roomNumber: String(roomNumber),
        floor: '1',
        wing: 'None — single floor',
        unitType: privateSingle ? 'Private single' : 'Companion double',
        bedCount: privateSingle ? 1 : 2,
        careDesignation: 'Standard facility',
        status: 'active'
      },
      issues: []
    });
  }
  return records;
}

if (!existsSync(sourcePath)) {
  const gapArtifact = createNormalizedArtifact({
    sourceId: 'src-facility-master',
    parserName: 'parse-foundation',
    sourceRefs: [{ label: 'Facilities Information.docx', location: sourcePath }],
    gaps: [{
      moduleCode: 'M1',
      fieldOrRecord: 'Facilities Information.docx',
      reason: `Source file not found at ${sourcePath}`,
      round: 'round_1',
      sourceId: 'src-facility-master'
    }]
  });
  writeNormalizedArtifact(gapArtifact);
  throw new Error(`Source file not found: ${sourcePath}`);
}

const text = extractDocxText(sourcePath);
const facilities = parseFacilityMasterText(text).map(mapFacility);
const homewood = facilities.find((facility) => facility.id === 'fac-homewood' || facility.dba.toLowerCase().includes('homewood'));
const gaps = [];

if (!homewood) {
  gaps.push({ moduleCode: 'M2', fieldOrRecord: 'Homewood Lodge ALF facility row', reason: 'Homewood row not found in Facilities Information.docx', round: 'round_1', sourceId: 'src-facility-master' });
} else {
  for (const [field, label] of [
    ['addressLine1', 'physical address'],
    ['phone', 'main phone'],
    ['medicaidNumber', 'Medicaid number'],
    ['npi', 'NPI'],
    ['taxId', 'Tax ID'],
    ['taxonomyCode', 'taxonomy code'],
    ['bedCapacity', 'bed capacity'],
    ['managerName', 'manager'],
    ['administratorName', 'administrator']
  ]) {
    if (!homewood[field]) gaps.push({ moduleCode: 'M2', fieldOrRecord: label, reason: 'Missing from Facilities Information.docx Homewood row', round: 'round_1', sourceId: 'src-facility-master' });
  }
}

const facilityRecords = facilities.flatMap((facility) => [
  {
    targetEntity: 'legal_entities',
    sourceRowRef: `facility-master:${facility.id}:entity`,
    validationStatus: 'ready',
    moduleCodes: ['M1'],
    data: {
      id: `ent-${slug(facility.legalName)}`,
      legalName: facility.legalName,
      associatedFacilityId: facility.id,
      taxId: facility.taxId
    },
    issues: []
  },
  {
    targetEntity: 'facility_profile',
    sourceRowRef: `facility-master:${facility.id}:facility`,
    validationStatus: facility.id === 'fac-homewood' ? 'needs_review' : 'ready',
    moduleCodes: ['M2'],
    data: facility,
    issues: facility.id === 'fac-homewood'
      ? ['Review administrator/manager names against current Homewood operator contacts before creating user links.']
      : []
  }
]);

const foundationArtifact = createNormalizedArtifact({
  sourceId: 'src-facility-master',
  parserName: 'parse-foundation',
  sourceRefs: [{ label: 'Facilities Information.docx', location: sourcePath }],
  records: facilityRecords,
  gaps,
  extraSummary: {
    parsedFacilityCount: facilities.length,
    homewoodFound: Boolean(homewood),
    homewoodBedCapacity: homewood?.bedCapacity || null
  }
});
const foundationPath = writeNormalizedArtifact(foundationArtifact);

const roomRecords = buildRoomRecords();
const totalBeds = roomRecords.reduce((sum, record) => sum + record.data.bedCount, 0);
const roomGaps = [];
if (roomRecords.length !== 20) roomGaps.push({ moduleCode: 'M3', fieldOrRecord: 'room count', reason: `Expected 20 rooms, generated ${roomRecords.length}`, round: 'round_1', sourceId: 'src-room-model' });
if (totalBeds !== 36) roomGaps.push({ moduleCode: 'M3', fieldOrRecord: 'bed count', reason: `Expected 36 beds, generated ${totalBeds}`, round: 'round_1', sourceId: 'src-room-model' });
if (homewood?.bedCapacity && totalBeds !== homewood.bedCapacity) roomGaps.push({ moduleCode: 'M3', fieldOrRecord: 'facility master bed capacity match', reason: `Facility master has ${homewood.bedCapacity} beds; room model generated ${totalBeds}`, round: 'round_1', sourceId: 'src-room-model' });

const roomArtifact = createNormalizedArtifact({
  sourceId: 'src-room-model',
  parserName: 'parse-foundation',
  sourceRefs: [
    { label: 'Facilities Information.docx bed capacity', location: sourcePath },
    { label: 'Homewood room model rule', location: 'Rooms 1-4 private single; rooms 5-20 companion double' }
  ],
  records: roomRecords,
  gaps: roomGaps,
  extraSummary: {
    roomCount: roomRecords.length,
    bedCount: totalBeds,
    privateRoomCount: roomRecords.filter((record) => record.data.unitType === 'Private single').length,
    companionRoomCount: roomRecords.filter((record) => record.data.unitType === 'Companion double').length
  }
});
const roomPath = writeNormalizedArtifact(roomArtifact);

console.log(`Wrote ${foundationPath}`);
console.log(`Wrote ${roomPath}`);
console.log(`Facility master artifacts: ${foundationArtifact.summary.recordCount} records, ${foundationArtifact.summary.gapCount} gap(s), ${foundationArtifact.summary.needsReviewCount} needs-review record(s).`);
console.log(`Room model artifact: ${roomArtifact.summary.roomCount} rooms, ${roomArtifact.summary.bedCount} beds, ${roomArtifact.summary.gapCount} gap(s).`);
console.log(`Next import target paths: ${normalizedArtifactPath('src-facility-master')} and ${normalizedArtifactPath('src-room-model')}`);
