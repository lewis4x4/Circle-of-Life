# Facility operations current authority — COL-133

This extends the [catalog contract](27-facility-operations-catalog.md) under BUILD-SCOPE sections 4, 5 and 7. Current permissions are evaluated independently of historical identity. This is source implementation; it does not activate a facility, grant a person access, approve a requirement, or establish hosted/operating acceptance.

## Current scope

`user_facility_access` is the explicit site grant for every operations actor, including corporate roles. `operation_expires_at` limits operations coverage without changing unrelated domain access. Revocation, expiry, inactive/deleted identity and deleted facilities fail closed. No corporate site grants are synthesized.

`operation_subject_access` adds explicit resident, personnel, medical and financial permission with reason, grantor, expiry and revocation. These grants never create site permission. Native subject scope and native role restrictions remain necessary. Medical access intersects the existing employee medical grant. Specialized recording also needs `can_record`, which defaults false; read permission is not recording permission. Published recorder rules in COL-135 must further constrain, rather than replace, this authority.

A task has immutable `subject_id` and `authority_class`. Native resident/staff/asset records are reread to enforce current organization/site, deletion, employee termination and asset retirement. A historical registry entry never grants access after a transfer. Historical references and completed evidence are retained. Transferred or terminated subject history is withheld until an approved historical-record scope exists.

## Reads and commands

Session clients enforce RLS before identifiers, names, lists, counts and export are returned. Restrictive policies also protect native asset rows, linked meeting items/cards, escalation deliveries, operations audit records, relevant generic audit payloads and saved aggregate versions. Removing a protected source link cannot turn copied text into an unrestricted card or meeting item.

Public authenticated RPCs are invoker wrappers over private, fixed-search-path implementations. Task identity/role is derived from the current session; supplied actor fields must match. Commands lock the task, native subject, site, grants, profile and Auth/session rows, then recheck current authority. They check again after DML and audit so a later meeting/audit wait or elapsed coverage cannot commit stale authority. Replay also requires current access. Completion retains dual-signature independence; defer retains its payload-aware retry and rollback checks. Start/reinstate use atomic commands and audit; reinstate preserves earlier missed facts.

Template publication is limited to explicitly classified facility activities and current scoped author authority. Arbitrary document/asset/vendor links cannot bypass native scope. The catalog's unresolved policy questions and draft classifications remain unapproved.

Audit CSV export reads session-visible identifiers through complete keyset pages at a fixed cutoff. It checks counts, every returned identifier, current actor/site and final job authority before emitting bytes. Failure yields no partial CSV. Protected row counts, checksums and storage links are not retained on jobs. Existing jobs carrying such metadata are withheld.

## Explicitly unavailable surfaces

- Unclassified legacy tasks and tasks with arbitrary legacy evidence paths remain stored but are excluded from current reads. Constant API coverage metadata identifies the classified/current scope without revealing a hidden population count.
- No generic evidence upload/download capability is introduced. Raw completion evidence paths are rejected. COL-143 must supply immutable classification, scoped transport and finalization.
- Bulk completion, unclassified meeting-task creation, manual escalation and vendor booking edits lack the needed scoped commands and return unavailable/conflict responses. Template publication rejects unclassified activity.
- The legacy escalation scanner and risk notification transport return a conflict before data delivery. COL-152 must supply current recipient authority and delivery semantics.
- The session staffing assessment cannot certify complete demand from an RLS-filtered subset and returns explicit unverified coverage. Service staffing/risk computation rejects incomplete or unclassified input coverage; existing unversioned snapshots remain hidden. Versioned aggregate reads also require explicit site and native role access.

These are material integration changes. Do not apply migration 337 alone to a live operating site without reconciling existing task classifications, required scoped commands and dependent consumers. A zero-row classified list is not proof of no outstanding legacy work.

## Migration, verification and rollback

Migration `337_hfo_current_authority.sql` follows this branch's unapplied catalog migration 336. Other active branches reuse these numbers. Reconcile against current main and hosted ledger before integration; never rewrite installed history or create gap migrations. Deploy session APIs only after their schema/RPCs are installed, as one coordinated release.

Verification and exact limitations are recorded in `docs/facility-operations/col133-evidence/` and the COL-133 handoff. Local PostgreSQL uses Supabase service stubs and synthetic fixtures; it does not establish positive hosted Auth/Storage transport or staff acceptance.

Before deployment, rollback is reverting this source segment. After application, do not drop classification/grant/audit data or restore broad policies to reopen access. Roll back the application with affected operations disabled, retain additive schema/history and use a reviewed forward repair. No hosted rollback was performed.

Mission alignment: PASS. Operating readiness: RISK pending technical release and named facility acceptance.
