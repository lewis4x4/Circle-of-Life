import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import {
  createNormalizedArtifact,
  extractXlsxSheets,
  writeNormalizedArtifact
} from './ingestion-lib.mjs';

const DEFAULT_AR_PATHS = [
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/2026 A-R/HW.OR.RO',
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/2025 A-R/HW.OR.RO',
  '/Users/brianlewis/Documents/CIRCLE OF LIFE/Accounts Receivables/Homewood'
];
const DEFAULT_MEDICAID_PATHS = [
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/Daily Logs/Medicaid Log.xlsx',
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/Daily Logs/Medicaid.xlsx',
  '/Users/brianlewis/Documents/CIRCLE OF LIFE/Medicaid Log.xlsx'
];

const arSourceRoot = process.env.HOMEWOOD_AR_PATH || DEFAULT_AR_PATHS.find((path) => existsSync(path)) || DEFAULT_AR_PATHS[0];
const medicaidSourcePath = process.env.HOMEWOOD_MEDICAID_LOG_PATH || DEFAULT_MEDICAID_PATHS.find((path) => existsSync(path)) || DEFAULT_MEDICAID_PATHS[0];

function key(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function toNumber(value) {
  const cleaned = String(value ?? '').replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!cleaned || cleaned === '-') return 0;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function walkXlsx(root) {
  if (!existsSync(root)) return [];
  const stat = statSync(root);
  if (stat.isFile()) return extname(root).toLowerCase() === '.xlsx' ? [root] : [];
  const out = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const childStat = statSync(path);
    if (childStat.isDirectory()) out.push(...walkXlsx(path));
    else if (extname(path).toLowerCase() === '.xlsx' && !basename(path).startsWith('~$')) out.push(path);
  }
  return out.sort();
}

function findHeader(rows) {
  for (let index = 0; index < rows.length; index += 1) {
    const headers = rows[index].map(key);
    const hasRoom = headers.some((header) => header.includes('room'));
    const hasResident = headers.some((header) => header.includes('resident'));
    const hasOutstanding = headers.some((header) => header.includes('outstanding'));
    if (hasRoom && hasResident && hasOutstanding) return { index, headers };
  }
  return null;
}

function findIndex(headers, candidates) {
  for (const candidate of candidates) {
    const exact = headers.indexOf(candidate);
    if (exact >= 0) return exact;
    const partial = headers.findIndex((header) => header.includes(candidate));
    if (partial >= 0) return partial;
  }
  return -1;
}

function summarizeArWorkbook(path) {
  const sheets = extractXlsxSheets(path);
  const homewoodSheet = sheets.find((sheet) => /homewood|hw/i.test(sheet.name)) || sheets.find((sheet) => /homewood/i.test(sheet.rows[0]?.join(' ') || ''));
  if (!homewoodSheet) return { foundHomewoodSheet: false, file: basename(path) };
  const header = findHeader(homewoodSheet.rows);
  if (!header) return { foundHomewoodSheet: true, headerFound: false, file: basename(path), sheet: homewoodSheet.name };

  const roomIndex = findIndex(header.headers, ['room']);
  const residentIndex = findIndex(header.headers, ['resident']);
  const totalIndex = findIndex(header.headers, ['total_pvt_mcd', 'total']);
  const privateIndex = findIndex(header.headers, ['pvt']);
  const privatePaidIndex = findIndex(header.headers, ['amount_paid_privately', 'paid_privately']);
  const medicaidBilledIndex = findIndex(header.headers, ['medicaid_billed', 'billed']);
  const medicaidPaidIndex = findIndex(header.headers, ['medicaid_amount_pd', 'amount_pd']);
  const outstandingIndex = findIndex(header.headers, ['outstanding']);
  const providerIndex = findIndex(header.headers, ['provider']);

  const providerCounts = {};
  let roomRows = 0;
  let occupiedRows = 0;
  let rowsMissingRoom = 0;
  let outstandingTotal = 0;
  let totalRateAmount = 0;
  let privateAmount = 0;
  let privatePaidAmount = 0;
  let medicaidBilledAmount = 0;
  let medicaidPaidAmount = 0;

  for (const row of homewoodSheet.rows.slice(header.index + 1)) {
    const room = row[roomIndex] || '';
    const residentPresent = Boolean(row[residentIndex]);
    const provider = String(row[providerIndex] || '').trim();
    if (!room && !residentPresent) continue;
    roomRows += 1;
    if (!room && residentPresent) rowsMissingRoom += 1;
    if (residentPresent) occupiedRows += 1;
    if (provider) providerCounts[provider] = (providerCounts[provider] || 0) + 1;
    totalRateAmount += toNumber(row[totalIndex]);
    privateAmount += toNumber(row[privateIndex]);
    privatePaidAmount += toNumber(row[privatePaidIndex]);
    medicaidBilledAmount += toNumber(row[medicaidBilledIndex]);
    medicaidPaidAmount += toNumber(row[medicaidPaidIndex]);
    outstandingTotal += toNumber(row[outstandingIndex]);
  }

  return {
    foundHomewoodSheet: true,
    headerFound: true,
    file: basename(path),
    sheet: homewoodSheet.name,
    roomRows,
    occupiedRows,
    rowsMissingRoom,
    providerCounts,
    totals: {
      totalRateAmount: Math.round(totalRateAmount * 100) / 100,
      privateAmount: Math.round(privateAmount * 100) / 100,
      privatePaidAmount: Math.round(privatePaidAmount * 100) / 100,
      medicaidBilledAmount: Math.round(medicaidBilledAmount * 100) / 100,
      medicaidPaidAmount: Math.round(medicaidPaidAmount * 100) / 100,
      outstandingTotal: Math.round(outstandingTotal * 100) / 100
    }
  };
}

function buildArArtifact() {
  const files = walkXlsx(arSourceRoot);
  const summaries = files.map(summarizeArWorkbook);
  const parsed = summaries.filter((summary) => summary.foundHomewoodSheet && summary.headerFound);
  const gaps = [];
  if (files.length === 0) {
    gaps.push({ moduleCode: 'M6', fieldOrRecord: 'Homewood A/R workbook', reason: `No local A/R workbook found at ${arSourceRoot}`, round: 'round_1', sourceId: 'src-ar' });
  }
  if (files.length > 0 && parsed.length === 0) {
    gaps.push({ moduleCode: 'M6', fieldOrRecord: 'Homewood A/R sheet', reason: 'A/R workbooks were found, but no parseable Homewood sheet/header was detected.', round: 'round_1', sourceId: 'src-ar' });
  }
  if (!/2026/.test(arSourceRoot)) {
    gaps.push({ moduleCode: 'M6', fieldOrRecord: 'current Homewood A/R', reason: 'Local parse used non-2026 A/R source; current Homewood 2026 A/R is not present locally yet.', round: 'round_1', sourceId: 'src-ar' });
  }
  const records = summaries.map((summary, index) => ({
    targetEntity: 'resident_rate_ar_summary',
    sourceRowRef: `ar-summary:${index + 1}`,
    validationStatus: summary.foundHomewoodSheet && summary.headerFound ? 'ready' : 'needs_review',
    moduleCodes: ['M6'],
    data: summary,
    issues: [
      summary.foundHomewoodSheet ? '' : 'Homewood sheet not found',
      summary.headerFound === false ? 'A/R header not found' : ''
    ].filter(Boolean)
  }));
  return createNormalizedArtifact({
    sourceId: 'src-ar',
    parserName: 'parse-billing',
    sourceRefs: [{ label: 'Homewood A/R source root', location: arSourceRoot }],
    records,
    gaps,
    extraSummary: {
      sourceFound: files.length > 0,
      workbookCount: files.length,
      parsedWorkbookCount: parsed.length,
      phiSafeOutput: true
    }
  });
}

function buildMedicaidArtifact() {
  if (!existsSync(medicaidSourcePath)) {
    return createNormalizedArtifact({
      sourceId: 'src-medicaid-log',
      parserName: 'parse-billing',
      sourceRefs: [{ label: 'Medicaid Log.xlsx', location: medicaidSourcePath }],
      gaps: [{ moduleCode: 'M6', fieldOrRecord: 'Medicaid Log.xlsx', reason: 'Medicaid Log workbook is not present locally yet. Set HOMEWOOD_MEDICAID_LOG_PATH when available.', round: 'round_1', sourceId: 'src-medicaid-log' }],
      extraSummary: { sourceFound: false, workbookCount: 0, phiSafeOutput: true }
    });
  }
  const sheets = extractXlsxSheets(medicaidSourcePath);
  const sheetSummaries = sheets.map((sheet) => ({ sheet: sheet.name, rowCount: Math.max(0, sheet.rows.length - 1), columnCount: Math.max(0, ...sheet.rows.map((row) => row.length)) }));
  return createNormalizedArtifact({
    sourceId: 'src-medicaid-log',
    parserName: 'parse-billing',
    sourceRefs: [{ label: 'Medicaid Log.xlsx', location: medicaidSourcePath }],
    records: sheetSummaries.map((summary, index) => ({ targetEntity: 'medicaid_log_summary', sourceRowRef: `medicaid-summary:${index + 1}`, validationStatus: 'needs_review', moduleCodes: ['M6'], data: summary, issues: ['Workbook structure parsed; resident-level import mapping still needs field-specific review.'] })),
    gaps: [],
    extraSummary: { sourceFound: true, sheetCount: sheets.length, phiSafeOutput: true }
  });
}

const arPath = writeNormalizedArtifact(buildArArtifact());
const medicaidPath = writeNormalizedArtifact(buildMedicaidArtifact());
console.log(`Wrote ${arPath}`);
console.log(`Wrote ${medicaidPath}`);
