#!/usr/bin/env node
/**
 * Import Homewood current A/R workbook into Facility Launch intake values.
 *
 * Source: local XLSX, default /Users/brianlewis/Desktop/AR May 2026.xlsx
 * Target: public.facility_launch_module_values, modules M5 + M6
 *
 * This intentionally writes to the onboarding/intake layer, not directly to
 * residents/resident_payers, because the A/R workbook does not include DOB,
 * gender, responsible-party, physician/pharmacy, allergies, or consent fields.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { extractXlsxSheets } from './onboarding/homewood/ingestion-lib.mjs';

const DEFAULT_FILE = '/Users/brianlewis/Desktop/AR May 2026.xlsx';
const DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_HOMEWOOD_FACILITY_ID = '00000000-0000-0000-0002-000000000003';
const DEFAULT_APPLIED_BY = null;

function parseArgs(argv) {
  const args = {
    file: DEFAULT_FILE,
    organizationId: DEFAULT_ORGANIZATION_ID,
    facilityId: DEFAULT_HOMEWOOD_FACILITY_ID,
    appliedBy: DEFAULT_APPLIED_BY,
    dryRun: false,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--file') args.file = path.resolve(process.cwd(), argv[++i]);
    else if (a === '--organization-id') args.organizationId = argv[++i];
    else if (a === '--facility-id') args.facilityId = argv[++i];
    else if (a === '--applied-by') args.appliedBy = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (a === '--help' || a === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}\n${usage()}`);
    }
  }
  return args;
}

function usage() {
  return [
    'import-homewood-ar.mjs',
    '',
    'Options:',
    `  --file <path>              Current A/R XLSX (default: ${DEFAULT_FILE})`,
    '  --dry-run                  Parse and plan writes only',
    '  --facility-id <uuid>       Target facility UUID (default: Homewood)',
    '  --organization-id <uuid>   Target organization UUID (default: COL)',
    '  --applied-by <uuid>        auth.users id to record as applied_by',
    '  --verbose                  Print row-level import plan',
  ].join('\n');
}

function loadEnvFile() {
  for (const name of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), name);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, raw] = match;
      if (process.env[key]) continue;
      process.env[key] = raw.replace(/^['"]|['"]$/g, '');
    }
  }
}

function key(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function toNumber(value) {
  const cleaned = String(value ?? '').replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!cleaned || cleaned === '-') return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function toCents(value) {
  const n = toNumber(value);
  return n == null ? null : Math.round(n * 100);
}

function excelDateToIso(value) {
  const n = toNumber(value);
  if (n == null) return null;
  // Excel serial dates use 1899-12-30 as the JS-compatible epoch.
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function normalizeRoomBed(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { raw: '', roomNumber: null, bedLabel: null, normalized: null };
  const cleaned = raw.replace(/\.0$/, '').toUpperCase().replace(/\s+/g, '');
  const match = cleaned.match(/^(\d+)([A-Z])?$/);
  if (!match) return { raw, roomNumber: cleaned, bedLabel: null, normalized: cleaned };
  const roomNumber = String(Number.parseInt(match[1], 10));
  const bedLabel = match[2] || 'A';
  return { raw, roomNumber, bedLabel, normalized: `${roomNumber}${bedLabel}` };
}

function parseName(value) {
  const raw = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!raw) return null;
  if (raw.includes(',')) {
    const [last, rest] = raw.split(',', 2).map((part) => part.trim());
    const [first, ...middleParts] = rest.split(/\s+/).filter(Boolean);
    return {
      fullLegalName: [first, ...middleParts, last].filter(Boolean).join(' '),
      firstName: first || '',
      middleName: middleParts.join(' ') || null,
      lastName: last || '',
      sourceName: raw,
    };
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  const first = parts.shift() || '';
  const last = parts.pop() || '';
  return {
    fullLegalName: [first, ...parts, last].filter(Boolean).join(' '),
    firstName: first,
    middleName: parts.join(' ') || null,
    lastName: last || first,
    sourceName: raw,
  };
}

function payerFrom(provider, medicaidBilledCents, privateAmountCents) {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized.includes('pending')) return 'medicaid_pending';
  if (normalized || (medicaidBilledCents ?? 0) > 0) return 'medicaid_oss';
  if ((privateAmountCents ?? 0) > 0) return 'private_pay';
  return 'other';
}

function findHeader(sheet) {
  for (let index = 0; index < sheet.rows.length; index += 1) {
    const headers = sheet.rows[index].map(key);
    if (headers.some((h) => h.includes('room')) && headers.some((h) => h.includes('resident'))) {
      return { index, headers };
    }
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

function parseWorkbook(file) {
  if (!existsSync(file)) throw new Error(`A/R workbook not found: ${file}`);
  const sheets = extractXlsxSheets(file);
  const sheet = sheets.find((s) => /homewood/i.test(s.name)) || sheets.find((s) => /homewood/i.test(s.rows[0]?.join(' ') || ''));
  if (!sheet) throw new Error('No Homewood sheet found in A/R workbook.');
  const header = findHeader(sheet);
  if (!header) throw new Error(`No resident A/R header row found on sheet ${sheet.name}.`);

  const idx = {
    room: findIndex(header.headers, ['room']),
    admitDate: findIndex(header.headers, ['admit_date']),
    resident: findIndex(header.headers, ['residents_name', 'resident_name', 'resident']),
    total: findIndex(header.headers, ['total_pvt_mcd', 'total']),
    privateAmount: findIndex(header.headers, ['pvt']),
    privatePaid: findIndex(header.headers, ['amount_paid_privately', 'paid_privately']),
    medicaidBilled: findIndex(header.headers, ['medicaid_billed', 'billed']),
    medicaidPaid: findIndex(header.headers, ['medicaid_amount_pd', 'amount_pd']),
    outstanding: findIndex(header.headers, ['outstanding']),
    provider: findIndex(header.headers, ['provider']),
    notes: findIndex(header.headers, ['collection_notes', 'notes']),
    admittedFrom: findIndex(header.headers, ['admitted_from']),
  };

  const residents = [];
  for (let rowIndex = header.index + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
    const row = sheet.rows[rowIndex];
    const name = parseName(row[idx.resident]);
    const roomBed = normalizeRoomBed(row[idx.room]);
    if (!name && !roomBed.normalized) continue;
    if (!name || !roomBed.normalized) continue;
    if (/total|columns/i.test(name.sourceName)) continue;

    const totalContractedCents = toCents(row[idx.total]);
    const privateAmountCents = toCents(row[idx.privateAmount]);
    const privatePaidCents = toCents(row[idx.privatePaid]);
    const medicaidBilledCents = toCents(row[idx.medicaidBilled]);
    const medicaidPaidCents = toCents(row[idx.medicaidPaid]);
    const outstandingCents = toCents(row[idx.outstanding]) ?? 0;
    const provider = String(row[idx.provider] || '').trim() || null;
    const payerType = payerFrom(provider, medicaidBilledCents, privateAmountCents);

    residents.push({
      sourceRow: rowIndex + 1,
      ...name,
      admissionDate: excelDateToIso(row[idx.admitDate]),
      status: 'active',
      roomBed: roomBed.normalized,
      roomNumber: roomBed.roomNumber,
      bedLabel: roomBed.bedLabel,
      payerType,
      medicaidProvider: provider,
      totalContractedAmountCents: totalContractedCents,
      privateAmountCents,
      privatePaidCents,
      medicaidBilledCents,
      medicaidPaidCents,
      outstandingAmountCents: outstandingCents,
      collectionNotes: String(row[idx.notes] || '').trim() || null,
      admittedFrom: String(row[idx.admittedFrom] || '').trim() || null,
      missingForLiveResident: ['dateOfBirth', 'gender', 'responsibleParty', 'emergencyContact', 'physician/pharmacy', 'consentStatus'],
    });
  }

  const byRoomBed = new Map();
  for (const resident of residents) {
    const key = resident.roomBed;
    byRoomBed.set(key, [...(byRoomBed.get(key) || []), resident.sourceName]);
  }
  const roomBedConflicts = Array.from(byRoomBed.entries())
    .filter(([, names]) => names.length > 1)
    .map(([roomBed, names]) => ({ roomBed, names }));
  const conflictSet = new Set(roomBedConflicts.map((c) => c.roomBed));
  for (const resident of residents) {
    resident.bedAssignmentStatus = conflictSet.has(resident.roomBed) ? 'conflict_needs_review' : 'ready';
  }

  const summary = residents.reduce((acc, row) => {
    acc.residentCount += 1;
    acc.totalContractedCents += row.totalContractedAmountCents ?? 0;
    acc.privateAmountCents += row.privateAmountCents ?? 0;
    acc.privatePaidCents += row.privatePaidCents ?? 0;
    acc.medicaidBilledCents += row.medicaidBilledCents ?? 0;
    acc.medicaidPaidCents += row.medicaidPaidCents ?? 0;
    acc.outstandingCents += row.outstandingAmountCents ?? 0;
    acc.payerCounts[row.payerType] = (acc.payerCounts[row.payerType] || 0) + 1;
    if (row.medicaidProvider) acc.providerCounts[row.medicaidProvider] = (acc.providerCounts[row.medicaidProvider] || 0) + 1;
    return acc;
  }, {
    sourceSheet: sheet.name,
    sourceFile: file,
    arMonth: '2026-05',
    residentCount: 0,
    totalContractedCents: 0,
    privateAmountCents: 0,
    privatePaidCents: 0,
    medicaidBilledCents: 0,
    medicaidPaidCents: 0,
    outstandingCents: 0,
    payerCounts: {},
    providerCounts: {},
    duplicateRoomBedConflicts: roomBedConflicts,
  });

  return { summary, residents };
}

function buildModulePayloads(parsed, args) {
  const exportedAt = new Date().toISOString();
  const residentRoster = parsed.residents.map((resident) => ({
    sourceRow: resident.sourceRow,
    fullLegalName: resident.fullLegalName,
    preferredName: null,
    dob: null,
    admissionDate: resident.admissionDate,
    status: resident.status,
    roomBed: resident.roomBed,
    roomNumber: resident.roomNumber,
    bedLabel: resident.bedLabel,
    payerType: resident.payerType,
    currentRatePlan: {
      arMonth: parsed.summary.arMonth,
      totalContractedAmountCents: resident.totalContractedAmountCents,
      privateAmountCents: resident.privateAmountCents,
      medicaidProvider: resident.medicaidProvider,
      medicaidBilledCents: resident.medicaidBilledCents,
      outstandingAmountCents: resident.outstandingAmountCents,
    },
    careLevel: null,
    responsibleParty: null,
    emergencyContact: null,
    primaryPhysician: null,
    pharmacy: null,
    riskFlags: [],
    consentStatus: null,
    admittedFrom: resident.admittedFrom,
    collectionNotes: resident.collectionNotes,
    bedAssignmentStatus: resident.bedAssignmentStatus,
    missingForLiveResident: resident.missingForLiveResident,
  }));

  const rateRecords = parsed.residents.map((resident) => ({
    sourceRow: resident.sourceRow,
    residentName: resident.fullLegalName,
    residentExternalKey: `${resident.sourceName}|${resident.admissionDate || ''}`,
    roomBed: resident.roomBed,
    roomType: resident.bedLabel === 'A' && !resident.roomBed?.endsWith('B') ? 'unknown_from_ar' : 'companion_or_shared_from_bed_label',
    payerType: resident.payerType,
    billingContact: null,
    contractedPrivateAmountCents: resident.privateAmountCents,
    totalContractedAmountCents: resident.totalContractedAmountCents,
    privatePaidCents: resident.privatePaidCents,
    medicaidProvider: resident.medicaidProvider,
    medicaidProviderAmountCents: resident.medicaidBilledCents,
    medicaidPaidCents: resident.medicaidPaidCents,
    postedRateCap: null,
    effectiveDate: '2026-05-01',
    depositBalance: null,
    concessions: null,
    outstandingAmountCents: resident.outstandingAmountCents,
    collectionStatus: resident.outstandingAmountCents > 0 ? 'balance_due' : 'current',
    collectionNotes: resident.collectionNotes,
  }));

  const common = {
    organization_id: args.organizationId,
    facility_id: args.facilityId,
    source_document_id: null,
    source_fact_id: null,
    applied_by: args.appliedBy,
    applied_at: exportedAt,
  };

  return [
    {
      ...common,
      module_code: 'M5',
      field_path: 'censusDate',
      value: '2026-05-01',
      provenance: { source: args.file, source_sheet: parsed.summary.sourceSheet, round: 2, captured_by: 'import-homewood-ar', exported_at: exportedAt },
    },
    {
      ...common,
      module_code: 'M5',
      field_path: 'residentSource',
      value: 'Homewood Lodge ALF May 2026 A/R workbook',
      provenance: { source: args.file, source_sheet: parsed.summary.sourceSheet, round: 2, captured_by: 'import-homewood-ar', exported_at: exportedAt },
    },
    {
      ...common,
      module_code: 'M5',
      field_path: 'residentValidationOwner',
      value: 'Business Office / CFO review from May 2026 A/R; face sheets still required for demographics and responsible-party contacts.',
      provenance: { source: args.file, source_sheet: parsed.summary.sourceSheet, round: 2, captured_by: 'import-homewood-ar', exported_at: exportedAt },
    },
    {
      ...common,
      module_code: 'M5',
      field_path: 'residents',
      value: residentRoster,
      provenance: { source: args.file, source_sheet: parsed.summary.sourceSheet, round: 2, captured_by: 'import-homewood-ar', exported_at: exportedAt, contains_phi: true },
    },
    {
      ...common,
      module_code: 'M6',
      field_path: 'billingSystemSource',
      value: 'Homewood Lodge ALF May 2026 A/R workbook',
      provenance: { source: args.file, source_sheet: parsed.summary.sourceSheet, round: 2, captured_by: 'import-homewood-ar', exported_at: exportedAt },
    },
    {
      ...common,
      module_code: 'M6',
      field_path: 'rateRecords',
      value: rateRecords,
      provenance: { source: args.file, source_sheet: parsed.summary.sourceSheet, round: 2, captured_by: 'import-homewood-ar', exported_at: exportedAt, contains_phi: true },
    },
    {
      ...common,
      module_code: 'M6',
      field_path: 'currentArSummary',
      value: parsed.summary,
      provenance: { source: args.file, source_sheet: parsed.summary.sourceSheet, round: 2, captured_by: 'import-homewood-ar', exported_at: exportedAt, contains_phi: true },
    },
  ];
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

async function planRows(supabase, payloads) {
  const plan = [];
  for (const payload of payloads) {
    const { data, error } = await supabase
      .from('facility_launch_module_values')
      .select('id, value, provenance')
      .eq('organization_id', payload.organization_id)
      .eq('facility_id', payload.facility_id)
      .eq('module_code', payload.module_code)
      .eq('field_path', payload.field_path)
      .is('deleted_at', null)
      .is('superseded_at', null)
      .maybeSingle();
    if (error) throw new Error(`Lookup failed for ${payload.module_code}.${payload.field_path}: ${error.message}`);
    if (!data) plan.push({ kind: 'insert', payload });
    else if (stableJson(data.value) === stableJson(payload.value)) plan.push({ kind: 'noop', payload, existingId: data.id });
    else plan.push({ kind: 'update', payload, existingId: data.id });
  }
  return plan;
}

async function applyPlan(supabase, plan) {
  for (const item of plan) {
    if (item.kind === 'noop') continue;
    if (item.kind === 'insert') {
      const { error } = await supabase.from('facility_launch_module_values').insert(item.payload);
      if (error) throw new Error(`Insert failed for ${item.payload.module_code}.${item.payload.field_path}: ${error.message}`);
    } else if (item.kind === 'update') {
      const { error } = await supabase.from('facility_launch_module_values').update({
        value: item.payload.value,
        provenance: item.payload.provenance,
        source_document_id: item.payload.source_document_id,
        source_fact_id: item.payload.source_fact_id,
        applied_by: item.payload.applied_by,
        applied_at: item.payload.applied_at,
      }).eq('id', item.existingId);
      if (error) throw new Error(`Update failed for ${item.payload.module_code}.${item.payload.field_path}: ${error.message}`);
    }
  }
}

function printSummary(parsed, plan = null, verbose = false) {
  const s = parsed.summary;
  console.log(`Parsed Homewood A/R: ${s.residentCount} resident rows from ${s.sourceSheet}`);
  console.log(`Totals: contracted $${(s.totalContractedCents / 100).toFixed(2)}, collected $${((s.privatePaidCents + s.medicaidPaidCents) / 100).toFixed(2)}, outstanding $${(s.outstandingCents / 100).toFixed(2)}`);
  console.log(`Payers: ${Object.entries(s.payerCounts).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);
  if (s.duplicateRoomBedConflicts.length > 0) {
    console.log(`Bed conflicts needing review: ${s.duplicateRoomBedConflicts.map((c) => c.roomBed).join(', ')}`);
  }
  if (plan) {
    const counts = plan.reduce((acc, item) => ({ ...acc, [item.kind]: (acc[item.kind] || 0) + 1 }), {});
    console.log(`Import plan: ${counts.insert || 0} insert, ${counts.update || 0} update, ${counts.noop || 0} noop`);
    if (verbose) {
      for (const item of plan) console.log(`${item.kind.toUpperCase()} ${item.payload.module_code}.${item.payload.field_path}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const parsed = parseWorkbook(args.file);
  const payloads = buildModulePayloads(parsed, args);

  if (args.dryRun) {
    printSummary(parsed, payloads.map((payload) => ({ kind: 'insert', payload })), args.verbose);
    console.log('Dry run only: no database credentials required and no writes performed.');
    return;
  }

  loadEnvFile();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required unless --dry-run is used.');
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const plan = await planRows(supabase, payloads);
  printSummary(parsed, plan, args.verbose);
  await applyPlan(supabase, plan);
  console.log('Homewood A/R intake import complete.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
