# Slice 2 Execution Plan

**Status:** BROWSER QA COMPLETE — CLOSEOUT READY WITH CAVEATS  
**Roadmap source:** [29-col-demo-roadmap.md](/Users/brianlewis/Circle%20of%20Life/Circle-of-Life/docs/specs/29-col-demo-roadmap.md)  
**Previous slice:** [30-slice1-closeout-record.md](/Users/brianlewis/Circle%20of%20Life/Circle-of-Life/docs/specs/30-slice1-closeout-record.md)  
**Slice:** `Workflow Convergence`  
**Date:** 2026-04-15  
**Audience:** Brian Lewis, Circle of Life leadership, future execution agents

---

## Goal

Turn the major business lanes into end-to-end operational systems instead of disconnected modules.

This slice focused on making existing surfaces behave like real operational lanes:

- document upload -> doctrine review -> promotion
- incident -> follow-up -> escalation -> obligations -> backlog management
- referral -> admissions -> onboarding -> downstream handoff
- discharge -> reconciliation -> pharmacist -> completion
- family triage / conferences as real admin workflows
- command-center visibility into what changed, what is blocked, and what happens next

---

## Current Read

Slice 2 is now **complete enough to close from an implementation standpoint**.

The browser-backed closeout pass was run against the command surface and its filtered destinations. That pass surfaced two real runtime mismatches, both now fixed:

1. `/admin` used invalid `incident_status` enum values in the dashboard snapshot query
2. incident backlog links under `/admin/incidents/...` were pointing at admin-prefixed routes that did not exist, so they fell through to the incident detail route

The remaining caveat is operational auth drift on the target project, not additional Slice 2 workflow construction.

---

## Acceptance Gate Review

### 1. KB uploads enter a visible doctrine review path

**Status:** PASS

Delivered:

- upload -> review page -> draft -> publish/archive
- stuck-upload queue
- SLA queue
- ready-to-publish queue
- explicit review-complete milestone
- publish gating tied to actual review readiness
- command-surface routing into blocked / ready / SLA doctrine slices

Primary surfaces:

- `/admin/knowledge/admin`
- `/admin/knowledge/admin/review/[id]`
- `supabase/functions/document-admin`

Residual risk:

- doctrine entry points and section-focus behavior were browser-checked in the closeout pass
- no additional doctrine-lane code blocker remains in Slice 2 scope

### 2. Incident follow-up work is actionable and triageable from backlog surfaces

**Status:** PASS

Delivered:

- incident detail actions
- open follow-up queue
- overdue follow-up queue
- obligations queue
- escalation visibility
- assignee routing
- RCA -> follow-up bridge
- board badges / board scope / board severity views
- queue deep links preserving severity and scope
- queue summaries/bulk actions aligned with the active slice

Primary surfaces:

- `/admin/incidents`
- `/admin/incidents/[id]`
- `/admin/incidents/followups`
- `/admin/incidents/overdue-followups`
- `/admin/incidents/obligations`
- `/admin/incidents/[id]/rca`

Residual risk:

- queue handoffs and severity/scope-filtered backlog entry points were browser-checked after the admin-prefixed incident backlog routes were restored
- no additional incident-lane code blocker remains in Slice 2 scope

### 3. Operators can see which work is overdue, unassigned, assigned, or complete

**Status:** PASS

Delivered:

- doctrine blocked / ready / SLA states
- incident overdue / escalated / unassigned / lifecycle blockers
- admissions blocked / ready / onboarding
- referral blocked / ready / onboarding / stable handoffs
- discharge planning / pharmacist review / ready
- family triage / conference queues
- command-center cards, inbox items, and sidebar links increasingly route into the correct slice

Residual risk:

- destination filter chrome and command-surface deep links were browser-checked on the closeout path
- target-project auth drift still makes the historical pilot credential matrix unreliable without repair

### 4. At least one cross-module workflow beyond Knowledge and Incident is operationalized end to end

**Status:** PASS

Delivered:

- referral -> admissions -> onboarding
- discharge workflow lane
- family triage / conference workflow lane

### 5. The command surface can answer “what changed, what is blocked, and what happens next”

**Status:** MOSTLY PASS, pending browser verification

Delivered:

- `/admin` workflow cards now route into the active lane slice
- `/admin` inbox now reflects real workflow backlog state
- top triage strip routes into filtered destinations
- destination pages now increasingly acknowledge the active deep-linked slice instead of hiding it in the URL

Residual risk:

- final browser review is still needed to verify that the command surface feels coherent and that the linked slices render as expected in practice

---

## Workstream Summary

### Workstream A — Doctrine Review

**Status:** engineering pass complete

Delivered:

- review queue
- stuck uploads
- bulk actions
- reviewer assignment
- audit trail
- review-complete milestone
- publish gating
- SLA and ready queues
- command-surface doctrine routing

### Workstream B — Incident Workflow

**Status:** engineering pass complete

Delivered:

- actionable incident detail
- follow-up / overdue / obligations queues
- escalation and lifecycle pressure
- RCA handoff
- board scope + severity filters
- queue context preservation
- command-surface routing into the right incident slice

### Workstream C — Referral / Admissions / Onboarding

**Status:** engineering pass complete

Delivered:

- referral -> admission handoff
- duplicate protection
- blocked / move-in-ready / onboarding queues
- actionable admissions case
- downstream onboarding routing
- phase-aware referral handoff routing

### Workstream D — Discharge

**Status:** engineering pass complete

Delivered:

- actionable discharge detail
- phase-aware discharge hub
- duplicate protection
- phase deep links from `/admin`

### Workstream E — Family

**Status:** engineering pass complete

Delivered:

- family triage actions
- care conference actions
- direct-message triage routing
- family lane deep links from `/admin`
- destination-side filter visibility

### Workstream F — Command Surface

**Status:** engineering pass complete

Delivered:

- workflow card routing
- inbox routing
- top-strip routing
- destination-side filter/section visibility on many linked surfaces
- reduction of generic-hub links where the app already knows the exact slice
- staffing credential blockers now derive from live certification records instead of hardcoded placeholders
- staffing shift-gap panel now derives from live schedule-assignment pressure instead of hardcoded placeholder rows
- staffing summary card now uses live ratio / required-ratio snapshot data instead of mock HPPD values
- admin incident backlog links now resolve to real admin-prefixed follow-up / overdue / obligations pages
- `/admin` no longer fails on `incident_status` enum mismatch during snapshot loading

---

## What Is Left

Only formal recording work remains:

1. **Closeout verdict**
   - record Slice 2 as `PASS WITH CAVEATS`

2. **Operational caveat tracking**
   - note that browser QA required repairing an admin-capable demo login because the target-project pilot auth matrix has drifted from the historical runbooks
   - treat that as an auth/runbook maintenance issue, not a Slice 2 workflow-convergence reopen

---

## Recommended Next Step

Record the final closeout verdict and move to Slice 3 from a clean engineering baseline.
