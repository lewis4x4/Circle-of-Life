# ADR: Family Portal hub vs. Family Messages (sidebar IA)

**Status:** Proposed — **halt before merge** for product sign-off (Option A vs. B).  
**Date:** 2026-05-17  
**Context:** Quiet Operator navigation treats Pipeline items as first-class entry points. Today both **Family Portal** (`/admin/family-portal`) and **Family Messages** (`/admin/family-messages`) appear in the sidebar.

## Options

### Option A — Family Messages nested under Family Portal

- **Hub:** `/admin/family-portal` (Family Connections: triage, conferences, consents).
- **Messages:** Sub-route e.g. `/admin/family-portal/messages` (or keep `/admin/family-messages` but remove duplicate sidebar item; deep-link from hub only).
- **Sidebar:** Single **Family Portal** item; “Go to direct messages” is the cross-link into the inbox workflow.

### Option B — Distinct workflows, both in sidebar

- **Family Portal:** Operational hub (triage derived from messages + conferences + consents).
- **Family Messages:** Dedicated inbox / threading UX for staff responding to families.
- **Sidebar:** Keep both; document that Portal is the **overview** and Messages is the **conversation workspace**.

## Recording consent column (`family_care_conference_sessions.recording_consent`)

The UI label **“Recording consent”** reflects the boolean stored on the session row (staff documents whether recording consent was obtained — see existing **Record consent** action). It is **not** a generic AV “recording status” field.

## KPI: Consents expiring in 30 days

`family_consent_records` has **no first-class `expires_at` column** in migration `083`. The hub KPI counts rows whose **`metadata` JSON** includes `expires_at` or `expiration_date` as an ISO-8601 timestamp falling within the next 30 days. If nothing populates that metadata shape, the count is **0** (neutral). A future schema promotion can replace this heuristic without changing this ADR’s IA decision.

## Product URLs

- Canonical admin hub: `/admin/family-portal`
- Legacy pipeline alias: `/pipeline/family-portal` → redirects to `/admin/family-portal` (and nested paths preserved).

## Decision

_Record product choice here after owner review._
