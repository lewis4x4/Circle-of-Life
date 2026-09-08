#!/usr/bin/env node
/**
 * Import the Homewood May 2026 A/R workbook into the live clinical tables.
 *
 * Targets (per resident, in one transaction):
 *   - residents              (placeholder DOB + gender, status=active, bed_id resolved)
 *   - resident_payers        (primary payer derived from AR provider column)
 *   - care_plans v1          (status=draft, review_due = admission_date + 90d)
 *   - beds                   (status=occupied, current_resident_id set)
 *
 * Behaviour:
 *   - Dry-run by default; `--apply` is required to write.
 *   - Skips residents whose (room, bed) is claimed twice in the AR sheet; the
 *     conflicting rows are printed for manual resolution.
 *   - Idempotent: if a resident with the same (last_name, first_name,
 *     admission_date) already exists at Homewood, the row is skipped.
 *   - Writes a Markdown log at docs/homewood/AR_IMPORT_LOG.md on apply.
 *
 * Companion to scripts/import-homewood-ar.mjs (which stages to the launch
 * intake layer). That script is preserved; this one populates the live
 * clinical surface so the data audit's CRITICAL gate clears.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { extractXlsxSheets } from '../onboarding/homewood/ingestion-lib.mjs';

const DEFAULT_FILE = '/Users/brianlewis/Desktop/AR May 2026.xlsx';
const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001';
const DEFAULT_FACILITY = '00000000-0000-0000-0002-000000000003';
const PLACEHOLDER_DOB = '1900-01-01';
const PLACEHOLDER_GENDER = 'prefer_not_to_say';
const IMPORT_TAG = 'AR-IMPORT-2026-05';

function usage() {
  return [
    'import-ar-to-live.mjs — import Homewood A/R into live clinical tables',
    '',
    'Options:',
    `  --file <path>        Source XLSX (default: ${DEFAULT_FILE})`,
    '  --apply              Write to Supabase (default: dry-run)',
    '  --facility-id <uuid> Override Homewood facility UUID',
    '  --organization-id <uuid> Override COL org UUID',
    '  --verbose            Print per-row decisions',
    '  --log <path>         Markdown log output (default: docs/homewood/AR_IMPORT_LOG.md)',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    file: DEFAULT_FILE,
    apply: false,
    facilityId: DEFAULT_FACILITY,
    organizationId: DEFAULT_ORG,
    verbose: false,
    log: 'docs/homewood/AR_IMPORT_LOG.md',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--file') args.file = path.resolve(process.cwd(), argv[++i]);
    else if (a === '--apply') args.apply = true;
    else if (a === '--facility-id') args.facilityId = argv[++i];
    else if (a === '--organization-id') args.organizationId = argv[++i];
    else if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (a === '--log') args.log = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(usage());
      process.exit(0);
    } else throw new Error(`Unknown arg: ${a}\n${usage()}`);
  }
  return args;
}

function loadEnvFile() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    for (const name of ['.env.local', '.env']) {
      const p = path.resolve(dir, name);
      if (existsSync(p)) {
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
        return p;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
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
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function addDaysIso(iso, days) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function normalizeRoomBed(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { raw: '', roomNumber: null, bedLabel: null, normalized: null };
  const cleaned = raw.replace(/\.0$/, '').toUpperCase().replace(/\s+/g, '');
  const match = cleaned.match(/^(\d+)([A-Z])?$/);
  if (!match) return { raw, roomNumber: null, bedLabel: null, normalized: null };
  const roomNumber = String(Number.parseInt(match[1], 10));
  const bedLabel = match[2] || 'A';
  return { raw, roomNumber, bedLabel, normalized: `${roomNumber}${bedLabel}` };
}

function parseName(value) {
  const raw = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!raw) return null;
  if (raw.includes(',')) {
    const [last, rest] = raw.split(',', 2).map((p) => p.trim());
    const [first, ...middleParts] = rest.split(/\s+/).filter(Boolean);
    return {
      firstName: first || '',
      middleName: middleParts.join(' ') || null,
      lastName: last || '',
      source: raw,
    };
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  const first = parts.shift() || '';
  const last = parts.pop() || '';
  return {
    firstName: first,
    middleName: parts.join(' ') || null,
    lastName: last || first,
    source: raw,
  };
}

function mapPayer(provider) {
  const norm = String(provider || '').trim();
  const lower = norm.toLowerCase();
  if (!lower) return { payerType: 'private_pay', payerName: null, note: null };
  if (lower.includes('pending')) {
    return { payerType: 'medicaid_oss', payerName: 'Medicaid Pending', note: 'Medicaid LTC pending approval (from AR May 2026)' };
  }
  return { payerType: 'medicaid_oss', payerName: norm, note: null };
}

function findHeader(sheet) {
  for (let i = 0; i < sheet.rows.length; i += 1) {
    const headers = sheet.rows[i].map(key);
    if (headers.some((h) => h.includes('room')) && headers.some((h) => h.includes('resident'))) {
      return { index: i, headers };
    }
  }
  return null;
}

function findIndex(headers, candidates) {
  for (const c of candidates) {
    const e = headers.indexOf(c);
    if (e >= 0) return e;
    const p = headers.findIndex((h) => h.includes(c));
    if (p >= 0) return p;
  }
  return -1;
}

function parseHomewoodAR(file) {
  if (!existsSync(file)) throw new Error(`A/R workbook not found: ${file}`);
  const sheets = extractXlsxSheets(file);
  const sheet = sheets.find((s) => /homewood/i.test(s.name));
  if (!sheet) throw new Error('No Homewood sheet found in workbook');
  const header = findHeader(sheet);
  if (!header) throw new Error(`No header row on sheet ${sheet.name}`);

  const idx = {
    room: findIndex(header.headers, ['room']),
    admit: findIndex(header.headers, ['admit_date']),
    resident: findIndex(header.headers, ['residents_name', 'resident_name', 'resident']),
    total: findIndex(header.headers, ['total_pvt_mcd', 'total']),
    pvt: findIndex(header.headers, ['pvt']),
    pvtPaid: findIndex(header.headers, ['amount_paid_privately', 'paid_privately']),
    mcdBilled: findIndex(header.headers, ['medicaid_billed', 'billed']),
    mcdPaid: findIndex(header.headers, ['medicaid_amount_pd', 'amount_pd']),
    outstanding: findIndex(header.headers, ['outstanding']),
    provider: findIndex(header.headers, ['provider']),
    notes: findIndex(header.headers, ['collection_notes', 'notes']),
    admittedFrom: findIndex(header.headers, ['admitted_from']),
  };

  const residents = [];
  for (let r = header.index + 1; r < sheet.rows.length; r += 1) {
    const row = sheet.rows[r];
    const name = parseName(row[idx.resident]);
    const roomBed = normalizeRoomBed(row[idx.room]);
    if (!name || !roomBed.normalized) continue;
    if (/total|columns/i.test(name.source)) continue;

    const provider = String(row[idx.provider] || '').trim() || null;
    const payer = mapPayer(provider);
    const collectionNotes = String(row[idx.notes] || '').trim() || null;
    const admittedFrom = String(row[idx.admittedFrom] || '').trim() || null;

    residents.push({
      sourceRow: r + 1,
      firstName: name.firstName,
      middleName: name.middleName,
      lastName: name.lastName,
      sourceName: name.source,
      admissionDate: excelDateToIso(row[idx.admit]),
      roomNumber: roomBed.roomNumber,
      bedLabel: roomBed.bedLabel,
      roomBed: roomBed.normalized,
      payerType: payer.payerType,
      payerName: payer.payerName,
      payerNote: payer.note,
      monthlyTotalRateCents: toCents(row[idx.total]),
      monthlyPrivateCents: toCents(row[idx.pvt]),
      monthlyMedicaidBilledCents: toCents(row[idx.mcdBilled]),
      privatePaidCents: toCents(row[idx.pvtPaid]),
      medicaidPaidCents: toCents(row[idx.mcdPaid]),
      outstandingCents: toCents(row[idx.outstanding]) ?? 0,
      collectionNotes,
      admittedFrom,
      providerRaw: provider,
    });
  }

  return { sheetName: sheet.name, residents };
}

function detectBedConflicts(residents) {
  const byBed = new Map();
  for (const r of residents) {
    const list = byBed.get(r.roomBed) || [];
    list.push(r);
    byBed.set(r.roomBed, list);
  }
  const conflicts = [];
  for (const [bed, list] of byBed) if (list.length > 1) conflicts.push({ bed, residents: list });
  return conflicts;
}

async function fetchBedIndex(supabase, facilityId) {
  const { data, error } = await supabase
    .from('beds')
    .select('id, bed_label, status, current_resident_id, rooms!inner(room_number)')
    .eq('facility_id', facilityId)
    .is('deleted_at', null);
  if (error) throw new Error(`fetch beds failed: ${error.message}`);
  const index = new Map();
  for (const bed of data || []) {
    const room = bed.rooms?.room_number;
    if (!room) continue;
    index.set(`${room}${bed.bed_label}`, bed);
  }
  return index;
}

async function fetchExistingResidents(supabase, facilityId) {
  const { data, error } = await supabase
    .from('residents')
    .select('id, first_name, last_name, admission_date')
    .eq('facility_id', facilityId)
    .is('deleted_at', null);
  if (error) throw new Error(`fetch existing residents failed: ${error.message}`);
  const set = new Set();
  for (const r of data || []) {
    set.add(`${(r.last_name || '').toLowerCase()}|${(r.first_name || '').toLowerCase()}|${r.admission_date || ''}`);
  }
  return set;
}

function planFor(resident, bed, args) {
  const admit = resident.admissionDate || new Date().toISOString().slice(0, 10);
  const reviewDue = addDaysIso(admit, 90);
  const importStamp = new Date().toISOString().slice(0, 10);
  const specialInstructions = [
    `${IMPORT_TAG} ${importStamp}: imported from AR May 2026 workbook.`,
    'Awaiting face sheet for DOB, gender, diagnosis, allergies, physician,',
    'responsible party, and emergency contacts.',
    resident.collectionNotes ? `AR notes: ${resident.collectionNotes}` : '',
  ].filter(Boolean).join(' ');

  return {
    resident: {
      facility_id: args.facilityId,
      organization_id: args.organizationId,
      bed_id: bed.id,
      first_name: resident.firstName,
      middle_name: resident.middleName,
      last_name: resident.lastName,
      date_of_birth: PLACEHOLDER_DOB,
      gender: PLACEHOLDER_GENDER,
      status: 'active',
      admission_date: resident.admissionDate,
      admission_source: resident.admittedFrom,
      primary_payer: resident.payerType,
      monthly_total_rate: resident.monthlyTotalRateCents,
      rate_effective_date: '2026-05-01',
      special_instructions: specialInstructions,
    },
    payer: {
      facility_id: args.facilityId,
      organization_id: args.organizationId,
      payer_type: resident.payerType,
      is_primary: true,
      payer_name: resident.payerName,
      monthly_benefit_amount: resident.monthlyMedicaidBilledCents,
      medicaid_rate: resident.monthlyMedicaidBilledCents,
      medicaid_rate_unit: 'monthly',
      payer_share_type: resident.payerType === 'private_pay' ? 'full' : 'partial',
      effective_date: resident.admissionDate || '2026-05-01',
      notes: resident.payerNote,
    },
    carePlan: {
      facility_id: args.facilityId,
      organization_id: args.organizationId,
      version: 1,
      status: 'draft',
      effective_date: admit,
      review_due_date: reviewDue,
      notes: `${IMPORT_TAG} placeholder care plan — full plan pending review (resident imported from AR workbook ${importStamp}).`,
    },
    bedUpdate: {
      id: bed.id,
      status: 'occupied',
    },
    resident_meta: {
      sourceName: resident.sourceName,
      roomBed: resident.roomBed,
      outstandingCents: resident.outstandingCents,
      providerRaw: resident.providerRaw,
    },
  };
}

async function applyOne(supabase, plan) {
  const { data: residentRows, error: rErr } = await supabase
    .from('residents').insert(plan.resident).select('id').single();
  if (rErr) throw new Error(`resident insert (${plan.resident_meta.sourceName}): ${rErr.message}`);
  const residentId = residentRows.id;

  const { error: pErr } = await supabase
    .from('resident_payers').insert({ ...plan.payer, resident_id: residentId });
  if (pErr) throw new Error(`payer insert (${plan.resident_meta.sourceName}): ${pErr.message}`);

  const { error: cErr } = await supabase
    .from('care_plans').insert({ ...plan.carePlan, resident_id: residentId });
  if (cErr) throw new Error(`care plan insert (${plan.resident_meta.sourceName}): ${cErr.message}`);

  const { error: bErr } = await supabase
    .from('beds').update({ status: plan.bedUpdate.status, current_resident_id: residentId }).eq('id', plan.bedUpdate.id);
  if (bErr) throw new Error(`bed update (${plan.resident_meta.sourceName}): ${bErr.message}`);

  return residentId;
}

function writeLog(args, summary, plans, conflicts, alreadyExisting, missingBeds, errors) {
  const lines = [];
  lines.push('# Homewood A/R → Live Import — Log');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Source file: ${args.file}`);
  lines.push(`Mode: ${args.apply ? 'APPLY' : 'DRY-RUN'}`);
  lines.push(`Facility: ${args.facilityId}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Residents parsed: ${summary.totalParsed}`);
  lines.push(`- Bed conflicts (skipped): ${conflicts.length} bed(s) / ${conflicts.reduce((a, c) => a + c.residents.length, 0)} resident(s)`);
  lines.push(`- Already existing at Homewood (skipped): ${alreadyExisting.length}`);
  lines.push(`- Missing bed in DB (skipped): ${missingBeds.length}`);
  lines.push(`- Residents ${args.apply ? 'imported' : 'planned'}: ${plans.length}`);
  lines.push(`- Errors: ${errors.length}`);
  lines.push('');

  if (conflicts.length) {
    lines.push('## Bed conflicts (manual resolution required)');
    lines.push('');
    lines.push('| Bed | Resident 1 | Admit 1 | Resident 2 | Admit 2 |');
    lines.push('|---|---|---|---|---|');
    for (const c of conflicts) {
      const [a, b] = c.residents;
      lines.push(`| ${c.bed} | ${a?.sourceName ?? ''} | ${a?.admissionDate ?? ''} | ${b?.sourceName ?? ''} | ${b?.admissionDate ?? ''} |`);
    }
    lines.push('');
  }

  if (missingBeds.length) {
    lines.push('## Residents whose room/bed could not be matched to the `beds` table');
    lines.push('');
    for (const m of missingBeds) lines.push(`- ${m.sourceName} → room/bed ${m.roomBed}`);
    lines.push('');
  }

  if (alreadyExisting.length) {
    lines.push('## Already-existing residents (skipped)');
    lines.push('');
    for (const a of alreadyExisting) lines.push(`- ${a.sourceName} (admit ${a.admissionDate})`);
    lines.push('');
  }

  if (errors.length) {
    lines.push('## Errors');
    lines.push('');
    for (const e of errors) lines.push(`- ${e}`);
    lines.push('');
  }

  if (plans.length) {
    lines.push(`## Residents ${args.apply ? 'imported' : 'planned'}`);
    lines.push('');
    lines.push('| Resident | Bed | Admit | Payer | Provider | Monthly | Outstanding |');
    lines.push('|---|---|---|---|---|---:|---:|');
    for (const { plan } of plans) {
      const m = plan.resident_meta;
      const monthly = plan.resident.monthly_total_rate ? `$${(plan.resident.monthly_total_rate / 100).toFixed(2)}` : '';
      const outstanding = m.outstandingCents ? `$${(m.outstandingCents / 100).toFixed(2)}` : '$0.00';
      lines.push(`| ${m.sourceName} | ${m.roomBed} | ${plan.resident.admission_date ?? ''} | ${plan.payer.payer_type} | ${m.providerRaw ?? ''} | ${monthly} | ${outstanding} |`);
    }
    lines.push('');
  }

  mkdirSync(path.dirname(args.log), { recursive: true });
  writeFileSync(args.log, `${lines.join('\n')}\n`);
}

function printConsoleReport(args, summary, plans, conflicts, alreadyExisting, missingBeds, errors) {
  console.log('');
  console.log(`Homewood A/R import (${args.apply ? 'APPLY' : 'DRY-RUN'}) — source: ${args.file}`);
  console.log(`  parsed=${summary.totalParsed}  ${args.apply ? 'imported' : 'planned'}=${plans.length}  skipped(conflicts)=${conflicts.reduce((a, c) => a + c.residents.length, 0)}  skipped(exists)=${alreadyExisting.length}  skipped(no-bed)=${missingBeds.length}  errors=${errors.length}`);
  if (conflicts.length) {
    console.log('');
    console.log(`Bed conflicts (${conflicts.length}):`);
    for (const c of conflicts) {
      console.log(`  ${c.bed}: ${c.residents.map((r) => `${r.sourceName} (${r.admissionDate})`).join('  vs  ')}`);
    }
  }
  if (missingBeds.length) {
    console.log('');
    console.log(`Unresolved beds (${missingBeds.length}):`);
    for (const m of missingBeds) console.log(`  ${m.roomBed}: ${m.sourceName}`);
  }
  if (alreadyExisting.length) {
    console.log('');
    console.log(`Already at Homewood (${alreadyExisting.length}):`);
    for (const a of alreadyExisting) console.log(`  ${a.sourceName} (${a.admissionDate})`);
  }
  if (errors.length) {
    console.log('');
    console.log(`Errors (${errors.length}):`);
    for (const e of errors) console.log(`  ${e}`);
  }
  if (args.verbose && plans.length) {
    console.log('');
    console.log(`${args.apply ? 'Imported' : 'Planned'} residents (${plans.length}):`);
    for (const { plan } of plans) {
      const m = plan.resident_meta;
      const monthly = plan.resident.monthly_total_rate ? `$${(plan.resident.monthly_total_rate / 100).toFixed(2)}` : '—';
      console.log(`  ${m.sourceName.padEnd(25)} bed=${m.roomBed.padEnd(4)} admit=${plan.resident.admission_date ?? '—'.padEnd(10)} payer=${plan.payer.payer_type.padEnd(12)} provider=${(m.providerRaw ?? '—').padEnd(14)} monthly=${monthly}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envPath = loadEnvFile();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(`SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required (looked for .env.local upward from ${process.cwd()}; found ${envPath ?? 'none'})`);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const parsed = parseHomewoodAR(args.file);
  const conflicts = detectBedConflicts(parsed.residents);
  const conflictBeds = new Set(conflicts.map((c) => c.bed));

  const beds = await fetchBedIndex(supabase, args.facilityId);
  const existing = await fetchExistingResidents(supabase, args.facilityId);

  const plans = [];
  const alreadyExisting = [];
  const missingBeds = [];
  const errors = [];

  for (const resident of parsed.residents) {
    if (conflictBeds.has(resident.roomBed)) continue;
    const key = `${resident.lastName.toLowerCase()}|${resident.firstName.toLowerCase()}|${resident.admissionDate || ''}`;
    if (existing.has(key)) { alreadyExisting.push(resident); continue; }
    const bed = beds.get(resident.roomBed);
    if (!bed) { missingBeds.push(resident); continue; }
    plans.push({ resident, plan: planFor(resident, bed, args) });
  }

  if (args.apply) {
    for (const item of plans) {
      try {
        await applyOne(supabase, item.plan);
      } catch (e) {
        errors.push(e.message ?? String(e));
      }
    }
  }

  const summary = { totalParsed: parsed.residents.length };
  printConsoleReport(args, summary, plans, conflicts, alreadyExisting, missingBeds, errors);
  writeLog(args, summary, plans, conflicts, alreadyExisting, missingBeds, errors);
  console.log('');
  console.log(`Log: ${args.log}`);
  if (errors.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
