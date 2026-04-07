# 26 - Reporting Module Operating System (Phase 4)

**Dependencies:** Modules 04, 07, 08, 09, 10, 11, 16, 17, 18, 24, 25.  
**Build sequence:** Segment-first delivery per `segment-gates` discipline.  
**Migration sequence:** `102_*` to `105_*`.

---

## Purpose

Convert Haven reporting from a saved-export utility into a governed reporting operating system:

- Template library with versioned definitions
- Saved report variants with pin/update behavior
- Scheduled report execution and delivery
- Report packs for executive/compliance workflows
- Export history and audit traceability
- Role-based discovery and benchmark comparison
- NLQ-assisted template mapping with strict RBAC and metric governance

This module is mission-critical for resident safety visibility, regulatory readiness, staff clarity, and owner-level oversight.

---

## Scope tiers

### Core (ship first)

- Reporting hub under `/admin/reports/*`
- Template library + template detail
- Saved report variants
- Run/execution pipeline with run history
- CSV/PDF export tracking
- Scheduling data model + scheduler worker contract
- Packs data model + pack management UI
- Governance metadata for official/locked templates
- Audit and RLS across all reporting tables

### Enhanced

- Pack-level PDF assembly with cover pages and section separators
- Benchmark visual components and rank views
- Delivery channels beyond in-app (email routing with role-safe recipients)
- Template update diff UI for saved variants

### Future

- Event-triggered schedules
- AI-generated narrative sections in packs
- Adaptive recommendations based on role and prior usage
- Advanced NLQ drafting across cross-template packs

---

## Route map

- `/admin/reports` - Overview
- `/admin/reports/templates` - Template Library
- `/admin/reports/templates/[slug]` - Template Detail
- `/admin/reports/run/[sourceType]/[id]` - Run/Preview/Export
- `/admin/reports/saved` - Saved Reports
- `/admin/reports/scheduled` - Schedules
- `/admin/reports/packs` - Packs
- `/admin/reports/history` - Export History / Audit
- `/admin/reports/admin` - Template Governance (owner/org_admin)

Backward-compatibility:

- `/admin/executive/reports` remains available and links to new reporting surfaces.

---

## Data model

### Core tables

- `report_templates`
- `report_template_versions`
- `report_saved_views`
- `report_schedules`
- `report_schedule_recipients`
- `report_runs`
- `report_exports`
- `report_packs`
- `report_pack_items`
- `report_permissions`
- `report_benchmarks`
- `report_nlq_mappings`

### Ownership and scope patterns

All reporting tables use:

- `organization_id` for tenant boundary
- optional `entity_id` and `facility_id` where scope-sensitive
- `created_by`, `updated_by`, `created_at`, `updated_at`, `deleted_at` where applicable

`report_runs` and `report_exports` store immutable execution snapshots and are append-oriented.

---

## Template object contract

Each template version stores `definition_json` with:

- identity: `template_id`, `name`, `slug`, `category`, `tags`
- audience: `intended_roles`, `intended_personas`, `use_cases`
- data model: `source_modules`, `metrics`, `dimensions`, `allowed_filters`, `required_filters`, `default_filters`, `grouping_options`, `sort_options`
- presentation: `default_view_type`, `sections`, `table_definitions`, `chart_definitions`, `summary_cards`, `narrative_blocks`
- execution: `supported_scopes`, `default_date_range`, `export_formats`, `supports_schedule`, `supports_pack_membership`
- governance: `official_template`, `locked_definition`, `editable_by_roles`, `clonable`, `audit_required`, `pii_risk_level`

The application resolves template execution via an explicit registry (no arbitrary SQL from user input or free-form NLQ output).

---

## Scheduling contract

`report_schedules` supports:

- source types: `template`, `saved_view`, `pack`
- recurrence: daily/weekly/monthly/quarterly/custom cron (admin-only for cron)
- timezone and next-run tracking
- pause/resume and failure status

Execution worker behavior:

1. Pull due schedules
2. Resolve source definition + RBAC-safe scope
3. Execute report/pack run
4. Persist `report_runs`
5. Persist `report_exports`
6. Write delivery events and failures

---

## Governance rules

### Official and locked templates

- Only `owner` and `org_admin` may edit locked definitions
- Changes require a new `report_template_versions` row
- Deprecated versions remain runnable for audit replay
- Cloning follows template-level `clonable` policy

### Saved view version behavior

Saved views track `template_version_id` and support:

- "update available" indicator
- diff inspection metadata
- adopt-update or stay-pinned behavior

---

## NLQ boundaries

NLQ capabilities must:

- map to approved templates/metrics only
- never bypass RLS or scope restrictions
- log request/response metadata for audit
- surface source definition and applied filters before run

`report_nlq_mappings` stores allowed phrase-intent mappings and confidence metadata.

---

## Benchmarks and comparisons

`report_benchmarks` holds benchmark definitions per metric and scope:

- period-over-period
- facility vs portfolio
- facility vs target
- facility vs peer cohort

Benchmark values are centrally governed and applied consistently across templates.

---

## Export and audit requirements

Every export includes metadata:

- generated at/by
- template + version
- scope and date range
- data freshness timestamp

Every run/export action writes auditable records:

- `report_runs` and `report_exports`
- `audit_log` trigger coverage on mutable reporting assets

---

## Launch template minimum set

Seed and expose these launch templates:

- Occupancy and Census Summary
- Facility Operating Scorecard
- Incident Trend Summary
- Staffing Coverage by Shift
- Overtime and Labor Pressure
- Medication Exception Report
- Resident Assurance / Rounding Compliance
- AR Aging Summary
- Training and Certification Expiry
- Survey Readiness Summary
- Executive Weekly Operating Pack

---

## Segment checklist

1. Spec + schema foundation (`102`-`105`)
2. Template library and overview UI
3. Execution engine + run tracking
4. Saved views + version management
5. Scheduling + delivery flow
6. Packs + governance + history
7. NLQ mapping + benchmark comparisons + drill-down actions

Each segment must produce a matching `segment:gates` PASS artifact before handoff.

---

## Mission alignment

**pass** - This module strengthens role-governed visibility, compliance traceability, and operational follow-through while keeping AI assistance subordinate to auditable template definitions and human oversight.
