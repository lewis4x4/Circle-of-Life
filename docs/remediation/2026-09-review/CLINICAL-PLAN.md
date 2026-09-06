# Clinical cleanup plan

Apply ai-slop-cleaner regression-first workflow and Supabase RLS-first guidance. Preserve operator drafts, resident UUID identity, clinical attribution and existing audited records. No hosted writes.

1. Lock eMAR overdue/PRN queue semantics and data-boundary regressions. Remove simulated medication completion and connect the cockpit to real persisted administration. Share incident taxonomy and explicit input validation.
2. Correct ADL acknowledgement/draft preservation; replace browser note merging with an atomic append; record immutable timestamped vital observations with independent alert evaluation status. Preserve current daily summary for existing alert checks.
3. Repair truthful readiness, survey, assessment and infection outcomes. Provide authorized next actions and retain partial-save identities.
4. Repair operations signatures, action errors, scheduling and atomic publication/completion; keep assignment basis explicit.
5. Run targeted tests, typecheck, lint and local migration checks. Record each review ID in clinical.json including remaining integration or feature gaps. Parent integrates all lane gates.

Owned scope: caregiver tasks/meds/resident logging/incidents/handoff/facility context; med-tech components and shift hook; clinical medication/order/care-plan/discharge/infection/admission/assessment/compliance/operations workflows and corresponding tests/migrations. Parent owns V2 routing, offline rounding C14 and general navigation/reporting. Access lane owns auth and co-sign APIs. No edits to unrelated marketing work.
