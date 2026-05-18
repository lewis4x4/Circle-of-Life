# P0 — Facility audit log appears empty (data infrastructure)

**Status:** Root cause identified in repo (2026-05-18). **Migration `252_facility_audit_log_trigger_null_actor.sql`** implements the primary fix. Follow-up work remains for attribution, parity with `audit_log`, and UX.

## Observed symptom

Facility Detail · **Audit log** shows **zero events** while the same facility has visible changes (rates, documents, vendors, emergency contacts, thresholds, communication, building profile).

## Questions (survey / compliance)

| Question | Finding |
|---------|---------|
| Are audit events being written when data is modified? | **They were discarded** when `facility_audit_log` INSERT failed inside `haven.facility_audit_trigger`'s exception handler. |
| Right table / scope? | The UI reads **`facility_audit_log`** (`GET /api/admin/facilities/[id]/audit-log`). Some tables (`facility_vendors`) previously wrote only to global **`audit_log`** via `haven_capture_audit_log` — **dual-path split**. Migration 252 adds `facility_audit_log` duplication for vendors. Long-term: UNION view or single spine. |
| View querying correct scope? | **Yes** — `eq('facility_id', facilityId)`. No date filter unless UI passes range. |
| Where was the audit hook failing? | `changed_by uuid NOT NULL REFERENCES auth.users`. Trigger used `COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)`. **Anonymous service-role writes** (`requireAdminApiActor` → `createServiceRoleClient()`) imply **`auth.uid()` is NULL**. Zero UUID → **FK violation** → trigger exception → **`RAISE WARNING` + rollback of audit INSERT only implicitly skipped** — parent row commits. |
| Retention purge? | **Not investigated** — no purge job referenced in facility audit routes. Separate task: define 7-year policy + archival. |

## Remediation shipped in repo

1. **`facility_audit_log.changed_by` nullable**; trigger uses **`auth.uid()` only** (no dummy UUID).
2. **Facility vendors** additionally fire `haven.facility_audit_trigger()` so edits appear beside other facility-scope tables.

## Follow-up work (outside this closure)

| Item | Priority |
|------|----------|
| **Human attribution:** pass acting user id into DB context for service-role writes (`set_claim`/`request.jwt` pattern or transactional RPC) `changed_by NOT NULL` with real FK | P1 |
| **Unified read model:** UNION `facility_audit_log` + `audit_log WHERE facility_id = …` + normalize row shape | P1 |
| **Action taxonomy:** VIEWED / EXPORTED / permission events not in INSERT/UPDATE/DELETE model | P2 |
| **Retention + cold storage** | Ops / P2 |

## Mission alignment

**Pass** once migration is applied in each environment — survey-defensible audit trail is foundational for regulatory readiness; silent failure eroded credibility.
