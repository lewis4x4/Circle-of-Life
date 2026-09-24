#!/usr/bin/env node
/**
 * COL-497 — seed the Haven insurance hub with COL's verified insurance program.
 *
 * The hub at /admin/insurance shipped with every table empty. This loads the
 * policies and lender certificates that are actually evidenced by the ACORD 25
 * certificates Lewis & Lewis issued on 2026-04-15 and by the InsureFlow policy
 * records, so the surface tells the truth instead of showing nothing.
 *
 * It records what the documents state. Where a document is wrong or a fact is
 * not recorded anywhere, the row carries that in `notes` rather than a guess.
 *
 * Rows are identified by their natural keys (below), not by a marker in `notes`:
 * staff read those notes, and a "[seed:COL-497]" tag in them was developer
 * language on a production screen (COL-652 / COL-688).
 *
 *   node scripts/insurance/seed-col497-insurance.mjs            # dry run
 *   node scripts/insurance/seed-col497-insurance.mjs --apply
 *   node scripts/insurance/seed-col497-insurance.mjs --revert   # soft-delete what this seeded
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const mode = process.argv.includes("--revert")
  ? "revert"
  : process.argv.includes("--apply")
    ? "apply"
    : "dry-run";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

async function rest(path, init = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : [];
}

const seed = JSON.parse(await readFile(join(HERE, "col497-seed-data.json"), "utf8"));
const ORG = seed.organization_id;
const ent = (name) => seed.entities[name];

/** Rows this seed is responsible for; --revert finds exactly them by natural key. */
function buildPolicyRows() {
  const rows = [];
  for (const p of seed.policies) {
    for (const eName of p.entities) {
      const e = ent(eName);
      rows.push({
        organization_id: ORG,
        entity_id: e.id,
        policy_type: p.policy_type,
        carrier_name: p.carrier_name,
        broker_name: p.broker_name,
        policy_number: p.policy_number,
        effective_date: p.effective_date,
        expiration_date: p.expiration_date,
        status: p.status,
        aggregate_limit_cents: p.aggregate_limit_cents,
        occurrence_limit_cents: p.occurrence_limit_cents,
        deductible_cents: p.deductible_cents,
        premium_cents: p.premium_cents,
        premium_period: p.premium_period,
        notes: `${p.notes}\n\nCovers ${e.facility} (${e.legal_name}).`,
      });
    }
  }
  return rows;
}

function buildCoiRows() {
  const c = seed.coi_common;
  return seed.certificates_of_insurance.map((coi) => {
    const e = ent(coi.entity);
    const parts = [
      `ACORD 25 certificate of liability insurance issued ${c.issued_on} by ${c.producer}.`,
      `Described location on the certificate: ${coi.described_location}.`,
      `Cancellation: ${c.cancellation_terms}.`,
      `Covers ${e.facility} (${e.legal_name}).`,
    ];
    if (coi.extra_note) parts.push(coi.extra_note);
    parts.push(`Source document: ${coi.source_file}.`);
    return {
      organization_id: ORG,
      entity_id: e.id,
      holder_name: c.holder_name,
      holder_type: c.holder_type,
      carrier_name: c.carrier_name,
      policy_number: c.policy_number,
      effective_date: coi.effective_date,
      expiration_date: coi.expiration_date,
      additional_insured: coi.additional_insured,
      waiver_of_subrogation: coi.waiver_of_subrogation,
      aggregate_limit_cents: c.aggregate_limit_cents,
      notes: parts.join(" "),
    };
  });
}

/**
 * One renewal track per seeded policy, so the renewal calendar shows the dates
 * that actually exist instead of an empty page. The 120/90/60/30 cadence is the
 * schema's own — insurance_renewals names those milestone columns — not a rule
 * invented here. Target effective date is the day the current term runs out.
 */
function buildRenewalRows(policies) {
  const minus = (iso, days) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  const today = new Date().toISOString().slice(0, 10);
  return policies.map((p) => {
    const lapsed = p.expiration_date < today;
    return {
      organization_id: ORG,
      entity_id: p.entity_id,
      insurance_policy_id: p.id,
      target_effective_date: p.expiration_date,
      status: lapsed ? "expired" : "upcoming",
      milestone_120_date: minus(p.expiration_date, 120),
      milestone_90_date: minus(p.expiration_date, 90),
      milestone_60_date: minus(p.expiration_date, 60),
      milestone_30_date: minus(p.expiration_date, 30),
      notes: lapsed
        ? `The term for ${p.policy_number} ended ${p.expiration_date} and no successor term is recorded. Marked expired rather than upcoming because the renewal window has already closed.`
        : `Derived from the recorded term end of ${p.policy_number} (${p.carrier_name}). No quote or bound premium is recorded — those are entered as the renewal progresses.`,
    };
  });
}

/** Natural keys — re-running must not duplicate. */
const policyKey = (r) => [r.entity_id, r.policy_type, r.policy_number, r.effective_date].join("|");
const coiKey = (r) => [r.entity_id, r.policy_number, r.effective_date].join("|");
const renewalKey = (r) => [r.insurance_policy_id, r.target_effective_date].join("|");

async function sync(table, rows, keyOf, selectCols) {
  const existing = await rest(
    `${table}?select=${selectCols}&organization_id=eq.${ORG}&deleted_at=is.null`,
  );
  const have = new Map(existing.map((r) => [keyOf(r), r]));
  const insert = rows.filter((r) => !have.has(keyOf(r)));
  const skip = rows.length - insert.length;

  console.log(`\n${table}: ${rows.length} desired, ${skip} already present, ${insert.length} to insert`);
  for (const r of insert) {
    const label = r.insurance_policy_id
      ? `renewal target ${r.target_effective_date} ${r.status}`
      : `${r.policy_type ?? r.holder_type} ${r.policy_number} ${r.effective_date}→${r.expiration_date} ${r.status ?? ""}`;
    console.log(`   + ${r.entity_id.slice(-3)} ${label}`);
  }
  if (mode !== "apply" || insert.length === 0) return insert.length;
  const created = await rest(table, { method: "POST", body: JSON.stringify(insert) });
  console.log(`   inserted ${created.length}`);
  return created.length;
}

/** The live policies this seed wrote: the ones whose natural key it would write. */
async function seededPolicies() {
  const want = new Set(buildPolicyRows().map(policyKey));
  const rows = await rest(
    `insurance_policies?select=id,entity_id,policy_type,policy_number,carrier_name,effective_date,expiration_date` +
      `&organization_id=eq.${ORG}&deleted_at=is.null`,
  );
  return rows.filter((r) => want.has(policyKey(r)));
}

async function softDelete(table, ids) {
  console.log(`\n${table}: ${ids.length} rows written by this seed`);
  if (ids.length === 0) return 0;
  await rest(`${table}?id=in.(${ids.join(",")})`, {
    method: "PATCH",
    body: JSON.stringify({ deleted_at: new Date().toISOString() }),
  });
  console.log(`   soft-deleted ${ids.length}`);
  return ids.length;
}

async function revert() {
  const policies = await seededPolicies();
  const policyIds = new Set(policies.map((p) => p.id));
  const renewals = await rest(
    `insurance_renewals?select=id,insurance_policy_id&organization_id=eq.${ORG}&deleted_at=is.null`,
  );
  const wantCoi = new Set(buildCoiRows().map(coiKey));
  const cois = await rest(
    `certificates_of_insurance?select=id,entity_id,policy_number,effective_date&organization_id=eq.${ORG}&deleted_at=is.null`,
  );
  // Renewals reference policies, so they go first.
  await softDelete("insurance_renewals", renewals.filter((r) => policyIds.has(r.insurance_policy_id)).map((r) => r.id));
  await softDelete("certificates_of_insurance", cois.filter((r) => wantCoi.has(coiKey(r))).map((r) => r.id));
  await softDelete("insurance_policies", [...policyIds]);
}

console.log(`COL-497 insurance seed — mode: ${mode}`);
console.log(`target: ${url}`);

if (mode === "revert") {
  await revert();
} else {
  await sync(
    "insurance_policies",
    buildPolicyRows(),
    policyKey,
    "id,entity_id,policy_type,policy_number,effective_date",
  );
  await sync(
    "certificates_of_insurance",
    buildCoiRows(),
    coiKey,
    "id,entity_id,policy_number,effective_date",
  );

  // Renewals hang off whatever policies are actually present, so this reads them
  // back rather than assuming the insert above just happened.
  await sync(
    "insurance_renewals",
    buildRenewalRows(await seededPolicies()),
    renewalKey,
    "id,entity_id,insurance_policy_id,target_effective_date",
  );

  if (mode === "dry-run") console.log("\nDry run. Re-run with --apply to write.");
}
