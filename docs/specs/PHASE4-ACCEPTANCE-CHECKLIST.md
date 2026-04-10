# Phase 4 acceptance checklist

**Authority:** [README.md](./README.md) Phase 4 — **01** Referral & Inquiry (`075`–`076`), **02** Admissions (`077`–`078`), **05** Discharge (`079`–`080`).

**Pilot:** Oakridge ALF; HL7 / integration rows may use `integration_inbound_queue` / `063` paths per specs.

---

## Mission alignment

| Verdict | Record when |
|---------|----------------|
| **pass** | Core referral → admission → discharge paths traceable under RLS |
| **risk** | Enhanced-only gaps (e.g. full HL7 listener) documented as deferred |
| **fail** | PII exposed across facilities or move-in/discharge workflows unusable |

---

## Row map

| # | Area | Pass? | Primary routes / proof |
|---|------|-------|-------------------------|
| 1 | **Referrals** — pipeline, sources, lead detail | | `/admin/referrals`, `/admin/referrals/hl7-inbound` (queue), lead detail |
| 2 | **HL7 inbound** — queue rows processed or manual draft | | Queue CSV, **Copy raw**, status filter, `process-referral-hl7-inbound` Edge (ops deployed) |
| 3 | **Admissions** — cases list, new case, detail | | `/admin/admissions/*` as in FRONTEND-CONTRACT |
| 4 | **Admissions** — rate terms / bed linkage | | If seeded: `admission_case_rate_terms`; else N/A |
| 5 | **Discharge** — hub, detail, new discharge | | `/admin/discharge/*` |
| 6 | **Discharge** — med reconciliation | | `discharge_med_reconciliation` fields saved |
| 7 | **Cross-surface** | | Referral lead can link to admission case when spec path exists |
| 8 | **Meta** | | Owner sign-off |

---

## Deferred / Enhanced

- **Full HL7 listener** automation (vs manual queue ingest) — Module 22 Enhanced.
- **FHIR export** on discharge — Enhanced per `05-discharge-transition.md`.

---

## Sign-off

| Field | Value |
|-------|--------|
| **Result** | PENDING |
| **Date** | |
| **Tester** | |
