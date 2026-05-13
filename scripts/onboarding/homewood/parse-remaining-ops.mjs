import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { createNormalizedArtifact, extractXlsxSheets, writeNormalizedArtifact } from './ingestion-lib.mjs';

const FOOD_SERVICE_FILES = [
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/HR - Forms/Food Service/Breakfast Meal Log.xlsx',
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/HR - Forms/Food Service/Dinner Meal Log.xlsx',
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/HR - Forms/Food Service/Supper Meal Log.xlsx',
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/HR - Forms/Food Service/Kitchen Temp Log.pdf',
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/HR - Forms/Food Service/Food Service Daily.pdf',
  '/Users/brianlewis/Circle of Life/Circle of Life Wiki/HR - Forms/Food Service/Menu Substitution Log.pdf'
];
const QUICKMAR_INSTRUCTIONS = '/Users/brianlewis/Circle of Life/Circle of Life Wiki/HR - Forms/Forms/QuickMar Instructions.pdf';
const QUICKMAR_EXPORT_FOLDER = process.env.HOMEWOOD_QUICKMAR_EXPORT_PATH || '/Users/brianlewis/Circle of Life/Circle of Life Wiki/Haven - Brian/QuickMar Daily Export';
const STANDUP_LOG = process.env.HOMEWOOD_STANDUP_LOG_PATH || '/Users/brianlewis/Circle of Life/Circle of Life Wiki/2026 Standup Call Log.xlsx';
const ACTIVITY_SOURCE = process.env.HOMEWOOD_ACTIVITY_SOURCE_PATH || '/Users/brianlewis/Circle of Life/Circle of Life Wiki/Haven - Brian/Homewood Activity Calendar';
const SCHEDULE_SOURCE = process.env.HOMEWOOD_SCHEDULE_SOURCE_PATH || '/Users/brianlewis/Circle of Life/Circle of Life Wiki/Haven - Brian/Homewood Staff Schedule.xlsx';

function pdfTextLength(path) {
  try {
    return execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\s/g, '').length;
  } catch {
    return 0;
  }
}

function xlsxSummary(path) {
  const sheets = extractXlsxSheets(path);
  return { file: basename(path), sheetCount: sheets.length, rowCount: sheets.reduce((sum, sheet) => sum + Math.max(0, sheet.rows.length - 1), 0), sizeBytes: statSync(path).size };
}

function writeDietary() {
  const records = [];
  const gaps = [];
  for (const path of FOOD_SERVICE_FILES) {
    if (!existsSync(path)) {
      gaps.push({ moduleCode: 'M11', fieldOrRecord: basename(path), reason: `Food service source missing at ${path}`, round: 'round_1', sourceId: 'src-dietary' });
      continue;
    }
    const isXlsx = path.toLowerCase().endsWith('.xlsx');
    const data = isXlsx ? { sourceType: 'xlsx_log', ...xlsxSummary(path) } : { sourceType: 'pdf_template', file: basename(path), sizeBytes: statSync(path).size, textExtractable: pdfTextLength(path) > 25 };
    records.push({ targetEntity: 'dietary_source_summary', sourceRowRef: `dietary:${basename(path).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, validationStatus: 'ready', moduleCodes: ['M11'], data, issues: [] });
  }
  const artifact = createNormalizedArtifact({ sourceId: 'src-dietary', parserName: 'parse-remaining-ops', sourceRefs: FOOD_SERVICE_FILES.map((path) => ({ label: basename(path), location: path })), records, gaps, extraSummary: { presentSourceCount: records.length, phiSafeOutput: true } });
  return writeNormalizedArtifact(artifact);
}

function writeQuickmar() {
  const records = [];
  const gaps = [];
  if (existsSync(QUICKMAR_INSTRUCTIONS)) {
    records.push({ targetEntity: 'quickmar_reference_summary', sourceRowRef: 'quickmar:instructions', validationStatus: 'ready', moduleCodes: ['M10'], data: { file: basename(QUICKMAR_INSTRUCTIONS), sizeBytes: statSync(QUICKMAR_INSTRUCTIONS).size, textExtractable: pdfTextLength(QUICKMAR_INSTRUCTIONS) > 25 }, issues: [] });
  } else {
    gaps.push({ moduleCode: 'M10', fieldOrRecord: 'QuickMar Instructions.pdf', reason: 'QuickMar instruction reference is not present locally.', round: 'round_1', sourceId: 'src-quickmar-daily' });
  }
  if (!existsSync(QUICKMAR_EXPORT_FOLDER)) {
    gaps.push({ moduleCode: 'M10', fieldOrRecord: 'daily QuickMar export folder/header sample', reason: 'Daily QuickMar export folder/header sample is not present locally yet. n8n workflow can be finalized once one export sample exists.', round: 'round_1', sourceId: 'src-quickmar-daily' });
  }
  const artifact = createNormalizedArtifact({ sourceId: 'src-quickmar-daily', parserName: 'parse-remaining-ops', sourceRefs: [{ label: 'QuickMar Instructions.pdf', location: QUICKMAR_INSTRUCTIONS }, { label: 'Daily QuickMar export folder', location: QUICKMAR_EXPORT_FOLDER }], records, gaps, extraSummary: { instructionsFound: existsSync(QUICKMAR_INSTRUCTIONS), exportFolderFound: existsSync(QUICKMAR_EXPORT_FOLDER), phiSafeOutput: true } });
  return writeNormalizedArtifact(artifact);
}

function writeKpis() {
  const records = [];
  const gaps = [];
  if (existsSync(STANDUP_LOG)) {
    records.push({ targetEntity: 'launch_kpi_standup_source_summary', sourceRowRef: 'kpis-standup:standup-log', validationStatus: 'needs_review', moduleCodes: ['M19'], data: xlsxSummary(STANDUP_LOG), issues: ['Workbook exists; Homewood-specific KPI definitions and owner/action mapping still need field review.'] });
  } else {
    gaps.push({ moduleCode: 'M19', fieldOrRecord: '2026 Standup Call Log.xlsx', reason: 'Standup/KPI workbook is not present locally.', round: 'round_1', sourceId: 'src-kpis-standup' });
  }
  const artifact = createNormalizedArtifact({ sourceId: 'src-kpis-standup', parserName: 'parse-remaining-ops', sourceRefs: [{ label: '2026 Standup Call Log.xlsx', location: STANDUP_LOG }], records, gaps, extraSummary: { standupLogFound: existsSync(STANDUP_LOG), phiSafeOutput: true } });
  return writeNormalizedArtifact(artifact);
}

function writeMissingSimple(sourceId, moduleCode, label, path, reason) {
  const records = [];
  const gaps = [];
  if (!existsSync(path)) gaps.push({ moduleCode, fieldOrRecord: label, reason, round: 'round_2', sourceId });
  else records.push({ targetEntity: `${sourceId.replace(/^src-/, '').replace(/-/g, '_')}_source_summary`, sourceRowRef: `${sourceId}:source`, validationStatus: 'needs_review', moduleCodes: [moduleCode], data: { path, sourceFound: true }, issues: ['Source exists; parser needs source-specific field mapping.'] });
  const artifact = createNormalizedArtifact({ sourceId, parserName: 'parse-remaining-ops', sourceRefs: [{ label, location: path }], records, gaps, extraSummary: { sourceFound: existsSync(path), phiSafeOutput: true } });
  return writeNormalizedArtifact(artifact);
}

const paths = [
  writeDietary(),
  writeQuickmar(),
  writeKpis(),
  writeMissingSimple('src-activities', 'M12', 'Homewood activity calendar/source artifacts', ACTIVITY_SOURCE, 'Homewood activity calendar/source artifacts are not present locally yet.'),
  writeMissingSimple('src-schedules', 'M9', 'Homewood staff schedule / shift templates', SCHEDULE_SOURCE, 'Homewood staff schedule / shift template source is not present locally yet.')
];
for (const path of paths) console.log(`Wrote ${path}`);
