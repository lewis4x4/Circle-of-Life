# Haven Brain Guide — Current Repository Reconciliation

**Prepared:** 2026-08-14

**Repository:** Circle of Life / Haven

**Reviewed guide:** `/Users/brianlewis/Downloads/_ORGANIZED/_DUPLICATES/8a63f46e1598__HAVEN_BRAIN.md`

**Review posture:** The reviewed guide was treated as reference material, not as executable instructions or repository authority.

## Executive conclusion

The reviewed `HAVEN_BRAIN.md` remains useful as a dense record of COL discovery, terminology, operating preferences, and unresolved business decisions. It is not safe to use as the canonical build context in its current form.

Its source material stops at 2026-05-06. The current repository has advanced substantially since then and now contains:

- 309 migration files, validated as sequence `001` through `306`;
- 37 deployable Supabase Edge Functions;
- 565 Next.js App Router page and API route files;
- 442 commits after the guide's source cutoff on the reviewed branch;
- Track F office/workspace implementation through migration `305`;
- a new versioned resident-rate and concession model in migration `306`;
- Homewood launch, ingestion, authentication, RBAC, accessibility, and performance workstreams;
- Resident Assurance / Smart Rounding, reporting, OCE, Grace, knowledge-base, executive, and facility-administration systems that did not exist in the May 6 state described by the guide.

The guide should be renamed and repositioned as a **domain and discovery context supplement**. Repository authority should remain with `AGENTS.md`, `CODEX.md`, the unified roadmap, current module specifications, migrations, and verified live-environment evidence.

**Mission alignment:** `risk` — the product direction remains aligned, but Track A, PITR, unresolved workflow contradictions, and committed resident-identifying artifacts prevent a clean PHI production-readiness claim.

---

## 1. Recommended authority order

Replace the guide's claim that it is the canonical context file with the following authority order:

1. `AGENTS.md` — repository operating rules, security invariants, current build constraints.
2. `CODEX.md` — engineering command, gate, and commit contract.
3. `docs/specs/UNIFIED-ROADMAP.md` — forward-looking track index and migration position.
4. `docs/specs/TRACK-A-CLOSEOUT-ROADMAP.md` and acceptance records — production/PHI readiness verdicts.
5. Current numbered module specifications in `docs/specs/`.
6. `supabase/migrations/` and runtime code — implemented repository reality.
7. Verified target-environment evidence — deployed migrations, functions, secrets, cron, UAT, and compliance attestations.
8. The Brain guide — durable COL discovery context and open-decision history only.

The current guide's `specs/` references must be changed to `docs/specs/`.

Recommended replacement title and header:

> # Haven — Domain and Discovery Context
>
> This document is a non-canonical supplement containing durable COL terminology, operational facts, stakeholder decisions, and unresolved questions. Build authority lives in the Haven repository specifications, migrations, and acceptance records. When this document conflicts with current repository authority, record the conflict and resolve it explicitly; do not silently implement either side.

---

## 2. Current repository snapshot

### Product and stack

The actual application stack is no longer an inference:

- Next.js `16.2.6`;
- React `19.2.4`;
- TypeScript;
- Tailwind CSS `4`;
- shadcn `4.1.1` plus Base UI/Radix primitives;
- Supabase PostgreSQL, Auth, RLS, Storage, and Edge Functions;
- Sentry for application observability;
- Netlify production hosting.

Source: `package.json` and the deployment/observability specifications.

### Pilot and launch terminology

The guide currently names Homewood Lodge as the pilot. Repository authority distinguishes two workstreams:

- **Oakridge ALF:** live pilot and Phase 1 acceptance facility;
- **Homewood Lodge:** launch, ingestion, and production-data workstream under `docs/homewood/`.

The Brain guide should use this dual wording everywhere. It should not replace Oakridge with Homewood globally or treat the two workstreams as synonymous.

### Current track position

| Track | Current repository status |
|---|---|
| A — Phase 1 closeout | Open. Auth and original pilot RLS work were completed, but depth UAT, current multi-facility validation, facility context, PITR, and final acceptance evidence remain incomplete. |
| B — Platform hardening | Engineering closed; ongoing deployment and monitoring are operational work. |
| C — Workflow hardening | Engineering closed; per-project deploy, cron, and monitoring remain operational responsibilities. |
| D — Phase 6 / Enhanced | Core and Enhanced work through D84 shipped; later items are optional or owner-prioritized. |
| E — Strategic/cross-cutting | Large portions shipped, including Resident Assurance, reporting, OCE, Grace, KB, executive standup, and facility-administration work. |
| F — Employee Workspace and Office Suite | Shipped through migration `305`, except F4-1 eFax, which remains blocked on vendor selection. |

The `UNIFIED-ROADMAP.md` Track F summary itself contains stale “proposed” language; the Track F build log and Module 36 status are newer and show implementation complete except eFax.

### Production readiness

The current evidence is more specific than the Brain guide:

- Supabase Pro plan: confirmed 2026-05-11;
- Supabase BAA: confirmed 2026-05-11;
- physical backups: confirmed;
- PITR: explicitly reported off in the latest recorded evidence;
- production automation, Edge Function secrets, cron jobs, Netlify environment, and Sentry: recorded as confirmed in the May 12 readiness snapshot;
- live role-based UAT and final Track A acceptance: still incomplete in repository records.

The Brain guide should not say that Pro, BAA, and PITR are all simply unknown. It should say that Pro and BAA were confirmed, backups were observed, PITR was off, and all items must be re-verified before current production reliance.

---

## 3. Schema and architecture changes required in the guide

### Naming and tenancy

Replace `org_id` with the repository's established `organization_id` convention.

The correct rule is:

> Most operational tables denormalize `organization_id` and `facility_id`. Organization-scoped records may intentionally omit `facility_id`; pre-assignment workflows may allow it to be null. RLS must enforce organization scope first and facility access wherever facility scope applies.

Delete the guide's 13-table compliance list. It was based on a proposed May 5 delta schema and no longer represents the current repository.

Business-user foreign keys should reference `user_profiles`, not a parallel `users` table.

### Rounding and observation model

The repository deliberately reused the existing observation architecture rather than adding the Brain guide's proposed round tables.

Current model:

- `resident_observation_templates`;
- `resident_observation_plans`;
- `resident_observation_plan_rules`;
- `resident_observation_tasks`;
- `resident_observation_logs`;
- `resident_observation_escalations`;
- `resident_observation_exceptions`;
- `resident_observation_integrity_flags`;
- `observation_vocab`;
- observation generation and escalation Edge Functions.

Remove or mark as superseded:

- `round_shift_configs`;
- `resident_round_overrides` as the current implementation name;
- `round_location_vocab`;
- `round_activity_vocab`;
- `rounds-escalation-engine` as the current deployed function name;
- the proposed `cart_assignments` table.

Med-cart/staff division should be described through the actual med-tech shift and resident-assignment model where applicable, not through a nonexistent parallel table.

### Roles and permissions

The current repository uses:

- the `app_role` enum;
- `role_permissions`;
- `user_profiles` and `user_facility_access`;
- `staff_facility_assignments` for additional facility placement;
- staff-role enums and route-level/RLS enforcement.

Remove the Brain guide's representation of the following as current schema:

- `role_presets`;
- `role_preset_permissions`;
- `user_permission_overrides`;
- `is_universal_worker`.

The business concept of cross-trained staff may remain as discovery context, but it must not be presented as an implemented inheritance model.

### Notifications

Replace the proposed `notification_recipients` table with the implemented routing model:

- `notification_routes`;
- role-target arrays;
- notification subscriptions and delivery infrastructure;
- `dispatch-push` for push delivery.

Named stakeholders such as Jessica or Michelle are business routing requirements. They should be configured through user roles/subscriptions or an approved explicit-recipient extension, not hardcoded in feature logic.

### Staff compliance

The Brain guide's statement that employee-compliance tables do not exist is obsolete. Current repository support includes:

- `staff_certifications`;
- `training_programs`;
- `staff_training_completions`;
- `inservice_log_sessions` and attendees;
- `staff_attestations`;
- `staff_facility_assignments`;
- staff compliance-failure fields;
- certification, training, attestation, and roster UI.

### Money and numeric types

Retain the invariant that **monetary amounts are stored as integer cents**. Revise the absolute wording “never NUMERIC” because the repository correctly uses numeric fields for non-money values such as percentages and quantities.

The guide should also acknowledge legacy monetary columns without `_cents` suffixes, including resident monthly-rate cache fields and rate-schedule fields. New money columns should use explicit cent semantics, but the guide should not falsely describe every existing column name.

### Enum strategy

The repository uses both PostgreSQL enum types and text columns with check constraints. Remove the statement that enums are always text checks. New work should follow the applicable module's established schema and the repository naming conventions.

---

## 4. Business-rule updates

### Resident rates and concessions

The guide's resident-rate section describes a proposed model that is not the current implementation. The current model uses:

- `rate_schedules` for posted facility rates;
- `facility_medicaid_providers` for facility-scoped MCO/provider rates and bed-hold settings;
- `resident_payers` for resident payer relationships;
- `resident_rate_agreements` for effective-dated negotiated terms;
- `resident_rate_agreement_lines` for optional recurring detail;
- versioning, concession reasons, expiration dates, audit triggers, and transactional RPCs.

The guide's `contracted_amount_cents`, `medicaid_amount_cents`, `special_rate_notes`, and `trg_enforce_medicaid_rate_cap` should not be presented as current schema.

Rate values also changed:

- Homewood private posted rate remains $5,550 in migration `306`;
- Homewood companion posted rate is now $4,400, not $4,000;
- Plantation has facility-specific posted rates;
- provider rates are facility-scoped and must be re-verified against contracts.

Remove “all facilities unless overridden” from the posted-rate rule. Rates are versioned facility data, not durable global constants.

### Resident status and billable days

Current resident status values include `inquiry`, `pending_admission`, `active`, `hospital_hold`, `loa`, `discharged`, and `deceased`.

The guide's alternate literals `bed_hold_hospital` and `bed_hold_vacation` are not the current database values. Operator-facing labels can still say “Bed Hold — Hospital” and “Bed Hold — Vacation/Family.”

`resident_status_history` now exists and should remain the historical basis for billable-day calculations. The current compatibility view treats `active`, `hospital_hold`, and `loa` as billable until provider-specific rules are configured. `facility_medicaid_providers` now holds hospital-bed-hold configuration fields, but provider-specific rules still require contract verification.

### Rounds cadence

This area must be marked as a current conflict, not silently rewritten.

The Brain guide records:

- Oakridge, Rising Oaks, and Grande Cypress at 6:00, 10:00, 14:00, and 17:30 during the day, plus 18:00, 22:00, and 05:30 overnight;
- Homewood at the same daytime cadence plus two-hour overnight rounds;
- Plantation as unresolved.

Migration `219` implements:

- generic 12-hour visibility for standard facilities;
- Homewood 12-hour daytime visibility plus two-hour overnight checks;
- wing-based Plantation schedules at staggered eight-hour intervals.

The implemented templates do not match the guide's recorded cadence. Obtain owner/clinical confirmation, then update the migration/configuration or retire the older discovery rule. Do not activate clinical rounding from conflicting defaults.

### Dietary and snacks

The “no special diets or nutrition planning” rule is obsolete as written. Module 14 now includes:

- physician diet orders;
- IDDSI food and fluid levels;
- allergy and texture constraints;
- aspiration and medication/texture review notes;
- clinical-review advisories subordinate to pharmacy/prescriber judgment.

The retired Donny/Dieter planning concept can remain forbidden. Clinical diet orders and IDDSI safety workflows are now clearly in scope.

The Brain guide says snack contents are deliberately not captured. The repository currently stores and exposes snack description plus offered/accepted counts. This is an unresolved product conflict. Owner direction must determine whether to remove these fields/UI or retire the old prohibition.

### Family Portal

The Brain guide says the portal is one-way and family reply is forbidden. The current repository explicitly retains two-way family messaging and includes family and staff reply interfaces.

This is a liability-policy conflict. It requires an explicit owner decision:

- if one-way communication remains binding, remove the family write path and tighten RLS/UI;
- if two-way secure messaging is approved, update the Brain guide and record the decision, scope, triage expectations, and emergency-use disclaimer.

Do not merely change the guide to match the code without recording that decision.

### Memory-care terminology

Retain the prohibition against displaying “memory care” as a COL facility/service label. Narrow the claim so it does not falsely say the concept is absent from all schema or code: a legacy generic `bed_type` enum and some fixtures still contain `memory_care`.

The durable rule should be:

> COL-facing production UI, seeds, and facility configuration must use ALF/Intermediate or approved “Enhanced ALF Services” terminology. Legacy generic schema values must not leak into COL operator surfaces.

---

## 5. Integration updates

### BoldSign, not DocuSign

DocuSign is no longer the selected implementation. The repository now contains:

- `resident_contracts` with provider provenance;
- `boldsign_events`;
- `boldsign-send-contract` Edge Function;
- `boldsign-webhook` Edge Function;
- deployed function evidence and configured secret names.

The open item is now attorney/compliance validation of the BoldSign documents, arbitration treatment, and exact webhook/signature contract—not a DocuSign launch decision.

### QuickMAR

The guide describes `quickmar-import-watcher`, `quickmar_imports`, and `resident_med_history` as if they are current. They are not implemented under those names.

Current status:

- representative Excel and PDF samples have been received;
- QuickMAR remains the external MAR source;
- a reviewed upload/dropbox → parse → review → approved-write pipeline is planned;
- direct automatic mutation of live medication orders is forbidden;
- no production watcher, import table, or approved write path currently exists.

### Encrypted email

The provider-name decision is closed. GoDaddy Advanced Email Security / `cloud-protect.net` was tested successfully in the recorded May 12 evidence.

Automated Medicaid outbound-email integration remains unresolved. The guide should distinguish the confirmed manual secure-email workflow from future API automation.

### QuickBooks

QuickBooks direction remains open. Haven now has substantial native billing, AR, invoice, payment, GL, vendor, budget, and reporting infrastructure, but no active QuickBooks synchronization is represented in the current reporting-readiness code.

Keep the owner decision open, but update its consequences: it now concerns integration/import strategy and system-of-record boundaries, not whether Haven has any financial implementation.

### AI and BAA posture

The repository contains multiple AI/Grace functions and a centralized AI routing/governance layer. The correct restriction is not “do not build any AI subsystem until an Anthropic BAA.” It is:

> No resident PHI may leave the governed environment for a model/provider unless the applicable BAA and organization policy permit it. All model calls must pass the `ai_invocations` PHI policy gate, rate limits, audit logging, and role/tenant controls. Local or de-identified functionality may be built and tested without enabling PHI egress.

The current provider/BAA status must be re-verified before production PHI use.

---

## 6. Open-decision register reconciliation

| Previous Brain item | Current disposition |
|---|---|
| Plantation rounds cadence | Implemented in migration `219`, but conflicts with earlier discovery data; requires owner/clinical validation rather than remaining a blank build blocker. |
| DocuSign arbitration ruling | Replace with BoldSign attorney/compliance validation. |
| Encrypted email provider | Provider confirmed; automated integration remains open. |
| Homewood document/data dump | Converted into an active ingestion/launch workstream with import tooling and data artifacts; latest committed go-live report is stale and still says NO-GO. Re-run current preflight before changing status. |
| QuickBooks path | Still open. |
| Maintenance task catalog | Initial grease-trap, leak-check, and AC-filter tasks exist; full Terell-approved catalog may remain open. |
| Rising Oaks site visit | External operational item; not determinable from application code. |
| Bed-hold billability | Configuration fields exist; provider-contract validation remains open. |
| Rounds vs. QuickMAR narrative duplication | Observation UI is implemented; QuickMAR ingestion remains absent. Final clinical documentation boundary still needs confirmation. |
| Snack cutoff | Still open. |
| Anthropic/model-provider BAA | Re-verify before any PHI model routing. |
| Facial-recognition legality | Still open; do not implement. |
| Lockdown vs. elopement drills | Current schema implements fire, elopement, and tornado, with six fire and two elopement targets; lockdown is absent. Confirm whether this implementation retired the earlier lockdown requirement. |
| Resident profitability | Finance infrastructure has expanded, but resident cost-basis/profitability remains a distinct definition decision. |
| Assistant role literal | Current enum/labels use `assistant_administrator`; remove the old seed-literal ambiguity. |
| Old 13-table tenancy audit | Obsolete; replace with current schema audit. |
| Employee compliance tables absent | Closed; implementation exists. QuickBooks sync remains absent. |
| eFax vendor | New open owner decision from Track F. |
| PITR | Open operational blocker; latest evidence says backups on, PITR off. |
| Family two-way messaging | New explicit conflict requiring owner decision. |
| Snack-detail scope | New explicit conflict requiring owner decision. |

---

## 7. Security finding requiring repository remediation

The Brain guide's prohibition against committing PHI or resident-identifying operational artifacts should remain unchanged. The repository currently violates that rule.

Tracked files include:

- `docs/homewood/IMPORT_LOG.md`, which contains resident-identifying import results while stating real-import logs must remain local;
- `docs/homewood/RESIDENT_IMPORT_LOG.md`, which explicitly states that it contains resident names and should not be committed after a real import;
- a committed real-resident addendum CSV under `scripts/homewood/data/`;
- `scripts/homewood/data/homewood-residents.PROVENANCE.md`, containing resident-specific provenance.

Required remediation:

1. Preserve evidence privately before changing anything.
2. Determine whether the artifacts contain PHI, PII, or both under COL's policy and legal guidance.
3. Replace tracked content with de-identified/example-only artifacts.
4. Add exact ignore rules for all generated real-import logs and addenda.
5. Change import scripts so real logs write outside the repository or into an ignored path.
6. Review git history and remote clones for exposure.
7. Decide whether history rewriting and credential/session review are required; do not rewrite shared history casually.
8. Record the decision and verification without copying resident details into tickets or commit messages.

This is repository drift to fix. The Brain rule must not be weakened to accommodate it.

---

## 8. Recommended structure for a replacement Brain guide

The final replacement should be shorter and divided into stable versus volatile information:

1. **Document status and authority** — explicitly non-canonical.
2. **Mission and COL operating principles** — durable.
3. **Portfolio facts and approved terminology** — durable, with verification dates.
4. **Stakeholders and decision authority** — durable, no personal data beyond what is necessary.
5. **Binding business rules** — only owner-confirmed rules, each with source/date.
6. **Implemented architecture map** — generated or linked from current repo, not hand-maintained exhaustively.
7. **Current track/status snapshot** — link to `UNIFIED-ROADMAP.md`, do not duplicate hundreds of shipped details.
8. **Integration status** — implemented / operational / blocked / future.
9. **Open decisions** — only genuinely unresolved decisions with owner and blocking impact.
10. **Forbidden concepts** — narrow, precise, and tested where possible.
11. **Freshness and maintenance** — record repo commit, migration head, and verification date.

Recommended maintenance rule:

> Do not update the Brain guide after every code work unit. Update durable domain rules after owner decisions and update volatile status by linking to repository roadmaps. A generated snapshot may record migration/function counts, but the Brain guide must not become a second competing backlog.

---

## 9. Verification performed for this reconciliation

The repository was inspected read-only before this document was created. The following checks passed:

```text
npm run migrations:check
  PASS — 309 migration files; sequence 001..306

npm run typecheck
  PASS

npm run lint
  PASS — including constitution lint for Smart Rounding
```

Repository state at review time:

```text
Branch: codex/perf-auth-09
HEAD:   0cc49b629df14e391842f7e71f752a2673ec3ccc
Worktree was clean before this document was added.
```

No migrations, application code, deployment configuration, remote data, or external services were changed as part of the reconciliation.

---

## 10. Primary repository evidence

- `AGENTS.md`
- `CODEX.md`
- `docs/specs/UNIFIED-ROADMAP.md`
- `docs/specs/TRACK-A-CLOSEOUT-ROADMAP.md`
- `docs/specs/PHASE1-CLOSURE-RECORD.md`
- `docs/specs/PHASE1-EXECUTION-LOG.md`
- `docs/specs/COL-GO-LIVE-READINESS-CHECKLIST.md`
- `docs/specs/HAVEN-V2-GAP-IMPLEMENTATION-PLAN.md`
- `docs/specs/TRACK-F-BUILD-HANDOFF.md`
- `docs/specs/35-office-suite.md`
- `docs/specs/36-employee-workspace.md`
- `docs/specs/14-dietary-nutrition.md`
- `docs/specs/25-resident-assurance-engine.md`
- `supabase/migrations/217_col_v2_status_and_medicaid_provider_foundation.sql`
- `supabase/migrations/219_col_v2_observation_vocab_and_templates.sql`
- `supabase/migrations/220_col_v2_operational_logs.sql`
- `supabase/migrations/221_col_v2_staff_compliance_and_notifications.sql`
- `supabase/migrations/222_col_v2_resident_contracts_boldsign_schema.sql`
- `supabase/migrations/223_col_v2_boldsign_events.sql`
- `supabase/migrations/225_col_v2_activity_and_family_message_metadata.sql`
- `supabase/migrations/289_office_meetings.sql` through `305_drive_cutover.sql`
- `supabase/migrations/306_resident_rate_agreements_concessions.sql`
- `docs/homewood/GO_LIVE_REPORT.md`
- `docs/homewood/IMPORT_LOG.md`
- `docs/homewood/RESIDENT_IMPORT_LOG.md`
- `scripts/homewood/data/SCHEMA.md`
