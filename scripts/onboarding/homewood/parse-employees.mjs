import { existsSync } from 'node:fs';
import {
  createNormalizedArtifact,
  extractXlsxSheets,
  writeNormalizedArtifact
} from './ingestion-lib.mjs';

const DEFAULT_EMPLOYEE_PATHS = [
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/Haven - Brian/Employees Information.xlsx',
  '/Users/brianlewis/Circle of Life/Haven - Brian/Employees Information.xlsx',
  '/Users/brianlewis/Documents/CIRCLE OF LIFE/Employees Information.xlsx',
  '/Users/brianlewis/Downloads/Employees Information.xlsx'
];
const sourcePath = process.env.HOMEWOOD_EMPLOYEES_PATH || DEFAULT_EMPLOYEE_PATHS.find((path) => existsSync(path)) || DEFAULT_EMPLOYEE_PATHS[0];

const ROLE_MAP = new Map([
  ['administrator', 'admin'],
  ['administrative assistant', 'admin'],
  ['assistant', 'admin'],
  ['universal', 'caregiver'],
  ['resident aide', 'caregiver'],
  ['caregiver', 'caregiver'],
  ['medication technician', 'med_tech'],
  ['med tech', 'med_tech'],
  ['dietary', 'dietary'],
  ['cook', 'dietary'],
  ['housekeeping aide', 'housekeeper'],
  ['housekeeper', 'housekeeper']
]);

function key(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function normalizeBool(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'view', 'edit'].includes(normalized)) return true;
  if (['no', 'n', 'false', '0'].includes(normalized)) return false;
  return null;
}

function normalizeFacility(value, sheetName) {
  const raw = String(value || sheetName || '').trim();
  if (/homewood|hw/i.test(raw)) return 'Homewood Lodge ALF';
  if (/grande/i.test(raw)) return 'Grande Cypress ALF';
  if (/oakridge|or/i.test(raw)) return 'Oakridge ALF';
  if (/plantation|pt/i.test(raw)) return 'The Plantation on Summers';
  if (/rising|ro/i.test(raw)) return 'Rising Oaks ALF';
  return raw || 'Unknown facility';
}

function findHeader(rows) {
  for (let index = 0; index < rows.length; index += 1) {
    const normalized = rows[index].map(key);
    const hasName = normalized.some((header) => ['name', 'employee_name', 'full_name'].includes(header));
    const hasEmail = normalized.some((header) => header.includes('email'));
    const hasRole = normalized.some((header) => ['job_title', 'title', 'role', 'position'].includes(header));
    if (hasName && (hasEmail || hasRole)) return { index, headers: normalized };
  }
  return null;
}

function valueFor(row, headers, candidates) {
  for (const candidate of candidates) {
    const exact = headers.indexOf(candidate);
    if (exact >= 0) return row[exact] || '';
    const partial = headers.findIndex((header) => header.includes(candidate));
    if (partial >= 0) return row[partial] || '';
  }
  return '';
}

function summarizeRows(sheets) {
  const groups = new Map();
  const gaps = [];
  const unknownRoles = new Map();
  let rawStaffRows = 0;
  let homewoodStaffRows = 0;
  let missingEmailRows = 0;
  let missingPhiFlagRows = 0;

  for (const sheet of sheets) {
    const header = findHeader(sheet.rows);
    if (!header) continue;
    for (const row of sheet.rows.slice(header.index + 1)) {
      const namePresent = Boolean(valueFor(row, header.headers, ['name', 'employee_name', 'full_name']).trim());
      const email = valueFor(row, header.headers, ['email', 'email_address']);
      const roleRaw = valueFor(row, header.headers, ['job_title', 'title', 'role', 'position']);
      const facility = normalizeFacility(valueFor(row, header.headers, ['facility', 'location', 'building']), sheet.name);
      const phiView = normalizeBool(valueFor(row, header.headers, ['phi_view', 'view_phi', 'view']));
      const phiEdit = normalizeBool(valueFor(row, header.headers, ['phi_edit', 'edit_phi', 'edit']));
      if (!namePresent && !email && !roleRaw) continue;
      rawStaffRows += 1;
      if (/homewood/i.test(facility)) homewoodStaffRows += 1;
      if (!email) missingEmailRows += 1;
      if (phiView === null || phiEdit === null) missingPhiFlagRows += 1;
      const roleKey = String(roleRaw || '').trim().toLowerCase();
      const havenRole = ROLE_MAP.get(roleKey) || 'needs_mapping';
      if (havenRole === 'needs_mapping') unknownRoles.set(roleRaw || 'blank', (unknownRoles.get(roleRaw || 'blank') || 0) + 1);
      const groupKey = [facility, roleRaw || 'blank', havenRole, phiView, phiEdit].join('|');
      const existing = groups.get(groupKey) || { facility, sourceRole: roleRaw || 'blank', havenRole, phiView, phiEdit, staffCount: 0, missingEmailCount: 0, missingPhiFlagCount: 0 };
      existing.staffCount += 1;
      if (!email) existing.missingEmailCount += 1;
      if (phiView === null || phiEdit === null) existing.missingPhiFlagCount += 1;
      groups.set(groupKey, existing);
    }
  }

  if (rawStaffRows === 0) {
    gaps.push({ moduleCode: 'M4', fieldOrRecord: 'employee rows', reason: 'Workbook parsed but no staff rows were detected from recognizable Name/Email/Job Title headers.', round: 'round_1', sourceId: 'src-employees' });
  }
  if (missingEmailRows > 0) {
    gaps.push({ moduleCode: 'M4', fieldOrRecord: 'employee email', reason: `${missingEmailRows} staff row(s) missing email; app user creation requires email.`, round: 'round_1', sourceId: 'src-employees' });
  }
  if (missingPhiFlagRows > 0) {
    gaps.push({ moduleCode: 'M4', fieldOrRecord: 'PHI View/Edit flags', reason: `${missingPhiFlagRows} staff row(s) missing PHI view or edit flag.`, round: 'round_1', sourceId: 'src-employees' });
  }
  for (const [role, count] of unknownRoles) {
    gaps.push({ moduleCode: 'M4', fieldOrRecord: `role mapping: ${role}`, reason: `${count} staff row(s) have a role not mapped to a Haven role.`, round: 'round_1', sourceId: 'src-employees' });
  }

  const records = [...groups.values()].sort((a, b) => `${a.facility}:${a.sourceRole}`.localeCompare(`${b.facility}:${b.sourceRole}`)).map((group, index) => ({
    targetEntity: 'staff_permission_summary',
    sourceRowRef: `employees-summary:${index + 1}`,
    validationStatus: group.missingEmailCount || group.missingPhiFlagCount || group.havenRole === 'needs_mapping' ? 'needs_review' : 'ready',
    moduleCodes: ['M4'],
    data: group,
    issues: [
      group.missingEmailCount ? `${group.missingEmailCount} missing email` : '',
      group.missingPhiFlagCount ? `${group.missingPhiFlagCount} missing PHI flag` : '',
      group.havenRole === 'needs_mapping' ? 'role needs mapping' : ''
    ].filter(Boolean)
  }));

  return { records, gaps, rawStaffRows, homewoodStaffRows, missingEmailRows, missingPhiFlagRows, unknownRoleCount: unknownRoles.size };
}

if (!existsSync(sourcePath)) {
  const artifact = createNormalizedArtifact({
    sourceId: 'src-employees',
    parserName: 'parse-employees',
    sourceRefs: [{ label: 'Employees Information.xlsx', location: sourcePath }],
    gaps: [{
      moduleCode: 'M4',
      fieldOrRecord: 'Employees Information.xlsx',
      reason: 'Employee workbook is not present locally yet. Set HOMEWOOD_EMPLOYEES_PATH when the CFO spreadsheet is available.',
      round: 'round_1',
      sourceId: 'src-employees'
    }],
    extraSummary: {
      sourceFound: false,
      rawStaffRows: 0,
      homewoodStaffRows: 0,
      phiSafeOutput: true
    }
  });
  const outPath = writeNormalizedArtifact(artifact);
  console.log(`Wrote ${outPath}`);
  console.log('Employee workbook not found locally; emitted non-blocking Round 1 gap artifact.');
  process.exit(0);
}

const sheets = extractXlsxSheets(sourcePath);
const summary = summarizeRows(sheets);
const artifact = createNormalizedArtifact({
  sourceId: 'src-employees',
  parserName: 'parse-employees',
  sourceRefs: [{ label: 'Employees Information.xlsx', location: sourcePath }],
  records: summary.records,
  gaps: summary.gaps,
  extraSummary: {
    sourceFound: true,
    sheetCount: sheets.length,
    rawStaffRows: summary.rawStaffRows,
    homewoodStaffRows: summary.homewoodStaffRows,
    missingEmailRows: summary.missingEmailRows,
    missingPhiFlagRows: summary.missingPhiFlagRows,
    unknownRoleCount: summary.unknownRoleCount,
    phiSafeOutput: true
  }
});
const outPath = writeNormalizedArtifact(artifact);
console.log(`Wrote ${outPath}`);
console.log(`Employee parser summary: ${summary.rawStaffRows} staff row(s), ${summary.homewoodStaffRows} Homewood row(s), ${summary.gaps.length} gap(s).`);
