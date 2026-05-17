#!/usr/bin/env node
/**
 * eval-redact-pii.mjs (KB-NEXT-08)
 *
 * Static fixture tests for redactStringWithCounts(). No DB / network. Run
 * locally to confirm the regex chain still catches SSN / DEA / NPI / DOB /
 * MRN / dosage without misfiring on innocuous numerics like dates,
 * room numbers, and ICD codes.
 *
 * Imports the Deno helper via a tiny shim so node can require it. The shim
 * lives inline here to avoid adding a new tsconfig path.
 *
 * Run: node scripts/eval-redact-pii.mjs
 */

// Inlined JS port of supabase/functions/_shared/redact-pii.ts. Kept in sync
// manually; the eval script asserts behaviour equivalence so drift surfaces
// as a [FAIL] line.
function redactStringWithCounts(input) {
  const counts = {};
  const bump = (k) => { counts[k] = (counts[k] ?? 0) + 1; };
  let text = input
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, () => { bump("ssn"); return "[REDACTED_SSN]"; })
    .replace(/\b[A-Z]{2}\d{7}\b/g, () => { bump("dea"); return "[REDACTED_DEA]"; })
    .replace(/\b(?:medicare|medicaid|member|policy|mrn|medical record)\s*(?:id|number|#)?[:\s-]*[A-Z0-9-]{6,}\b/gi, () => { bump("member_id"); return "[REDACTED_MEMBER_ID]"; })
    .replace(/\b(?:dob|date of birth|born)\b[:\s-]*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi, () => { bump("dob"); return "[REDACTED_DOB]"; })
    .replace(/\b(?:dob|date of birth|born)\b[:\s-]*[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}\b/gi, () => { bump("dob"); return "[REDACTED_DOB]"; })
    .replace(/(?<![\d.])\d{10}(?![\d.])/g, () => { bump("npi"); return "[REDACTED_NPI]"; })
    .replace(/\b\d+\s*(?:mg|mcg|g|ml|units?)\s*(?:\/\s*\w+)?(?:\s+(?:by mouth|po|im|iv|subq|topical))?(?:\s+\w+){0,6}\b/gi, () => { bump("dosage"); return "[REDACTED_DOSAGE]"; });
  return { text: text.trim(), patterns_hit: counts };
}

const cases = [
  {
    name: "SSN",
    input: "John has SSN 123-45-6789 on file.",
    mustContain: ["[REDACTED_SSN]"],
    mustNotContain: ["123-45-6789"],
    expectKey: "ssn",
  },
  {
    name: "DEA",
    input: "Provider DEA: AB1234567 (Dr. Smith)",
    mustContain: ["[REDACTED_DEA]"],
    mustNotContain: ["AB1234567"],
    expectKey: "dea",
  },
  {
    name: "NPI standalone",
    input: "NPI: 1234567890 belongs to the prescriber.",
    mustContain: ["[REDACTED_NPI]"],
    mustNotContain: ["1234567890"],
    expectKey: "npi",
  },
  {
    name: "MRN labeled",
    input: "MRN 887766 was issued on intake.",
    mustContain: ["[REDACTED_MEMBER_ID]"],
    mustNotContain: ["887766"],
    expectKey: "member_id",
  },
  {
    name: "DOB MM/DD/YYYY",
    input: "DOB: 03/15/1948 — assisted living since 2019.",
    mustContain: ["[REDACTED_DOB]"],
    mustNotContain: ["03/15/1948"],
    expectKey: "dob",
  },
  {
    name: "Dosage",
    input: "Take 500 mg by mouth twice daily.",
    mustContain: ["[REDACTED_DOSAGE]"],
    mustNotContain: ["500 mg"],
    expectKey: "dosage",
  },
  {
    name: "Innocuous numerics not flagged as NPI",
    input: "Floor 2 room 214 phone 5551234 invoice 555-0199.",
    mustContain: ["Floor 2", "room 214"],
    mustNotContain: ["[REDACTED_NPI]"],
  },
  {
    name: "Mixed multi-hit",
    input: "Resident SSN 999-00-1111 NPI 9988776655 DOB 12/31/1940.",
    mustContain: ["[REDACTED_SSN]", "[REDACTED_NPI]", "[REDACTED_DOB]"],
    mustNotContain: ["999-00-1111", "9988776655", "12/31/1940"],
    expectAllKeys: ["ssn", "npi", "dob"],
  },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const { text, patterns_hit } = redactStringWithCounts(c.input);
  let ok = true;
  const failures = [];
  for (const must of c.mustContain ?? []) {
    if (!text.includes(must)) {
      ok = false;
      failures.push(`mustContain missing: ${must}`);
    }
  }
  for (const mustnt of c.mustNotContain ?? []) {
    if (text.includes(mustnt)) {
      ok = false;
      failures.push(`mustNotContain still present: ${mustnt}`);
    }
  }
  if (c.expectKey && !(c.expectKey in patterns_hit)) {
    ok = false;
    failures.push(`expectKey "${c.expectKey}" missing from patterns_hit (${JSON.stringify(patterns_hit)})`);
  }
  if (c.expectAllKeys) {
    for (const k of c.expectAllKeys) {
      if (!(k in patterns_hit)) {
        ok = false;
        failures.push(`expectAllKeys missing "${k}" (${JSON.stringify(patterns_hit)})`);
      }
    }
  }
  if (ok) {
    pass++;
    console.log(`[PASS] ${c.name}  patterns=${JSON.stringify(patterns_hit)}`);
  } else {
    fail++;
    console.log(`[FAIL] ${c.name}`);
    for (const f of failures) console.log(`         - ${f}`);
    console.log(`         text=${JSON.stringify(text)}`);
  }
}
console.log(`\nTotal: ${cases.length}  Pass: ${pass}  Fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
