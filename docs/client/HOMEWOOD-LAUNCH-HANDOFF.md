# Haven Homewood Launch Handoff

**Client:** Circle of Life Assisted Living Communities
**Current launch facility:** Homewood Lodge ALF
**Original readiness snapshot:** 2026-05-03
**Repository and migration-state refresh:** 2026-08-13
**Purpose:** Define what must be integrated, configured, verified, removed, or deferred before Haven is used internally by Circle of Life with real Homewood data.

## Executive Summary

Haven is an internal Circle of Life operations system being built inside COL, for COL facilities and COL staff. It should be treated as an internal company system, not as a third-party software product being sold to COL.

The May 3 readiness snapshot found a clean Homewood shell and migration `215` as the then-current endpoint. The repository and linked project have since advanced through migration `309`; a read-only `supabase migration list --linked` refresh on August 13 still reported a local/remote migration-history mismatch at numeric migration `202`. Do not treat the May 3 data reset, Edge Function inventory, or migration-parity conclusion as current launch evidence without rerunning the relevant checks.

The remaining work is not "more app screens first." The launch blocker is operational readiness: internal PHI controls, environment configuration, demo-data safeguards, user provisioning, Homewood-specific master data, and a controlled real-data entry plan.

**Recommended launch posture:** start with a controlled Homewood launch for administrator and owner workflows, then add clinical, medication, billing, family, and automation workflows only after each data domain is validated.

**Mission alignment:** `risk` until internal PHI handling controls, backup/recovery posture, real-auth UAT, demo fallback hardening, and Homewood data validation are complete. Once those are complete, launch alignment becomes `pass`.

## Internal Build Assumption

This handoff assumes Haven is operated by Circle of Life as an internal company system. That changes the compliance posture:

- COL is not buying Haven from an outside software vendor.
- Haven is not being marketed or sold as a third-party SaaS product.
- Internal workforce access, role permissions, auditability, and minimum-necessary PHI handling are the primary controls.
- External platforms or services that store, transmit, process, log, or can access PHI still need vendor review and contractual controls where applicable.
- AI, SMS, email, analytics, file conversion, hosting, database, and monitoring services should be reviewed based on whether PHI reaches them.

The practical rule is: internal build reduces vendor-to-client contracting complexity for Haven itself, but it does not eliminate the need to control external subprocessors or PHI exposure.

## Verified State And Refresh Notes

- Supabase project: `manfqmasfqppukpobpld`
- Migration history: the repository and linked project reach migration `309` as of 2026-08-13, but the linked migration listing reports unmatched local/remote entries for numeric migration `202`; full parity remains open until that history is reconciled
- Edge Functions: the deployed-by-name match was verified in the 2026-05-03 snapshot only; re-inventory before launch
- Active COL facilities in the 2026-05-03 review:
  - Oakridge ALF
  - Rising Oaks ALF
  - Homewood Lodge ALF
  - Plantation ALF
  - Grande Cypress ALF
- Homewood facility ID: `00000000-0000-0000-0002-000000000003`
- Homewood status in the 2026-05-03 review: active
- Operational/demo data reset: the 2026-05-03 review verified zero rows across its reviewed Homewood operational tables; this is not a current census, so rerun the Homewood readiness/data audit before any import or cleanup
- Demo organization/facility in the 2026-05-03 review: soft-deleted, not hard-deleted, to preserve audit references

## Non-Negotiable Go-Live Gates

The app should not receive PHI until all of these are complete.

| Gate | Owner | Required Outcome |
|---|---|---|
| Internal PHI controls | COL / project owner | Internal approval for PHI use, access controls, audit expectations, and recovery expectations documented |
| App hosting | Technical owner | Production deploy host configured, HTTPS active, environment variables set, rollback path known |
| Secrets | Technical owner | Supabase, Sentry, Edge Function, AI, push, and integration secrets stored only in platform secret stores |
| Demo safeguards | Engineering | `NEXT_PUBLIC_DEMO_MODE` unset, demo seed/reset commands removed or blocked from production use, fixture fallbacks do not masquerade as live data |
| Auth and roles | COL + technical owner | Approved Homewood users provisioned with correct roles and facility access |
| RLS / access check | Technical owner | Homewood users only see allowed Homewood/COL data; wrong-role access denied |
| Homewood master data | COL | Facility, entity, administrator, AHCA, contacts, rooms/beds, staff, resident, payer, medication, dietary, and family data validated |
| UAT | COL users | Role-based walkthrough completed on production/staging URL with real auth |
| Support model | COL + technical owner | Launch-day contact, issue triage, audit export, and rollback process agreed |

## What Needs To Be Integrated Or Added

### 1. Hosting And Release Operations

Haven needs a clean production web deployment, preferably on the agreed hosting platform with branch deploys and a rollback path.

Required:
- Production URL and DNS.
- HTTPS and secure cookies.
- Netlify or equivalent environment variables for:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `NEXT_PUBLIC_SITE_URL`
  - Sentry variables if production monitoring is enabled.
- `NEXT_PUBLIC_DEMO_MODE` must be absent or false.
- `NEXT_PUBLIC_UI_V2` should be intentionally set according to the chosen production UI path. If the V2 shell has not completed production UAT, keep the current stable UI path.

Add:
- A short production release checklist that records build SHA, deployment URL, migration version, Edge Function version check, Sentry status, and rollback target.

### 2. Production Data Controls

Required before PHI:
- COL internal approval to use Haven for Homewood PHI.
- Clear list of approved users and job roles.
- Point-in-Time Recovery or equivalent database recovery posture enabled.
- Backup retention confirmed.
- Database access limited to named administrators.
- Service role key rotation plan.
- Storage buckets reviewed for private access and document retention.
- External services reviewed for whether PHI is stored, transmitted, processed, logged, or used in model prompts.

Add:
- An internal PHI-readiness attestation before Homewood PHI entry.
- A vendor/subprocessor note for each external service that can touch PHI.

### 3. Database Seed And Demo Cleanup

The 2026-05-03 review found Homewood operational data cleaned, but Homewood onboarding and import work occurred afterward. Re-query the live target before any import or cleanup. The repo still contains historical demo seed migrations and demo scripts; do not casually delete applied migration files because that creates migration-history drift.

Required:
- Add a production cleanup / guard migration if this project will ever be rebuilt from migrations into a new production database.
- Keep only COL organization, legal entity, and facility shells as initial seed data for a fresh production environment.
- Treat staff, residents, rooms, beds, billing, medications, incidents, schedules, and metrics as real imports or manual entry, not migration seed.

Remove or hard-disable from production operation:
- Demo seed / reset / reseed npm scripts.
- Demo auth-user creation scripts.
- Static dashboard fixture fallbacks that can look like live data.
- Any client-facing doc that instructs production users to run demo seed commands.

Keep only with explicit approval:
- Regulatory templates, assessment templates, role permissions, training catalogs, Form 1823 checklist items, and operational task templates. These are reference/config data, not facility-only seed, so COL should approve them before treating them as production defaults.

### 4. Authentication, Users, And Facility Access

Required:
- Final list of Homewood launch users.
- Role for each user:
  - owner
  - org admin
  - facility admin
  - nurse / med tech
  - caregiver
  - dietary
  - maintenance / housekeeping
  - family user
- Facility access for each user, especially Homewood-only users.
- Invitation or password-reset workflow.
- Test that users land in the correct shell after login.
- Test that wrong-role and wrong-facility access is denied.

Add:
- A user import/provisioning template that COL approves before account creation.
- A launch-day user access report for Homewood.

### 5. Homewood Facility Master Data

Required from COL:
- Confirm Homewood legal entity name and suffix. Current repo references `Sorensen, Smith & Bay, LLLC`; verify whether that is legally correct or should be LLC.
- AHCA license number and expiration.
- Administrator and key personnel.
- Emergency contacts.
- Building profile.
- Units, rooms, and beds.
- Pharmacy vendor.
- Utility / emergency preparedness contacts.
- Default operational thresholds.
- Medicaid MCO payer relationships.

Add:
- Homewood facility profile sign-off sheet.
- Homewood room and bed import template.

### 6. Real Operational Data Imports

Do not seed fake operational data. Import or enter the following from verified Homewood source records.

Priority 1:
- Staff roster and roles.
- Current residents.
- Resident contacts and family links.
- Admissions documents, especially Form 1823.
- Room / bed assignment.
- Payer and rate information.

Priority 2:
- Medication profile and eMAR readiness.
- Care plans and assistance levels.
- Dietary orders, allergies, texture / liquid consistency.
- Staff certifications and Baya training certificates.
- Incident history only if COL wants historical reporting in Haven.

Priority 3:
- Billing open balances and invoice history.
- Vendor / contract records.
- Transportation vehicles and driver credentials.
- Reputation accounts.
- Referral pipeline.

Add:
- Data import templates for each priority group.
- Reconciliation report after each import showing row counts and exceptions.

### 7. Edge Functions, Scheduled Jobs, And Automation

Edge Functions are deployed by name, but production automation still needs secrets, schedules, and owner acceptance.

High-priority jobs:
- `ar-aging-check`
- `generate-emar-schedule`
- `emar-missed-dose-check`
- `exec-kpi-snapshot`
- `exec-alert-evaluator`
- `facility-expiration-scanner`
- `report-scheduler`
- `risk-nightly-scorer`
- `oce-task-scheduler`

Integration / AI functions:
- `ingest`
- `knowledge-agent`
- `resident-assurance-ai`
- `resident-safety-scorer`
- Grace functions

Required:
- Secret values configured in Supabase Edge Function secrets.
- Cron schedules registered.
- First-run dry run or limited run.
- Monitoring for failures.
- Confirmation that AI features do not process PHI unless COL has approved the external AI service path and PHI controls.

Add:
- Cron inventory with schedule, secret name, owner, last successful run, and failure notification path.

### 8. Third-Party Integrations

Start with manual or CSV workflows where vendor API details are not confirmed.

Recommended launch decisions:
- **Sentry:** enable for production error monitoring with PHI scrubbing.
- **Push notifications:** enable only after VAPID keys are configured and notification copy is approved.
- **Twilio SMS / voice:** defer unless escalation workflows are signed off.
- **OpenAI / Anthropic:** use only where COL approves the data path; avoid PHI unless the service relationship and controls are approved. Keep AI subordinate to staff judgment.
- **Google / Yelp reputation:** optional; can wait until after Homewood clinical launch.
- **HL7 referrals:** optional; current function parses inbound messages but does not auto-create leads without manual action.
- **Billing/payment/accounting:** begin with CSV handoff unless the vendor integration is formally scoped.
- **Baya training:** begin with certificate upload or manual training completion import; API integration can be a later slice.
- **Pharmacy / eMAR integration:** do not automate medication administration without a validated source-of-truth integration and clinical sign-off.

### 9. Monitoring, Audit, And Support

Required:
- Sentry or equivalent error monitoring.
- Supabase logs monitored during launch.
- Edge Function failure review.
- Audit export process verified.
- Named support owner for launch day.
- Issue severity definitions.
- Backup / rollback process.

Add:
- Daily launch report for the first week:
  - login failures
  - access-denied events
  - app errors
  - Edge Function failures
  - data import exceptions
  - user-reported workflow gaps

## What I Would Add, Delete, Or Change

### Add

- Production launch checklist and sign-off page.
- Homewood data import templates.
- Homewood user provisioning template.
- If a current-state audit still shows the need, add a uniquely numbered production cleanup guard after reconciling migration history. Do not use migration `216`; it is already allocated to `216_facility_launch_document_parser.sql`.
- Automated "no demo data active" check in CI or release gates.
- A production-safe empty-state policy: empty tables show empty states, not demo rows.
- Cron inventory and health dashboard.
- PHI/AI policy: which features may use AI, with what data, and through which approved external service path.

### Delete Or Disable

- Production access to demo seed, reset, and reseed commands.
- Demo auth-user creation script from normal command surfaces.
- Client-facing runbook language that tells operators to seed demo data.
- Static fixture fallbacks on production dashboards where they can be mistaken for live facility status.
- Any test/demo account not explicitly approved for Homewood UAT.

### Change

- Preserve Oakridge Phase 1 acceptance history, but update active launch docs to distinguish that seeded validation pilot from current Homewood launch verification.
- Update stale migration references that stop at `120` or `215`; the repository and linked project now reach `309`, with the numeric `202` history mismatch called out until reconciled.
- Clarify Homewood legal entity suffix (`LLC` vs `LLLC`) before relying on it in production documents.
- Make demo mode impossible to activate by browser-local state in production.
- Treat reference catalogs separately from operational seed data; COL should approve each catalog before launch.

## Launch Sequence

### Phase 0: Compliance And Environment

1. Confirm internal PHI approval, database recovery posture, and backups.
2. Confirm production URL and environment variables.
3. Confirm `NEXT_PUBLIC_DEMO_MODE` is off.
4. Confirm Sentry / monitoring.
5. Confirm deployed migrations and Edge Functions.

### Phase 1: Clean Homewood Shell

1. Confirm only COL facility shells are active.
2. Confirm Homewood facility profile.
3. Confirm Homewood user list.
4. Provision users.
5. Run role-based login and RLS checks.

### Phase 2: Real Data Entry

1. Import or enter Homewood staff.
2. Import or enter room/bed structure.
3. Import or enter residents and contacts.
4. Attach or record Form 1823 status.
5. Enter payer/rate data.
6. Reconcile row counts with COL.

### Phase 3: Workflow UAT

1. Admin dashboard and facility selector.
2. Resident profile.
3. Caregiver daily notes and ADLs.
4. Incident reporting.
5. Medication / eMAR only after clinical source-of-truth validation.
6. Billing only after payer/rate validation.
7. Family portal only after consent and family links are verified.

### Phase 4: Controlled Go-Live

1. Pick a small Homewood user group.
2. Run daily support check-ins.
3. Keep automation in monitor/dry-run mode where possible.
4. Review audit logs and errors daily.
5. Expand workflows only after the prior workflow is stable.

## Client Decisions Needed

| Decision | Needed Before | Notes |
|---|---|---|
| Confirm internal PHI and recovery approval | Any PHI | Hard gate |
| Confirm Homewood legal entity | Facility setup | LLC vs LLLC must be resolved |
| Choose launch workflows | UAT | Admin-only first is safest |
| Approve user list and roles | Account creation | Include facility access |
| Approve reference catalogs | Production defaults | Training, compliance, assessment, tasks |
| Decide AI policy | AI features | PHI requires explicit COL approval and external-service review |
| Decide notification channels | Alerts | Push/SMS/email each need setup and consent policy |
| Decide historical import depth | Data import | Current-state only vs historical records |

## Residual Risks

- A fresh database replaying all historical migrations can still create old demo data unless a cleanup guard or sanitized baseline is used.
- Existing docs and scripts still contain demo workflows and should be cleaned before client handoff is treated as final.
- Some dashboards contain fixture fallback behavior that must not be confused with live facility status.
- Homewood production readiness depends on client-verified source data, not only code readiness.
- AI, SMS, reputation, billing, and medication integrations each require separate credential, compliance, and workflow sign-off.

## Recommended Go / No-Go Verdict

**Go for controlled setup:** yes, if the team is entering Homewood master data and validating workflows with approved users.

**Go for PHI production use:** only after COL internal PHI approval, database recovery posture, demo safeguards, Homewood user access, and real-data UAT are confirmed.

**Go for broad operational automation:** not yet. Enable automation one workflow at a time after the underlying Homewood data is validated.
