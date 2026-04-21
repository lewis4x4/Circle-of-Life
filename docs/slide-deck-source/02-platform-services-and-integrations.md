# Platform Services And Integrations

## Architecture Summary

- Frontend: Next.js App Router with TypeScript and Tailwind.
- Backend platform: Supabase PostgreSQL, auth, RLS, storage, and Edge Functions.
- Trust model: row-level security, audit triggers, soft deletes, UTC timestamps, UUID keys, and facility-aware access.
- Automation model: Next.js API routes plus Supabase Edge Functions for async, scheduled, and integration work.

## Core Trust And Governance Layers

- RLS-first data access using organization and facility scoping helpers.
- Immutable audit log patterns for clinical and financial actions.
- Soft-delete discipline for sensitive data.
- Separation of app roles from operational staff roles.
- PHI safety framing: no secrets in code, no AI autonomy over clinical judgment, production PHI gated by operational controls.

## Cross-Cutting Platform Capabilities

- User and facility administration
- Facility profile and rate configuration APIs
- Search index and search UI
- Reporting engine and scheduled reports
- Executive KPI snapshots and alert evaluation
- Knowledge/document tooling
- Notification and push dispatch layers
- AI invocation governance for future higher-order intelligence

## API Surface Categories

- Admin management APIs for facilities, rates, user access, and audit views
- Clinical helpers for care-plan approval, infection evaluation, and med-tech incident intake
- Rounding APIs for plan management, task generation, completion, reassignment, excuse, and reporting
- Reputation APIs for OAuth, review sync, and reply posting
- Knowledge APIs for document audit and Obsidian draft generation

## Edge Function Categories

- Billing and finance: `generate-monthly-invoices`, `ar-aging-check`
- Executive intelligence: `exec-kpi-snapshot`, `exec-alert-evaluator`, `exec-report-generator`, `exec-nlq-executor`, `exec-scenario-solver`
- Resident assurance: `observation-task-generator`, `observation-escalation-engine`, `resident-safety-scorer`, `resident-assurance-ai`
- Medication: `generate-emar-schedule`, `emar-missed-dose-check`
- Compliance / platform: `export-audit-log`, `dispatch-push`, `facility-expiration-scanner`
- Referral and reputation integrations: `process-referral-hl7-inbound`
- Knowledge / assistant services: `knowledge-agent`, `document-admin`

## Important Presentation Angle

The platform is not just “pages over a database.” The operating story is:

1. structured data captured in role-specific workflows,
2. governed by RLS and audit,
3. processed by automation and scoring,
4. surfaced back through dashboards, queues, alerts, and reports.

## Suggested Slides

- One architecture slide: shells -> APIs/Edge Functions -> Supabase data layer.
- One trust slide: RLS, audit, soft deletes, facility access, PHI posture.
- One automation slide: scheduled jobs, scoring, queue processing, report generation.
