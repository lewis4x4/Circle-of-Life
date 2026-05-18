#!/usr/bin/env node
/**
 * Homewood Lodge ALF — promote May 2026 A/R workbook into live billing data.
 *
 * Source:
 *   /Users/brianlewis/Desktop/AR May 2026.xlsx
 *
 * Live targets:
 *   facilities.total_licensed_beds
 *   rate_schedules
 *   rate_schedule_versions
 *   residents rate/payer fields
 *   resident_payers
 *   invoices
 *   invoice_line_items
 *
 * Safety:
 *   - Homewood-only by default
 *   - dry-run performs DB-backed planning when credentials are present
 *   - no deletes
 *   - skips A/R rows with duplicate bed conflicts
 *   - skips rows that cannot be matched to an existing live resident
 *   - does not write payment rows yet; invoices carry amount_paid/balance_due
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { extractXlsxSheets } from "./onboarding/homewood/ingestion-lib.mjs";

const ROOT = process.cwd();
const DEFAULT_FILE = "/Users/brianlewis/Desktop/AR May 2026.xlsx";
const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_FACILITY_ID = "00000000-0000-0000-0002-000000000003";
const DEFAULT_ENTITY_ID = "00000000-0000-0000-0001-000000000003";
const AR_MONTH = "2026-05";
const PERIOD_START = "2026-05-01";
const PERIOD_END = "2026-05-31";
const DUE_DATE = "2026-05-15";
const HOMEWOOD_LICENSED_BEDS = 36;
const POSTED_PRIVATE_ROOM_CENTS = 555000;
const POSTED_COMPANION_ROOM_CENTS = 400000;

function usage() {
  return [
    "promote-homewood-ar-live.mjs",
    "",
    "Options:",
    `  --file <path>              Current A/R XLSX (default: ${DEFAULT_FILE})`,
    "  --dry-run                  Plan only; no writes",
    `  --facility-id <uuid>       Homewood facility id (default: ${DEFAULT_FACILITY_ID})`,
    `  --organization-id <uuid>   COL organization id (default: ${DEFAULT_ORG_ID})`,
    `  --entity-id <uuid>         Homewood billing entity id (default: ${DEFAULT_ENTITY_ID})`,
    "  --applied-by <uuid>        auth.users id for created_by/updated_by where required",
    "  --verbose                  Print row-level plan",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    file: DEFAULT_FILE,
    dryRun: false,
    facilityId: DEFAULT_FACILITY_ID,
    organizationId: DEFAULT_ORG_ID,
    entityId: DEFAULT_ENTITY_ID,
    appliedBy: null,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--file") args.file = path.resolve(process.cwd(), argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--facility-id") args.facilityId = argv[++i];
    else if (a === "--organization-id") args.organizationId = argv[++i];
    else if (a === "--entity-id") args.entityId = argv[++i];
    else if (a === "--applied-by") args.appliedBy = argv[++i];
    else if (a === "--verbose" || a === "-v") args.verbose = true;
    else if (a === "--help" || a === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}\n${usage()}`);
    }
  }

  return args;
}

function loadEnvFile() {
  for (const name of [".env.local", ".env"]) {
    const p = path.resolve(ROOT, name);
    if (!existsSync(p)) continue;
    for (const rawLine of readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, keyName, raw] = match;
      if (process.env[keyName]) continue;
      let value = raw.trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[keyName] = value;
    }
  }
}

function key(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function toNumber(value) {
  const cleaned = String(value ?? "").replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!cleaned || cleaned === "-") return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function toCents(value) {
  const n = toNumber(value);
  return n == null ? null : Math.round(n * 100);
}

function centsToDollars(cents) {
  return `$${((cents ?? 0) / 100).toFixed(2)}`;
}

function excelDateToIso(value) {
  const n = toNumber(value);
  if (n == null) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function normalizeRoomBed(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { raw: "", roomNumber: null, bedLabel: null, normalized: null };
  const cleaned = raw.replace(/\.0$/, "").toUpperCase().replace(/\s+/g, "");
  const match = cleaned.match(/^(\d+)([A-Z])?$/);
  if (!match) return { raw, roomNumber: cleaned, bedLabel: null, normalized: cleaned };
  const roomNumber = String(Number.parseInt(match[1], 10));
  const bedLabel = match[2] || "A";
  return { raw, roomNumber, bedLabel, normalized: `${roomNumber}${bedLabel}` };
}

function parseName(value) {
  const raw = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return null;
  if (raw.includes(",")) {
    const [last, rest = ""] = raw.split(",", 2).map((part) => part.trim());
    const [first, ...middleParts] = rest.split(/\s+/).filter(Boolean);
    return {
      fullLegalName: [first, ...middleParts, last].filter(Boolean).join(" "),
      firstName: first || "",
      middleName: middleParts.join(" ") || null,
      lastName: last || "",
      sourceName: raw,
    };
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  const first = parts.shift() || "";
  const last = parts.pop() || "";
  return {
    fullLegalName: [first, ...parts, last].filter(Boolean).join(" "),
    firstName: first,
    middleName: parts.join(" ") || null,
    lastName: last || first,
    sourceName: raw,
  };
}

function payerFrom(provider, medicaidBilledCents, privateAmountCents) {
  const normalized = String(provider || "").trim().toLowerCase();
  if (normalized.includes("pending")) return "medicaid_pending";
  if (normalized || (medicaidBilledCents ?? 0) > 0) return "medicaid_oss";
  if ((privateAmountCents ?? 0) > 0) return "private_pay";
  return "other";
}

function livePayerType(payerType) {
  if (payerType === "medicaid_pending") return "medicaid_oss";
  if (["private_pay", "medicaid_oss", "ltc_insurance", "va_aid_attendance", "other"].includes(payerType)) return payerType;
  return "other";
}

function payerName(row) {
  if (row.payerType === "medicaid_pending") return "Medicaid Pending";
  if (row.payerType === "medicaid_oss") return row.medicaidProvider || "Florida Medicaid / OSS";
  if (row.payerType === "private_pay") return "Private Pay";
  return row.medicaidProvider || "Other";
}

function findHeader(sheet) {
  for (let index = 0; index < sheet.rows.length; index += 1) {
    const headers = sheet.rows[index].map(key);
    if (headers.some((h) => h.includes("room")) && headers.some((h) => h.includes("resident"))) {
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
  const sheet = sheets.find((s) => /homewood/i.test(s.name)) || sheets.find((s) => /homewood/i.test(s.rows[0]?.join(" ") || ""));
  if (!sheet) throw new Error("No Homewood sheet found in A/R workbook.");
  const header = findHeader(sheet);
  if (!header) throw new Error(`No resident A/R header row found on sheet ${sheet.name}.`);

  const idx = {
    room: findIndex(header.headers, ["room"]),
    admitDate: findIndex(header.headers, ["admit_date"]),
    resident: findIndex(header.headers, ["residents_name", "resident_name", "resident"]),
    total: findIndex(header.headers, ["total_pvt_mcd", "total"]),
    privateAmount: findIndex(header.headers, ["pvt"]),
    privatePaid: findIndex(header.headers, ["amount_paid_privately", "paid_privately"]),
    medicaidBilled: findIndex(header.headers, ["medicaid_billed", "billed"]),
    medicaidPaid: findIndex(header.headers, ["medicaid_amount_pd", "amount_pd"]),
    outstanding: findIndex(header.headers, ["outstanding"]),
    provider: findIndex(header.headers, ["provider"]),
    notes: findIndex(header.headers, ["collection_notes", "notes"]),
    admittedFrom: findIndex(header.headers, ["admitted_from"]),
  };

  const missingRequired = Object.entries({ room: idx.room, resident: idx.resident, total: idx.total }).filter(([, value]) => value < 0);
  if (missingRequired.length) {
    throw new Error(`A/R workbook is missing required columns: ${missingRequired.map(([name]) => name).join(", ")}`);
  }

  const residents = [];
  for (let rowIndex = header.index + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
    const row = sheet.rows[rowIndex];
    const name = parseName(row[idx.resident]);
    const roomBed = normalizeRoomBed(row[idx.room]);
    if (!name && !roomBed.normalized) continue;
    if (!name || !roomBed.normalized) continue;
    if (/total|columns/i.test(name.sourceName)) continue;

    const totalContractedAmountCents = toCents(row[idx.total]);
    const privateAmountCents = toCents(row[idx.privateAmount]);
    const privatePaidCents = toCents(row[idx.privatePaid]) ?? 0;
    const medicaidBilledCents = toCents(row[idx.medicaidBilled]) ?? 0;
    const medicaidPaidCents = toCents(row[idx.medicaidPaid]) ?? 0;
    const outstandingAmountCents = toCents(row[idx.outstanding]) ?? 0;
    const provider = String(row[idx.provider] || "").trim() || null;
    const payerType = payerFrom(provider, medicaidBilledCents, privateAmountCents);

    residents.push({
      sourceRow: rowIndex + 1,
      ...name,
      admissionDate: excelDateToIso(row[idx.admitDate]),
      roomBed: roomBed.normalized,
      roomNumber: roomBed.roomNumber,
      bedLabel: roomBed.bedLabel,
      payerType,
      medicaidProvider: provider,
      totalContractedAmountCents,
      privateAmountCents,
      privatePaidCents,
      medicaidBilledCents,
      medicaidPaidCents,
      outstandingAmountCents,
      collectionNotes: String(row[idx.notes] || "").trim() || null,
      admittedFrom: String(row[idx.admittedFrom] || "").trim() || null,
    });
  }

  const byRoomBed = new Map();
  for (const resident of residents) {
    byRoomBed.set(resident.roomBed, [...(byRoomBed.get(resident.roomBed) || []), resident.fullLegalName]);
  }
  const duplicateRoomBedConflicts = Array.from(byRoomBed.entries())
    .filter(([, names]) => names.length > 1)
    .map(([roomBed, names]) => ({ roomBed, names }));
  const conflictSet = new Set(duplicateRoomBedConflicts.map((c) => c.roomBed));
  for (const resident of residents) {
    resident.bedAssignmentStatus = conflictSet.has(resident.roomBed) ? "conflict_needs_review" : "ready";
  }

  const summary = residents.reduce(
    (acc, row) => {
      acc.residentCount += 1;
      acc.totalContractedCents += row.totalContractedAmountCents ?? 0;
      acc.privatePaidCents += row.privatePaidCents ?? 0;
      acc.medicaidPaidCents += row.medicaidPaidCents ?? 0;
      acc.outstandingCents += row.outstandingAmountCents ?? 0;
      acc.payerCounts[row.payerType] = (acc.payerCounts[row.payerType] || 0) + 1;
      return acc;
    },
    {
      sourceSheet: sheet.name,
      sourceFile: file,
      arMonth: AR_MONTH,
      residentCount: 0,
      totalContractedCents: 0,
      privatePaidCents: 0,
      medicaidPaidCents: 0,
      outstandingCents: 0,
      payerCounts: {},
      duplicateRoomBedConflicts,
    },
  );

  return { summary, residents };
}

function normalizeName(first, last) {
  return `${String(first || "").toLowerCase().replace(/[^a-z]/g, "")}|${String(last || "").toLowerCase().replace(/[^a-z]/g, "")}`;
}

function invoiceNumber(row) {
  return `HOM-${AR_MONTH}-${String(row.sourceRow).padStart(3, "0")}`;
}

function invoiceStatus(row) {
  const total = row.totalContractedAmountCents ?? 0;
  const paid = (row.privatePaidCents ?? 0) + (row.medicaidPaidCents ?? 0);
  const balance = row.outstandingAmountCents ?? Math.max(0, total - paid);
  if (balance <= 0) return "paid";
  if (paid > 0) return "partial";
  return "sent";
}

function rowNotes(row, extra = []) {
  const parts = [
    `Imported from Homewood May 2026 A/R workbook row ${row.sourceRow}.`,
    `Source resident: ${row.sourceName}.`,
    `Source room/bed: ${row.roomBed}.`,
  ];
  if (row.payerType === "medicaid_pending") parts.push("Source payer marked Medicaid pending; stored as medicaid_oss with payer name Medicaid Pending because live payer enum has no medicaid_pending value.");
  if (row.collectionNotes) parts.push(`Collection notes: ${row.collectionNotes}`);
  if (row.admittedFrom) parts.push(`Admitted from: ${row.admittedFrom}`);
  parts.push(...extra.filter(Boolean));
  return parts.join(" ");
}

function different(a, b) {
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
}

async function selectAll(supa, table, queryBuilder) {
  const { data, error } = await queryBuilder(supa.from(table));
  if (error) throw new Error(`${table} lookup failed: ${error.message}`);
  return data ?? [];
}

async function maybeSingle(supa, table, queryBuilder) {
  const { data, error } = await queryBuilder(supa.from(table)).maybeSingle();
  if (error) throw new Error(`${table} lookup failed: ${error.message}`);
  return data ?? null;
}

async function resolveAppliedBy(supa, args) {
  if (args.appliedBy) return args.appliedBy;
  const { data, error } = await supa
    .from("user_profiles")
    .select("id, app_role")
    .eq("organization_id", args.organizationId)
    .in("app_role", ["owner", "org_admin", "facility_admin"])
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("app_role", { ascending: true })
    .limit(1);
  if (error) throw new Error(`Unable to resolve applied_by user: ${error.message}`);
  return data?.[0]?.id ?? null;
}

async function loadLiveState(supa, args) {
  const [facility, rooms, beds, residents] = await Promise.all([
    maybeSingle(supa, "facilities", (q) => q.select("id, total_licensed_beds").eq("id", args.facilityId).eq("organization_id", args.organizationId).is("deleted_at", null)),
    selectAll(supa, "rooms", (q) => q.select("id, room_number").eq("facility_id", args.facilityId).is("deleted_at", null)),
    selectAll(supa, "beds", (q) => q.select("id, room_id, bed_label, status, current_resident_id").eq("facility_id", args.facilityId).is("deleted_at", null)),
    selectAll(supa, "residents", (q) =>
      q
        .select("id, bed_id, first_name, last_name, admission_date, primary_payer, monthly_base_rate, monthly_total_rate, rate_effective_date")
        .eq("facility_id", args.facilityId)
        .is("deleted_at", null),
    ),
  ]);

  if (!facility) throw new Error(`Homewood facility not found: ${args.facilityId}`);

  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const residentById = new Map(residents.map((resident) => [resident.id, resident]));
  const residentByName = new Map(residents.map((resident) => [normalizeName(resident.first_name, resident.last_name), resident]));
  const bedByRoomBed = new Map();
  for (const bed of beds) {
    const room = roomById.get(bed.room_id);
    if (!room) continue;
    bedByRoomBed.set(`${room.room_number}${bed.bed_label}`, { ...bed, room_number: room.room_number });
  }

  return { facility, beds, bedByRoomBed, residentById, residentByName };
}

function buildResidentPlans(parsed, live, args) {
  const plans = [];
  const skipped = [];
  for (const row of parsed.residents) {
    if (row.bedAssignmentStatus !== "ready") {
      skipped.push({ row, reason: `A/R duplicate bed conflict for ${row.roomBed}` });
      continue;
    }
    const bed = live.bedByRoomBed.get(row.roomBed) ?? null;
    let resident = bed?.current_resident_id ? live.residentById.get(bed.current_resident_id) : null;
    const matchedBy = resident ? "bed" : "name";
    if (!resident) resident = live.residentByName.get(normalizeName(row.firstName, row.lastName)) ?? null;
    if (!resident) {
      skipped.push({ row, reason: `No live resident match for ${row.fullLegalName} at ${row.roomBed}` });
      continue;
    }

    const mappedPayer = livePayerType(row.payerType);
    const total = row.totalContractedAmountCents ?? 0;
    const base = row.privateAmountCents ?? total;
    const paid = (row.privatePaidCents ?? 0) + (row.medicaidPaidCents ?? 0);
    const balance = row.outstandingAmountCents ?? Math.max(0, total - paid);
    const notes = rowNotes(row, matchedBy === "name" ? [`Matched by name because source bed ${row.roomBed} did not currently point to this resident.`] : []);

    const residentUpdate = {};
    if (different(resident.primary_payer, mappedPayer)) residentUpdate.primary_payer = mappedPayer;
    if (different(resident.monthly_base_rate, base)) residentUpdate.monthly_base_rate = base;
    if (different(resident.monthly_total_rate, total)) residentUpdate.monthly_total_rate = total;
    if (different(resident.rate_effective_date, PERIOD_START)) residentUpdate.rate_effective_date = PERIOD_START;
    if (!resident.admission_date && row.admissionDate) residentUpdate.admission_date = row.admissionDate;

    plans.push({
      row,
      bed,
      resident,
      matchedBy,
      residentUpdate,
      payerPayload: {
        resident_id: resident.id,
        facility_id: args.facilityId,
        organization_id: args.organizationId,
        payer_type: mappedPayer,
        is_primary: true,
        payer_name: payerName(row),
        medicaid_rate: row.medicaidBilledCents || null,
        medicaid_patient_responsibility: row.payerType === "private_pay" ? null : row.privateAmountCents,
        payer_share_type: "fixed_amount",
        payer_fixed_amount: total,
        effective_date: PERIOD_START,
        notes,
      },
      invoicePayload: {
        resident_id: resident.id,
        facility_id: args.facilityId,
        organization_id: args.organizationId,
        entity_id: args.entityId,
        invoice_number: invoiceNumber(row),
        invoice_date: PERIOD_START,
        due_date: DUE_DATE,
        period_start: PERIOD_START,
        period_end: PERIOD_END,
        status: invoiceStatus(row),
        subtotal: total,
        adjustments: 0,
        tax: 0,
        total,
        amount_paid: paid,
        balance_due: balance,
        payer_type: mappedPayer,
        payer_name: payerName(row),
        notes,
      },
      linePayload: {
        organization_id: args.organizationId,
        line_type: "room_and_board",
        description: "May 2026 contracted room and board from Homewood A/R",
        quantity: 1,
        unit_price: total,
        total,
        sort_order: 1,
      },
    });
  }
  return { plans, skipped };
}

async function enrichPlanWithExistingRows(supa, residentPlans, args) {
  const residentIds = residentPlans.map((p) => p.resident.id);
  const invoiceNumbers = residentPlans.map((p) => p.invoicePayload.invoice_number);
  const [payers, invoices] = await Promise.all([
    residentIds.length
      ? selectAll(supa, "resident_payers", (q) =>
          q.select("*").in("resident_id", residentIds).eq("is_primary", true).is("deleted_at", null).is("end_date", null),
        )
      : [],
    invoiceNumbers.length
      ? selectAll(supa, "invoices", (q) => q.select("*").in("invoice_number", invoiceNumbers).is("deleted_at", null))
      : [],
  ]);
  const payerByResident = new Map(payers.map((payer) => [payer.resident_id, payer]));
  const invoiceByNumber = new Map(invoices.map((invoice) => [invoice.invoice_number, invoice]));

  const existingInvoiceIds = invoices.map((invoice) => invoice.id);
  const lines = existingInvoiceIds.length
    ? await selectAll(supa, "invoice_line_items", (q) => q.select("id, invoice_id").in("invoice_id", existingInvoiceIds))
    : [];
  const lineCountByInvoice = new Map();
  for (const line of lines) lineCountByInvoice.set(line.invoice_id, (lineCountByInvoice.get(line.invoice_id) || 0) + 1);

  for (const plan of residentPlans) {
    const existingPayer = payerByResident.get(plan.resident.id) ?? null;
    plan.existingPayer = existingPayer;
    plan.payerAction = existingPayer ? (payerDiff(existingPayer, plan.payerPayload) ? "update" : "noop") : "insert";

    const existingInvoice = invoiceByNumber.get(plan.invoicePayload.invoice_number) ?? null;
    plan.existingInvoice = existingInvoice;
    plan.invoiceAction = existingInvoice ? (invoiceDiff(existingInvoice, plan.invoicePayload) ? "update" : "noop") : "insert";
    plan.lineAction = existingInvoice && lineCountByInvoice.get(existingInvoice.id) > 0 ? "noop" : "insert";
    plan.lineExistingInvoiceId = existingInvoice?.id ?? null;
  }

  const rateSchedule = await maybeSingle(supa, "rate_schedules", (q) =>
    q
      .select("*")
      .eq("facility_id", args.facilityId)
      .eq("organization_id", args.organizationId)
      .eq("name", "2026 Homewood Posted Rates")
      .eq("effective_date", PERIOD_START)
      .is("deleted_at", null),
  );

  const rateVersions = await selectAll(supa, "rate_schedule_versions", (q) =>
    q
      .select("*")
      .eq("facility_id", args.facilityId)
      .eq("organization_id", args.organizationId)
      .in("rate_type", ["private_room", "semi_private_room"])
      .is("effective_to", null)
      .is("deleted_at", null),
  );

  return { rateSchedule, rateVersions };
}

function payerDiff(existing, payload) {
  const keys = [
    "payer_type",
    "payer_name",
    "medicaid_rate",
    "medicaid_patient_responsibility",
    "payer_share_type",
    "payer_fixed_amount",
    "effective_date",
    "notes",
  ];
  return keys.some((k) => different(existing[k], payload[k]));
}

function invoiceDiff(existing, payload) {
  const keys = [
    "resident_id",
    "entity_id",
    "invoice_date",
    "due_date",
    "period_start",
    "period_end",
    "status",
    "subtotal",
    "adjustments",
    "tax",
    "total",
    "amount_paid",
    "balance_due",
    "payer_type",
    "payer_name",
    "notes",
  ];
  return keys.some((k) => different(existing[k], payload[k]));
}

function rateSchedulePayload(args, appliedBy) {
  return {
    facility_id: args.facilityId,
    organization_id: args.organizationId,
    name: "2026 Homewood Posted Rates",
    effective_date: PERIOD_START,
    end_date: null,
    base_rate_private: POSTED_PRIVATE_ROOM_CENTS,
    base_rate_semi_private: POSTED_COMPANION_ROOM_CENTS,
    care_surcharge_level_1: 0,
    care_surcharge_level_2: 0,
    care_surcharge_level_3: 0,
    community_fee: 0,
    pet_fee: 0,
    second_occupant_fee: 0,
    respite_daily_rate: null,
    bed_hold_daily_rate: null,
    notes: "Homewood posted May 2026 room rates from onboarding intake: private $5,550; companion $4,000.",
    created_by: appliedBy,
    updated_by: appliedBy,
  };
}

function rateScheduleDiff(existing, payload) {
  const keys = [
    "base_rate_private",
    "base_rate_semi_private",
    "care_surcharge_level_1",
    "care_surcharge_level_2",
    "care_surcharge_level_3",
    "community_fee",
    "pet_fee",
    "second_occupant_fee",
    "notes",
  ];
  return keys.some((k) => different(existing[k], payload[k]));
}

function summarizePlan(residentPlans, skipped, extras) {
  const counts = {
    residents_update: residentPlans.filter((p) => Object.keys(p.residentUpdate).length > 0).length,
    payers_insert: residentPlans.filter((p) => p.payerAction === "insert").length,
    payers_update: residentPlans.filter((p) => p.payerAction === "update").length,
    payers_noop: residentPlans.filter((p) => p.payerAction === "noop").length,
    invoices_insert: residentPlans.filter((p) => p.invoiceAction === "insert").length,
    invoices_update: residentPlans.filter((p) => p.invoiceAction === "update").length,
    invoices_noop: residentPlans.filter((p) => p.invoiceAction === "noop").length,
    lines_insert: residentPlans.filter((p) => p.lineAction === "insert").length,
    skipped: skipped.length,
    ...extras,
  };
  return counts;
}

async function applyFacilityAndRates(supa, args, appliedBy, live, rateState) {
  const written = { facilities_update: 0, rate_schedules_insert: 0, rate_schedules_update: 0, rate_versions_insert: 0, rate_versions_update: 0 };

  if (live.facility.total_licensed_beds !== HOMEWOOD_LICENSED_BEDS) {
    const { error } = await supa
      .from("facilities")
      .update({ total_licensed_beds: HOMEWOOD_LICENSED_BEDS, updated_by: appliedBy })
      .eq("id", args.facilityId);
    if (error) throw new Error(`Facility licensed bed update failed: ${error.message}`);
    written.facilities_update += 1;
  }

  const rsPayload = rateSchedulePayload(args, appliedBy);
  if (!rateState.rateSchedule) {
    const { error } = await supa.from("rate_schedules").insert(rsPayload);
    if (error) throw new Error(`rate_schedules insert failed: ${error.message}`);
    written.rate_schedules_insert += 1;
  } else if (rateScheduleDiff(rateState.rateSchedule, rsPayload)) {
    const { error } = await supa
      .from("rate_schedules")
      .update({ ...rsPayload, created_by: rateState.rateSchedule.created_by ?? appliedBy })
      .eq("id", rateState.rateSchedule.id);
    if (error) throw new Error(`rate_schedules update failed: ${error.message}`);
    written.rate_schedules_update += 1;
  }

  if (appliedBy) {
    for (const desired of [
      { rate_type: "private_room", amount_cents: POSTED_PRIVATE_ROOM_CENTS },
      { rate_type: "semi_private_room", amount_cents: POSTED_COMPANION_ROOM_CENTS },
    ]) {
      const existing = rateState.rateVersions.find((r) => r.rate_type === desired.rate_type) ?? null;
      const payload = {
        facility_id: args.facilityId,
        organization_id: args.organizationId,
        rate_type: desired.rate_type,
        amount_cents: desired.amount_cents,
        effective_from: PERIOD_START,
        effective_to: null,
        approved_by: appliedBy,
        approved_at: new Date().toISOString(),
        notes: "Homewood May 2026 posted rate promoted from onboarding A/R workflow.",
        created_by: appliedBy,
        rate_confirmed: true,
      };
      if (!existing) {
        const { error } = await supa.from("rate_schedule_versions").insert(payload);
        if (error) throw new Error(`rate_schedule_versions insert failed for ${desired.rate_type}: ${error.message}`);
        written.rate_versions_insert += 1;
      } else if (existing.effective_from === PERIOD_START) {
        const needsUpdate = different(existing.amount_cents, payload.amount_cents) || different(existing.rate_confirmed, true) || different(existing.notes, payload.notes);
        if (needsUpdate) {
          const { error } = await supa
            .from("rate_schedule_versions")
            .update({
              amount_cents: payload.amount_cents,
              rate_confirmed: true,
              approved_by: appliedBy,
              approved_at: payload.approved_at,
              notes: payload.notes,
            })
            .eq("id", existing.id);
          if (error) throw new Error(`rate_schedule_versions update failed for ${desired.rate_type}: ${error.message}`);
          written.rate_versions_update += 1;
        }
      } else {
        const { error: closeError } = await supa
          .from("rate_schedule_versions")
          .update({ effective_to: PERIOD_START })
          .eq("id", existing.id);
        if (closeError) throw new Error(`rate_schedule_versions close failed for ${desired.rate_type}: ${closeError.message}`);
        const { error: insertError } = await supa.from("rate_schedule_versions").insert(payload);
        if (insertError) throw new Error(`rate_schedule_versions insert replacement failed for ${desired.rate_type}: ${insertError.message}`);
        written.rate_versions_update += 1;
        written.rate_versions_insert += 1;
      }
    }
  }

  return written;
}

async function applyResidentPlan(supa, args, appliedBy, plan) {
  const written = { residents_update: 0, payers_insert: 0, payers_update: 0, invoices_insert: 0, invoices_update: 0, lines_insert: 0 };

  if (Object.keys(plan.residentUpdate).length > 0) {
    const { error } = await supa
      .from("residents")
      .update({ ...plan.residentUpdate, updated_by: appliedBy })
      .eq("id", plan.resident.id);
    if (error) throw new Error(`Resident rate update failed for ${plan.row.fullLegalName}: ${error.message}`);
    written.residents_update += 1;
  }

  if (plan.payerAction === "insert") {
    const { error } = await supa.from("resident_payers").insert({ ...plan.payerPayload, created_by: appliedBy, updated_by: appliedBy });
    if (error) throw new Error(`Resident payer insert failed for ${plan.row.fullLegalName}: ${error.message}`);
    written.payers_insert += 1;
  } else if (plan.payerAction === "update") {
    const { error } = await supa
      .from("resident_payers")
      .update({ ...plan.payerPayload, updated_by: appliedBy })
      .eq("id", plan.existingPayer.id);
    if (error) throw new Error(`Resident payer update failed for ${plan.row.fullLegalName}: ${error.message}`);
    written.payers_update += 1;
  }

  let invoiceId = plan.existingInvoice?.id ?? null;
  if (plan.invoiceAction === "insert") {
    const { data, error } = await supa
      .from("invoices")
      .insert({ ...plan.invoicePayload, created_by: appliedBy, updated_by: appliedBy })
      .select("id")
      .single();
    if (error) throw new Error(`Invoice insert failed for ${plan.row.fullLegalName}: ${error.message}`);
    invoiceId = data.id;
    written.invoices_insert += 1;
  } else if (plan.invoiceAction === "update") {
    const { error } = await supa
      .from("invoices")
      .update({ ...plan.invoicePayload, updated_by: appliedBy })
      .eq("id", plan.existingInvoice.id);
    if (error) throw new Error(`Invoice update failed for ${plan.row.fullLegalName}: ${error.message}`);
    invoiceId = plan.existingInvoice.id;
    written.invoices_update += 1;
  }

  if (plan.lineAction === "insert" && invoiceId) {
    const { error } = await supa.from("invoice_line_items").insert({ ...plan.linePayload, invoice_id: invoiceId });
    if (error) throw new Error(`Invoice line insert failed for ${plan.row.fullLegalName}: ${error.message}`);
    written.lines_insert += 1;
  }

  return written;
}

function addCounts(target, source) {
  for (const [k, v] of Object.entries(source)) target[k] = (target[k] || 0) + v;
}

function printParsedSummary(parsed) {
  const s = parsed.summary;
  console.log(`Parsed Homewood A/R: ${s.residentCount} resident rows from ${s.sourceSheet}`);
  console.log(`Totals: contracted ${centsToDollars(s.totalContractedCents)}, collected ${centsToDollars(s.privatePaidCents + s.medicaidPaidCents)}, outstanding ${centsToDollars(s.outstandingCents)}`);
  console.log(`Payers: ${Object.entries(s.payerCounts).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`);
  if (s.duplicateRoomBedConflicts.length > 0) console.log(`Bed conflicts held for review: ${s.duplicateRoomBedConflicts.map((c) => c.roomBed).join(", ")}`);
}

function printPlan(residentPlans, skipped, counts, verbose) {
  console.log(`Live A/R promotion plan: ${residentPlans.length} matched resident rows, ${skipped.length} skipped/review rows.`);
  console.log(`Plan tally: ${JSON.stringify(counts)}`);
  if (!verbose) return;
  for (const plan of residentPlans) {
    console.log(
      `[homewood:ar-live] row=${plan.row.sourceRow} ${plan.row.fullLegalName} ${plan.row.roomBed} matched_by=${plan.matchedBy} resident=${Object.keys(plan.residentUpdate).length ? "update" : "noop"} payer=${plan.payerAction} invoice=${plan.invoiceAction} line=${plan.lineAction}`,
    );
  }
  for (const item of skipped) {
    console.log(`[homewood:ar-live] row=${item.row.sourceRow} SKIP ${item.row.fullLegalName} ${item.row.roomBed} — ${item.reason}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const parsed = parseWorkbook(args.file);
  printParsedSummary(parsed);

  loadEnvFile();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    if (args.dryRun) {
      console.log("No Supabase credentials found. Parse-only dry-run complete; DB-backed live plan not available in this environment.");
      return;
    }
    throw new Error("SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required unless --dry-run is used for parse-only validation.");
  }

  const supa = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const appliedBy = await resolveAppliedBy(supa, args);
  const live = await loadLiveState(supa, args);
  const { plans: residentPlans, skipped } = buildResidentPlans(parsed, live, args);
  const rateState = await enrichPlanWithExistingRows(supa, residentPlans, args);

  const facilityUpdateCount = live.facility.total_licensed_beds !== HOMEWOOD_LICENSED_BEDS ? 1 : 0;
  const rsPayload = rateSchedulePayload(args, appliedBy);
  const rateScheduleAction = !rateState.rateSchedule ? "insert" : rateScheduleDiff(rateState.rateSchedule, rsPayload) ? "update" : "noop";
  const rateVersionActions = rateState.rateVersions.length === 0 ? "insert" : "upsert";
  const counts = summarizePlan(residentPlans, skipped, {
    facilities_update: facilityUpdateCount,
    rate_schedule: rateScheduleAction,
    rate_versions: appliedBy ? rateVersionActions : "skipped_no_applied_by",
  });
  printPlan(residentPlans, skipped, counts, args.verbose);

  if (args.dryRun) {
    console.log("Dry run only: no live writes performed.");
    return;
  }

  const written = {};
  addCounts(written, await applyFacilityAndRates(supa, args, appliedBy, live, rateState));
  for (const plan of residentPlans) {
    addCounts(written, await applyResidentPlan(supa, args, appliedBy, plan));
  }

  console.log(`Homewood live A/R promotion complete. Write tally: ${JSON.stringify(written)}`);
  console.log(`Held for review / not promoted: ${skipped.length} A/R row(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
