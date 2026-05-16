#!/usr/bin/env node
/**
 * Homewood Lodge ALF — data audit (Sprint 1 of Homewood Go-Live).
 *
 * Read-only. Service-role connection so RLS doesn't filter results.
 * Scope is strictly the Homewood facility — every query filters on
 * facility_id = HOMEWOOD_FACILITY_ID (or organization_id with a join).
 *
 * Output: docs/homewood/DATA_AUDIT.md — markdown report with severity table
 * up top and per-anomaly detail (up to 5 sample IDs each).
 *
 * Exit codes:
 *   0  audit ran cleanly (regardless of anomaly counts; the user triages those)
 *   1  audit failed to run (auth, connectivity, schema error)
 *   2  environment misconfigured
 *
 * Severity scale:
 *   CRITICAL  launch-blocker — must fix before T-0
 *   HIGH      fix before launch
 *   MEDIUM    fix in first 2 weeks
 *   LOW       track only
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const REPORT_PATH = path.join(ROOT, "docs", "homewood", "DATA_AUDIT.md");

const DEFAULT_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_HOMEWOOD_FACILITY_ID = "00000000-0000-0000-0002-000000000003";

const FUTURE_DATE_DAYS = 0; // any future admission date is anomalous
const ANCIENT_DATE_YEARS = 50;
const STALE_REVIEW_DAYS = 90;
const STALE_INCIDENT_DAYS = 30;
const SAMPLE_LIMIT = 5;

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

function requireEnv(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required env var: ${names.join(" or ")}`);
}

function daysAgoIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function dateAgoIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function yearsAgoIso(years) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function safeMessage(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  return error.message || error.code || JSON.stringify(error);
}

/**
 * Build a single audit finding.
 *
 * @param {{
 *   key: string,
 *   title: string,
 *   severity: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW',
 *   description: string,
 *   count: number,
 *   sampleIds: string[],
 *   error?: string,
 * }} finding
 */
function finding(finding) {
  return {
    key: finding.key,
    title: finding.title,
    severity: finding.severity,
    description: finding.description,
    count: finding.count ?? 0,
    sampleIds: finding.sampleIds ?? [],
    error: finding.error,
  };
}

async function checkResidentsWithoutRooms(supa, facilityId) {
  const { data, count, error } = await supa
    .from("residents")
    .select("id, first_name, last_name", { count: "exact" })
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .in("status", ["active", "pending_admission", "hospital_hold", "loa"])
    .is("bed_id", null)
    .limit(SAMPLE_LIMIT);
  if (error) {
    return finding({
      key: "residents_no_room",
      title: "Active residents without a bed/room assignment",
      severity: "HIGH",
      description: "Active residents whose `bed_id` is NULL — they have no physical assignment.",
      count: 0,
      sampleIds: [],
      error: safeMessage(error),
    });
  }
  return finding({
    key: "residents_no_room",
    title: "Active residents without a bed/room assignment",
    severity: "HIGH",
    description: "Active residents whose `bed_id` is NULL — they have no physical assignment.",
    count: count ?? data?.length ?? 0,
    sampleIds: (data ?? []).map((r) => r.id),
  });
}

async function checkResidentsWithoutActiveCarePlan(supa, facilityId) {
  const { data: residents, error: rerr } = await supa
    .from("residents")
    .select("id")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .eq("status", "active");
  if (rerr) {
    return finding({
      key: "residents_no_active_care_plan",
      title: "Active residents without an active care plan",
      severity: "CRITICAL",
      description: "Active residents that have zero rows in `care_plans` with status='active' and deleted_at IS NULL.",
      count: 0,
      sampleIds: [],
      error: safeMessage(rerr),
    });
  }
  const ids = (residents ?? []).map((r) => r.id);
  if (ids.length === 0) {
    return finding({
      key: "residents_no_active_care_plan",
      title: "Active residents without an active care plan",
      severity: "CRITICAL",
      description: "Active residents that have zero rows in `care_plans` with status='active' and deleted_at IS NULL.",
      count: 0,
      sampleIds: [],
    });
  }
  const { data: cps, error: cperr } = await supa
    .from("care_plans")
    .select("resident_id")
    .eq("facility_id", facilityId)
    .eq("status", "active")
    .is("deleted_at", null)
    .in("resident_id", ids);
  if (cperr) {
    return finding({
      key: "residents_no_active_care_plan",
      title: "Active residents without an active care plan",
      severity: "CRITICAL",
      description: "Active residents that have zero rows in `care_plans` with status='active' and deleted_at IS NULL.",
      count: 0,
      sampleIds: [],
      error: safeMessage(cperr),
    });
  }
  const withPlan = new Set((cps ?? []).map((row) => row.resident_id));
  const missing = ids.filter((id) => !withPlan.has(id));
  return finding({
    key: "residents_no_active_care_plan",
    title: "Active residents without an active care plan",
    severity: "CRITICAL",
    description: "Active residents that have zero rows in `care_plans` with status='active' and deleted_at IS NULL.",
    count: missing.length,
    sampleIds: missing.slice(0, SAMPLE_LIMIT),
  });
}

async function checkResidentsWithoutPrimaryDiagnosis(supa, facilityId) {
  const { data, count, error } = await supa
    .from("residents")
    .select("id", { count: "exact" })
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .eq("status", "active")
    .or("primary_diagnosis.is.null,primary_diagnosis.eq.")
    .limit(SAMPLE_LIMIT);
  if (error) {
    return finding({
      key: "residents_no_primary_diagnosis",
      title: "Active residents without a primary diagnosis",
      severity: "HIGH",
      description: "Active residents where `primary_diagnosis` is NULL or empty.",
      count: 0,
      sampleIds: [],
      error: safeMessage(error),
    });
  }
  return finding({
    key: "residents_no_primary_diagnosis",
    title: "Active residents without a primary diagnosis",
    severity: "HIGH",
    description: "Active residents where `primary_diagnosis` is NULL or empty.",
    count: count ?? data?.length ?? 0,
    sampleIds: (data ?? []).map((r) => r.id),
  });
}

async function checkResidentsWithoutMedications(supa, facilityId) {
  const { data: residents, error: rerr } = await supa
    .from("residents")
    .select("id")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .eq("status", "active");
  if (rerr) {
    return finding({
      key: "residents_no_medications",
      title: "Active residents without any active medications",
      severity: "MEDIUM",
      description: "Active residents that have zero rows in `resident_medications` with status='active' and deleted_at IS NULL.",
      count: 0,
      sampleIds: [],
      error: safeMessage(rerr),
    });
  }
  const ids = (residents ?? []).map((r) => r.id);
  if (ids.length === 0) {
    return finding({
      key: "residents_no_medications",
      title: "Active residents without any active medications",
      severity: "MEDIUM",
      description: "Active residents that have zero rows in `resident_medications` with status='active' and deleted_at IS NULL.",
      count: 0,
      sampleIds: [],
    });
  }
  const { data: meds, error: merr } = await supa
    .from("resident_medications")
    .select("resident_id")
    .eq("facility_id", facilityId)
    .eq("status", "active")
    .is("deleted_at", null)
    .in("resident_id", ids);
  if (merr) {
    return finding({
      key: "residents_no_medications",
      title: "Active residents without any active medications",
      severity: "MEDIUM",
      description: "Active residents that have zero rows in `resident_medications` with status='active' and deleted_at IS NULL.",
      count: 0,
      sampleIds: [],
      error: safeMessage(merr),
    });
  }
  const withMeds = new Set((meds ?? []).map((row) => row.resident_id));
  const missing = ids.filter((id) => !withMeds.has(id));
  return finding({
    key: "residents_no_medications",
    title: "Active residents without any active medications",
    severity: "MEDIUM",
    description:
      "Active residents that have zero rows in `resident_medications` with status='active' and deleted_at IS NULL. Some residents legitimately take no medications, so this is informational rather than blocking.",
    count: missing.length,
    sampleIds: missing.slice(0, SAMPLE_LIMIT),
  });
}

async function checkResidentsWithoutFamilyLinks(supa, facilityId) {
  const { data: residents, error: rerr } = await supa
    .from("residents")
    .select("id, organization_id")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .eq("status", "active");
  if (rerr) {
    return finding({
      key: "residents_no_family_links",
      title: "Active residents without any family link",
      severity: "LOW",
      description: "Active residents not referenced by any active row in `family_resident_links` (revoked_at IS NULL).",
      count: 0,
      sampleIds: [],
      error: safeMessage(rerr),
    });
  }
  const ids = (residents ?? []).map((r) => r.id);
  if (ids.length === 0) {
    return finding({
      key: "residents_no_family_links",
      title: "Active residents without any family link",
      severity: "LOW",
      description: "Active residents not referenced by any active row in `family_resident_links` (revoked_at IS NULL).",
      count: 0,
      sampleIds: [],
    });
  }
  const { data: links, error: lerr } = await supa
    .from("family_resident_links")
    .select("resident_id")
    .is("revoked_at", null)
    .in("resident_id", ids);
  if (lerr) {
    return finding({
      key: "residents_no_family_links",
      title: "Active residents without any family link",
      severity: "LOW",
      description: "Active residents not referenced by any active row in `family_resident_links` (revoked_at IS NULL).",
      count: 0,
      sampleIds: [],
      error: safeMessage(lerr),
    });
  }
  const linked = new Set((links ?? []).map((row) => row.resident_id));
  const missing = ids.filter((id) => !linked.has(id));
  return finding({
    key: "residents_no_family_links",
    title: "Active residents without any family link",
    severity: "LOW",
    description:
      "Active residents not referenced by any active row in `family_resident_links` (revoked_at IS NULL). Family portal is not required for launch but flag these so onboarding knows whose accounts are still pending.",
    count: missing.length,
    sampleIds: missing.slice(0, SAMPLE_LIMIT),
  });
}

async function checkResidentAdmissionDateSanity(supa, facilityId) {
  const today = todayIso();
  const ancient = yearsAgoIso(ANCIENT_DATE_YEARS);
  const future = await supa
    .from("residents")
    .select("id, admission_date", { count: "exact" })
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .gt("admission_date", today)
    .limit(SAMPLE_LIMIT);
  const ancientQ = await supa
    .from("residents")
    .select("id, admission_date", { count: "exact" })
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .lt("admission_date", ancient)
    .limit(SAMPLE_LIMIT);
  if (future.error || ancientQ.error) {
    return finding({
      key: "residents_admission_date_sanity",
      title: "Residents with implausible admission dates",
      severity: "HIGH",
      description:
        `Residents whose \`admission_date\` is in the future or older than ${ANCIENT_DATE_YEARS} years ago — likely import errors.`,
      count: 0,
      sampleIds: [],
      error: safeMessage(future.error || ancientQ.error),
    });
  }
  const samples = [
    ...(future.data ?? []).map((r) => `${r.id} (future ${r.admission_date})`),
    ...(ancientQ.data ?? []).map((r) => `${r.id} (ancient ${r.admission_date})`),
  ].slice(0, SAMPLE_LIMIT);
  const total = (future.count ?? future.data?.length ?? 0) + (ancientQ.count ?? ancientQ.data?.length ?? 0);
  return finding({
    key: "residents_admission_date_sanity",
    title: "Residents with implausible admission dates",
    severity: "HIGH",
    description:
      `Residents whose \`admission_date\` is in the future or older than ${ANCIENT_DATE_YEARS} years ago — likely import errors.`,
    count: total,
    sampleIds: samples,
  });
}

async function checkStaffWithoutUserAccount(supa, facilityId) {
  const { data, count, error } = await supa
    .from("staff")
    .select("id, first_name, last_name, staff_role", { count: "exact" })
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .eq("employment_status", "active")
    .is("user_id", null)
    .limit(SAMPLE_LIMIT);
  if (error) {
    return finding({
      key: "staff_no_user_account",
      title: "Active staff records without a linked auth user",
      severity: "HIGH",
      description:
        "`staff` rows where employment_status='active' but `user_id` is NULL — these employees cannot sign in.",
      count: 0,
      sampleIds: [],
      error: safeMessage(error),
    });
  }
  return finding({
    key: "staff_no_user_account",
    title: "Active staff records without a linked auth user",
    severity: "HIGH",
    description:
      "`staff` rows where employment_status='active' but `user_id` is NULL — these employees cannot sign in.",
    count: count ?? data?.length ?? 0,
    sampleIds: (data ?? []).map((r) => r.id),
  });
}

async function checkStaffMissingCertifications(supa, facilityId) {
  const REQUIRED_ROLES = ["cna", "lpn", "rn"];
  const { data: staffRows, error: serr } = await supa
    .from("staff")
    .select("id, staff_role")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .eq("employment_status", "active")
    .in("staff_role", REQUIRED_ROLES);
  if (serr) {
    return finding({
      key: "staff_missing_certifications",
      title: "Clinical staff (CNA / LPN / RN) without any active certification on file",
      severity: "HIGH",
      description:
        "Active staff in clinical roles with zero rows in `staff_certifications` (status='active', deleted_at IS NULL).",
      count: 0,
      sampleIds: [],
      error: safeMessage(serr),
    });
  }
  const ids = (staffRows ?? []).map((row) => row.id);
  if (ids.length === 0) {
    return finding({
      key: "staff_missing_certifications",
      title: "Clinical staff (CNA / LPN / RN) without any active certification on file",
      severity: "HIGH",
      description:
        "Active staff in clinical roles with zero rows in `staff_certifications` (status='active', deleted_at IS NULL).",
      count: 0,
      sampleIds: [],
    });
  }
  const { data: certs, error: cerr } = await supa
    .from("staff_certifications")
    .select("staff_id")
    .eq("facility_id", facilityId)
    .eq("status", "active")
    .is("deleted_at", null)
    .in("staff_id", ids);
  if (cerr) {
    return finding({
      key: "staff_missing_certifications",
      title: "Clinical staff (CNA / LPN / RN) without any active certification on file",
      severity: "HIGH",
      description:
        "Active staff in clinical roles with zero rows in `staff_certifications` (status='active', deleted_at IS NULL).",
      count: 0,
      sampleIds: [],
      error: safeMessage(cerr),
    });
  }
  const withCerts = new Set((certs ?? []).map((row) => row.staff_id));
  const missing = ids.filter((id) => !withCerts.has(id));
  return finding({
    key: "staff_missing_certifications",
    title: "Clinical staff (CNA / LPN / RN) without any active certification on file",
    severity: "HIGH",
    description:
      "Active staff in clinical roles (CNA, LPN, RN) with zero rows in `staff_certifications` (status='active', deleted_at IS NULL).",
    count: missing.length,
    sampleIds: missing.slice(0, SAMPLE_LIMIT),
  });
}

async function checkStaffWithoutFacilityAccess(supa, facilityId) {
  const { data: staffRows, error: serr } = await supa
    .from("staff")
    .select("id, user_id, first_name, last_name")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .eq("employment_status", "active")
    .not("user_id", "is", null);
  if (serr) {
    return finding({
      key: "staff_no_facility_access",
      title: "Active staff with a user account but no Homewood facility access grant",
      severity: "HIGH",
      description:
        "Active staff whose `user_id` is NOT in `user_facility_access` for the Homewood facility (revoked_at IS NULL) — they can sign in but won't see Homewood data.",
      count: 0,
      sampleIds: [],
      error: safeMessage(serr),
    });
  }
  const userIds = (staffRows ?? []).map((row) => row.user_id);
  if (userIds.length === 0) {
    return finding({
      key: "staff_no_facility_access",
      title: "Active staff with a user account but no Homewood facility access grant",
      severity: "HIGH",
      description:
        "Active staff whose `user_id` is NOT in `user_facility_access` for the Homewood facility (revoked_at IS NULL).",
      count: 0,
      sampleIds: [],
    });
  }
  const { data: grants, error: gerr } = await supa
    .from("user_facility_access")
    .select("user_id")
    .eq("facility_id", facilityId)
    .is("revoked_at", null)
    .in("user_id", userIds);
  if (gerr) {
    return finding({
      key: "staff_no_facility_access",
      title: "Active staff with a user account but no Homewood facility access grant",
      severity: "HIGH",
      description:
        "Active staff whose `user_id` is NOT in `user_facility_access` for the Homewood facility (revoked_at IS NULL).",
      count: 0,
      sampleIds: [],
      error: safeMessage(gerr),
    });
  }
  const granted = new Set((grants ?? []).map((row) => row.user_id));
  const missing = (staffRows ?? []).filter((row) => !granted.has(row.user_id));
  return finding({
    key: "staff_no_facility_access",
    title: "Active staff with a user account but no Homewood facility access grant",
    severity: "HIGH",
    description:
      "Active staff whose `user_id` is NOT in `user_facility_access` for the Homewood facility (revoked_at IS NULL) — they can sign in but won't see Homewood data.",
    count: missing.length,
    sampleIds: missing.slice(0, SAMPLE_LIMIT).map((row) => row.id),
  });
}

async function checkFamilyAccountsWithoutLinks(supa, facilityId) {
  // Family users who have facility access to Homewood but no family_resident_links rows.
  const { data: grants, error: gerr } = await supa
    .from("user_facility_access")
    .select("user_id")
    .eq("facility_id", facilityId)
    .is("revoked_at", null);
  if (gerr) {
    return finding({
      key: "family_no_resident_link",
      title: "Family accounts at Homewood with no resident link",
      severity: "MEDIUM",
      description:
        "Users granted Homewood facility access whose app_role is 'family' but with zero active rows in `family_resident_links`.",
      count: 0,
      sampleIds: [],
      error: safeMessage(gerr),
    });
  }
  const userIds = [...new Set((grants ?? []).map((row) => row.user_id))];
  if (userIds.length === 0) {
    return finding({
      key: "family_no_resident_link",
      title: "Family accounts at Homewood with no resident link",
      severity: "MEDIUM",
      description:
        "Users granted Homewood facility access whose app_role is 'family' but with zero active rows in `family_resident_links`.",
      count: 0,
      sampleIds: [],
    });
  }
  // Find which of these users are family — check auth admin API (service role).
  let familyUserIds = [];
  try {
    const { data: usersList, error: lerr } = await supa.auth.admin.listUsers({ perPage: 1000 });
    if (lerr) throw lerr;
    const idSet = new Set(userIds);
    familyUserIds = (usersList?.users ?? [])
      .filter((u) => idSet.has(u.id) && (u.app_metadata?.app_role === "family"))
      .map((u) => u.id);
  } catch (err) {
    return finding({
      key: "family_no_resident_link",
      title: "Family accounts at Homewood with no resident link",
      severity: "MEDIUM",
      description:
        "Users granted Homewood facility access whose app_role is 'family' but with zero active rows in `family_resident_links`.",
      count: 0,
      sampleIds: [],
      error: safeMessage(err),
    });
  }
  if (familyUserIds.length === 0) {
    return finding({
      key: "family_no_resident_link",
      title: "Family accounts at Homewood with no resident link",
      severity: "MEDIUM",
      description:
        "Users granted Homewood facility access whose app_role is 'family' but with zero active rows in `family_resident_links`.",
      count: 0,
      sampleIds: [],
    });
  }
  const { data: links, error: lerr2 } = await supa
    .from("family_resident_links")
    .select("user_id")
    .is("revoked_at", null)
    .in("user_id", familyUserIds);
  if (lerr2) {
    return finding({
      key: "family_no_resident_link",
      title: "Family accounts at Homewood with no resident link",
      severity: "MEDIUM",
      description:
        "Users granted Homewood facility access whose app_role is 'family' but with zero active rows in `family_resident_links`.",
      count: 0,
      sampleIds: [],
      error: safeMessage(lerr2),
    });
  }
  const linkedUserIds = new Set((links ?? []).map((row) => row.user_id));
  const unlinked = familyUserIds.filter((id) => !linkedUserIds.has(id));
  return finding({
    key: "family_no_resident_link",
    title: "Family accounts at Homewood with no resident link",
    severity: "MEDIUM",
    description:
      "Users with Homewood facility access whose `app_role` is 'family' but who have zero active rows in `family_resident_links` — they can sign in but will see an empty portal.",
    count: unlinked.length,
    sampleIds: unlinked.slice(0, SAMPLE_LIMIT),
  });
}

async function checkFamilyLinkedToDischargedResident(supa, facilityId) {
  // family_resident_links rows where the resident is discharged or deceased.
  const { data: links, error: lerr } = await supa
    .from("family_resident_links")
    .select("id, user_id, resident_id")
    .is("revoked_at", null);
  if (lerr) {
    return finding({
      key: "family_linked_to_inactive_resident",
      title: "Family links pointing at discharged or deceased residents",
      severity: "HIGH",
      description:
        "Active `family_resident_links` rows whose resident has status='discharged' or 'deceased' — access should have been revoked.",
      count: 0,
      sampleIds: [],
      error: safeMessage(lerr),
    });
  }
  const residentIds = [...new Set((links ?? []).map((row) => row.resident_id))];
  if (residentIds.length === 0) {
    return finding({
      key: "family_linked_to_inactive_resident",
      title: "Family links pointing at discharged or deceased residents",
      severity: "HIGH",
      description:
        "Active `family_resident_links` rows whose resident has status='discharged' or 'deceased' — access should have been revoked.",
      count: 0,
      sampleIds: [],
    });
  }
  const { data: residents, error: rerr } = await supa
    .from("residents")
    .select("id, status")
    .eq("facility_id", facilityId)
    .in("id", residentIds);
  if (rerr) {
    return finding({
      key: "family_linked_to_inactive_resident",
      title: "Family links pointing at discharged or deceased residents",
      severity: "HIGH",
      description:
        "Active `family_resident_links` rows whose resident has status='discharged' or 'deceased' — access should have been revoked.",
      count: 0,
      sampleIds: [],
      error: safeMessage(rerr),
    });
  }
  const inactiveSet = new Set(
    (residents ?? []).filter((r) => r.status === "discharged" || r.status === "deceased").map((r) => r.id),
  );
  const offending = (links ?? []).filter((l) => inactiveSet.has(l.resident_id));
  return finding({
    key: "family_linked_to_inactive_resident",
    title: "Family links pointing at discharged or deceased residents",
    severity: "HIGH",
    description:
      "Active `family_resident_links` rows (revoked_at IS NULL) whose `resident.status` is 'discharged' or 'deceased' — access should have been revoked at discharge.",
    count: offending.length,
    sampleIds: offending.slice(0, SAMPLE_LIMIT).map((l) => l.id),
  });
}

async function checkMedicationsMissingDosageOrFrequency(supa, facilityId) {
  // `frequency` is a NOT NULL enum at the table level, so we can't have NULL there.
  // We can still flag rows where `strength` (dosage) is missing OR frequency_detail is needed.
  const { data, count, error } = await supa
    .from("resident_medications")
    .select("id, medication_name, strength, frequency_detail", { count: "exact" })
    .eq("facility_id", facilityId)
    .eq("status", "active")
    .is("deleted_at", null)
    .or("strength.is.null,strength.eq.")
    .limit(SAMPLE_LIMIT);
  if (error) {
    return finding({
      key: "meds_missing_dosage",
      title: "Active medications missing dosage (strength)",
      severity: "CRITICAL",
      description:
        "Active `resident_medications` rows where `strength` is NULL or empty — med pass cannot confirm dose without it.",
      count: 0,
      sampleIds: [],
      error: safeMessage(error),
    });
  }
  return finding({
    key: "meds_missing_dosage",
    title: "Active medications missing dosage (strength)",
    severity: "CRITICAL",
    description:
      "Active `resident_medications` rows where `strength` is NULL or empty — med pass cannot confirm dose without it. (Frequency is enforced NOT NULL at the schema level, so it can't be missing here.)",
    count: count ?? data?.length ?? 0,
    sampleIds: (data ?? []).map((r) => r.id),
  });
}

async function checkCarePlansMissingOrStaleReview(supa, facilityId) {
  const stale = dateAgoIso(STALE_REVIEW_DAYS);
  // care_plans.review_due_date is NOT NULL per schema, so we focus on stale reviews.
  const { data, count, error } = await supa
    .from("care_plans")
    .select("id, review_due_date, resident_id", { count: "exact" })
    .eq("facility_id", facilityId)
    .eq("status", "active")
    .is("deleted_at", null)
    .lt("review_due_date", stale)
    .limit(SAMPLE_LIMIT);
  if (error) {
    return finding({
      key: "care_plans_stale_review",
      title: `Active care plans with review_due_date more than ${STALE_REVIEW_DAYS} days stale`,
      severity: "MEDIUM",
      description:
        `Active care plans whose \`review_due_date\` is more than ${STALE_REVIEW_DAYS} days in the past — overdue for review.`,
      count: 0,
      sampleIds: [],
      error: safeMessage(error),
    });
  }
  return finding({
    key: "care_plans_stale_review",
    title: `Active care plans with review_due_date more than ${STALE_REVIEW_DAYS} days stale`,
    severity: "MEDIUM",
    description:
      `Active care plans whose \`review_due_date\` is more than ${STALE_REVIEW_DAYS} days in the past — overdue for review. (\`review_due_date\` is NOT NULL at the schema level, so it cannot be missing.)`,
    count: count ?? data?.length ?? 0,
    sampleIds: (data ?? []).map((r) => r.id),
  });
}

async function checkIncidentsUnresolved(supa, facilityId) {
  const cutoff = daysAgoIso(STALE_INCIDENT_DAYS);
  const { data, count, error } = await supa
    .from("incidents")
    .select("id, incident_number, status, created_at", { count: "exact" })
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .in("status", ["open", "investigating"])
    .lt("created_at", cutoff)
    .limit(SAMPLE_LIMIT);
  if (error) {
    return finding({
      key: "incidents_unresolved_30d",
      title: `Incidents open / investigating for more than ${STALE_INCIDENT_DAYS} days`,
      severity: "MEDIUM",
      description:
        `Incidents with \`status\` in ('open','investigating') whose \`created_at\` is more than ${STALE_INCIDENT_DAYS} days ago.`,
      count: 0,
      sampleIds: [],
      error: safeMessage(error),
    });
  }
  return finding({
    key: "incidents_unresolved_30d",
    title: `Incidents open / investigating for more than ${STALE_INCIDENT_DAYS} days`,
    severity: "MEDIUM",
    description:
      `Incidents with \`status\` in ('open','investigating') whose \`created_at\` is more than ${STALE_INCIDENT_DAYS} days ago — these should have moved to 'resolved' or 'closed'.`,
    count: count ?? data?.length ?? 0,
    sampleIds: (data ?? []).map((r) => `${r.id} (${r.incident_number ?? "no-num"})`),
  });
}

async function checkOrphanedResidentBedFKs(supa, facilityId) {
  // residents.bed_id pointing at a bed that doesn't exist (or belongs to another facility).
  const { data: residents, error: rerr } = await supa
    .from("residents")
    .select("id, bed_id")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .not("bed_id", "is", null);
  if (rerr) {
    return finding({
      key: "orphan_resident_bed_fk",
      title: "Residents whose bed_id does not match any bed at Homewood",
      severity: "CRITICAL",
      description:
        "Residents with a non-NULL `bed_id` that does not resolve to a row in `beds` filtered by Homewood `facility_id`.",
      count: 0,
      sampleIds: [],
      error: safeMessage(rerr),
    });
  }
  const bedIds = [...new Set((residents ?? []).map((r) => r.bed_id))];
  if (bedIds.length === 0) {
    return finding({
      key: "orphan_resident_bed_fk",
      title: "Residents whose bed_id does not match any bed at Homewood",
      severity: "CRITICAL",
      description:
        "Residents with a non-NULL `bed_id` that does not resolve to a row in `beds` filtered by Homewood `facility_id`.",
      count: 0,
      sampleIds: [],
    });
  }
  const { data: beds, error: berr } = await supa
    .from("beds")
    .select("id")
    .eq("facility_id", facilityId)
    .in("id", bedIds);
  if (berr) {
    return finding({
      key: "orphan_resident_bed_fk",
      title: "Residents whose bed_id does not match any bed at Homewood",
      severity: "CRITICAL",
      description:
        "Residents with a non-NULL `bed_id` that does not resolve to a row in `beds` filtered by Homewood `facility_id`.",
      count: 0,
      sampleIds: [],
      error: safeMessage(berr),
    });
  }
  const realBedIds = new Set((beds ?? []).map((b) => b.id));
  const orphans = (residents ?? []).filter((r) => !realBedIds.has(r.bed_id));
  return finding({
    key: "orphan_resident_bed_fk",
    title: "Residents whose bed_id does not match any bed at Homewood",
    severity: "CRITICAL",
    description:
      "Residents with a non-NULL `bed_id` that does not resolve to a row in `beds` filtered by Homewood `facility_id` — either the bed was deleted or the resident was admitted to the wrong facility.",
    count: orphans.length,
    sampleIds: orphans.slice(0, SAMPLE_LIMIT).map((r) => r.id),
  });
}

async function checkOrphanedFamilyResidentFKs(supa, facilityId) {
  const { data: links, error: lerr } = await supa
    .from("family_resident_links")
    .select("id, user_id, resident_id")
    .is("revoked_at", null);
  if (lerr) {
    return finding({
      key: "orphan_family_resident_fk",
      title: "Family links pointing at a resident_id that doesn't resolve at Homewood",
      severity: "CRITICAL",
      description:
        "Active `family_resident_links` whose `resident_id` does not exist in `residents` (any facility) — true orphan FK.",
      count: 0,
      sampleIds: [],
      error: safeMessage(lerr),
    });
  }
  const residentIds = [...new Set((links ?? []).map((l) => l.resident_id))];
  if (residentIds.length === 0) {
    return finding({
      key: "orphan_family_resident_fk",
      title: "Family links pointing at a resident_id that doesn't resolve at Homewood",
      severity: "CRITICAL",
      description:
        "Active `family_resident_links` whose `resident_id` does not exist in `residents` (any facility) — true orphan FK.",
      count: 0,
      sampleIds: [],
    });
  }
  const { data: residents, error: rerr } = await supa
    .from("residents")
    .select("id, facility_id")
    .in("id", residentIds);
  if (rerr) {
    return finding({
      key: "orphan_family_resident_fk",
      title: "Family links pointing at a resident_id that doesn't resolve at Homewood",
      severity: "CRITICAL",
      description:
        "Active `family_resident_links` whose `resident_id` does not exist in `residents` (any facility) — true orphan FK.",
      count: 0,
      sampleIds: [],
      error: safeMessage(rerr),
    });
  }
  const realIds = new Set((residents ?? []).map((r) => r.id));
  // Only score Homewood-relevant links: those pointing to residents that should be in Homewood or that don't exist at all.
  const orphans = (links ?? []).filter((l) => !realIds.has(l.resident_id));
  return finding({
    key: "orphan_family_resident_fk",
    title: "Family links pointing at a resident_id that doesn't exist anywhere",
    severity: "CRITICAL",
    description:
      "Active `family_resident_links` whose `resident_id` does not match any row in `residents` — true orphan FK.",
    count: orphans.length,
    sampleIds: orphans.slice(0, SAMPLE_LIMIT).map((l) => l.id),
  });
}

async function checkHomewoodResidentCohortPresent(supa, facilityId) {
  // Existential check: does Homewood have any active residents at all? If the
  // resident cohort is empty, every other "resident-scoped" check trivially
  // reports zero anomalies — that's a false-negative trap. Surface it loudly.
  const { count: activeCount, error: aerr } = await supa
    .from("residents")
    .select("id", { count: "exact", head: true })
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .eq("status", "active");
  const { count: anyCount, error: cerr } = await supa
    .from("residents")
    .select("id", { count: "exact", head: true })
    .eq("facility_id", facilityId);
  if (aerr || cerr) {
    return finding({
      key: "homewood_resident_cohort",
      title: "Homewood resident cohort present",
      severity: "CRITICAL",
      description: "Sanity check that Homewood has any active residents — otherwise every resident-scoped check is a false negative.",
      count: 1,
      sampleIds: [],
      error: safeMessage(aerr || cerr),
    });
  }
  if ((activeCount ?? 0) > 0) {
    return finding({
      key: "homewood_resident_cohort",
      title: "Homewood resident cohort present",
      severity: "CRITICAL",
      description: `Sanity check that Homewood has at least one active resident. Found ${activeCount} active, ${anyCount} total (any status).`,
      count: 0,
      sampleIds: [],
    });
  }
  return finding({
    key: "homewood_resident_cohort",
    title: "Homewood resident cohort present",
    severity: "CRITICAL",
    description:
      `**Homewood has zero active residents** (${anyCount ?? 0} total rows across all statuses including discharged/deceased). The audit cannot validate clinical readiness for launch without resident data. Either the import never completed, or it landed under a different \`facility_id\`. Every other resident-scoped check below will return 0 anomalies trivially.`,
    count: 1,
    sampleIds: [`facility_id=${facilityId}, active=${activeCount ?? 0}, total=${anyCount ?? 0}`],
  });
}

async function checkHomewoodFacilityExists(supa, facilityId) {
  const { data, error } = await supa
    .from("facilities")
    .select("id, name")
    .eq("id", facilityId)
    .single();
  if (error) {
    return finding({
      key: "facility_present",
      title: "Homewood facility row present and named correctly",
      severity: "CRITICAL",
      description: "The audit cannot run if the Homewood facility row is missing or unreachable.",
      count: 1,
      sampleIds: [],
      error: safeMessage(error),
    });
  }
  const ok = data?.name === "Homewood Lodge ALF";
  return finding({
    key: "facility_present",
    title: "Homewood facility row present and named correctly",
    severity: "CRITICAL",
    description: "Sanity check that `facilities[id=HOMEWOOD_FACILITY_ID].name === 'Homewood Lodge ALF'`.",
    count: ok ? 0 : 1,
    sampleIds: ok ? [] : [`${data?.id} name='${data?.name}'`],
  });
}

const CHECKS = [
  ["facility_present", checkHomewoodFacilityExists],
  ["homewood_resident_cohort", checkHomewoodResidentCohortPresent],
  ["residents_no_room", checkResidentsWithoutRooms],
  ["residents_no_active_care_plan", checkResidentsWithoutActiveCarePlan],
  ["residents_no_primary_diagnosis", checkResidentsWithoutPrimaryDiagnosis],
  ["residents_no_medications", checkResidentsWithoutMedications],
  ["residents_no_family_links", checkResidentsWithoutFamilyLinks],
  ["residents_admission_date_sanity", checkResidentAdmissionDateSanity],
  ["staff_no_user_account", checkStaffWithoutUserAccount],
  ["staff_missing_certifications", checkStaffMissingCertifications],
  ["staff_no_facility_access", checkStaffWithoutFacilityAccess],
  ["family_no_resident_link", checkFamilyAccountsWithoutLinks],
  ["family_linked_to_inactive_resident", checkFamilyLinkedToDischargedResident],
  ["meds_missing_dosage", checkMedicationsMissingDosageOrFrequency],
  ["care_plans_stale_review", checkCarePlansMissingOrStaleReview],
  ["incidents_unresolved_30d", checkIncidentsUnresolved],
  ["orphan_resident_bed_fk", checkOrphanedResidentBedFKs],
  ["orphan_family_resident_fk", checkOrphanedFamilyResidentFKs],
];

function severityRank(sev) {
  return { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }[sev] ?? 99;
}

function renderReport({ findings, generatedAt, supabaseHost, facilityId, organizationId }) {
  const sorted = [...findings].sort((a, b) => {
    const r = severityRank(a.severity) - severityRank(b.severity);
    if (r !== 0) return r;
    return a.title.localeCompare(b.title);
  });
  const totals = sorted.reduce(
    (acc, f) => {
      acc[f.severity] = (acc[f.severity] ?? 0) + (f.count > 0 ? 1 : 0);
      acc.totalCount += f.count;
      return acc;
    },
    { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, totalCount: 0 },
  );

  const lines = [];
  lines.push(`# Homewood Lodge ALF — Data Audit`);
  lines.push("");
  lines.push(`_Generated: \`${generatedAt}\` against \`${supabaseHost}\` (facility \`${facilityId}\`, org \`${organizationId}\`)._`);
  lines.push("");
  lines.push(`This report is auto-generated by \`npm run homewood:audit\`. Re-run between fixes to track progress toward go-live.`);
  lines.push("");
  lines.push(`## Severity summary`);
  lines.push("");
  lines.push("| Severity | Categories with rows | Total rows flagged |");
  lines.push("|---|---:|---:|");
  for (const sev of ["CRITICAL", "HIGH", "MEDIUM", "LOW"]) {
    const catCount = sorted.filter((f) => f.severity === sev && f.count > 0).length;
    const rowCount = sorted.filter((f) => f.severity === sev).reduce((a, f) => a + f.count, 0);
    lines.push(`| ${sev} | ${catCount} | ${rowCount} |`);
  }
  lines.push("");
  lines.push(`## All anomalies`);
  lines.push("");
  lines.push("| Anomaly | Severity | Count | Sample IDs | Status |");
  lines.push("|---|---|---:|---|---|");
  for (const f of sorted) {
    const status = f.error ? `⚠️ check failed: ${f.error.replace(/\|/g, "\\|")}` : f.count === 0 ? "OK" : "FLAGGED";
    const samples = (f.sampleIds ?? []).length === 0 ? "—" : f.sampleIds.map((s) => `\`${s}\``).join(", ");
    lines.push(`| ${f.title.replace(/\|/g, "\\|")} | ${f.severity} | ${f.count} | ${samples} | ${status} |`);
  }
  lines.push("");
  lines.push(`## Per-anomaly detail`);
  for (const f of sorted) {
    lines.push("");
    lines.push(`### ${f.title}`);
    lines.push("");
    lines.push(`- **Severity:** ${f.severity}`);
    lines.push(`- **Count:** ${f.count}`);
    lines.push(`- **Check key:** \`${f.key}\``);
    if (f.error) {
      lines.push(`- **Check error:** \`${f.error}\` — the report shows count=0 because the check could not execute. Investigate before treating as clean.`);
    }
    lines.push("");
    lines.push(f.description);
    if (f.sampleIds && f.sampleIds.length > 0) {
      lines.push("");
      lines.push(`Sample IDs (up to ${SAMPLE_LIMIT}):`);
      lines.push("");
      for (const id of f.sampleIds) lines.push(`- \`${id}\``);
    }
  }
  lines.push("");
  lines.push(`---`);
  lines.push("");
  lines.push(`_Severity scale: **CRITICAL** = launch-blocker (must fix before T-0); **HIGH** = fix before launch; **MEDIUM** = fix in the first two weeks post-launch; **LOW** = track only._`);
  lines.push("");
  return { markdown: lines.join("\n"), totals };
}

async function main() {
  loadEnvFile(path.join(ROOT, ".env.local"));
  const url = requireEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const organizationId = process.env.COL_ORGANIZATION_ID?.trim() || DEFAULT_ORGANIZATION_ID;
  const facilityId = process.env.HOMEWOOD_FACILITY_ID?.trim() || DEFAULT_HOMEWOOD_FACILITY_ID;
  const supabaseHost = new URL(url).host;

  const supa = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`[homewood:audit] running ${CHECKS.length} checks against ${supabaseHost} (facility ${facilityId})`);
  const findings = [];
  for (const [key, fn] of CHECKS) {
    process.stdout.write(`  • ${key.padEnd(40)}`);
    try {
      const result = await fn(supa, facilityId);
      findings.push(result);
      if (result.error) {
        process.stdout.write(` ERROR: ${result.error}\n`);
      } else {
        process.stdout.write(` count=${result.count}\n`);
      }
    } catch (err) {
      const errMsg = safeMessage(err);
      findings.push(
        finding({
          key,
          title: key,
          severity: "HIGH",
          description: "Check threw an unexpected error.",
          count: 0,
          sampleIds: [],
          error: errMsg,
        }),
      );
      process.stdout.write(` THREW: ${errMsg}\n`);
    }
  }

  const generatedAt = new Date().toISOString();
  const { markdown, totals } = renderReport({
    findings,
    generatedAt,
    supabaseHost,
    facilityId,
    organizationId,
  });

  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${markdown}\n`);

  console.log("");
  console.log(`[homewood:audit] report written: ${path.relative(ROOT, REPORT_PATH)}`);
  console.log(
    `[homewood:audit] categories with rows: CRITICAL=${totals.CRITICAL} HIGH=${totals.HIGH} MEDIUM=${totals.MEDIUM} LOW=${totals.LOW}`,
  );
  console.log(`[homewood:audit] total rows flagged: ${totals.totalCount}`);
}

main().catch((err) => {
  console.error("[homewood:audit] FATAL:", safeMessage(err));
  process.exit(1);
});
