# Slice 2 Execution Plan

**Status:** ENGINEERING EXECUTION SUBSTANTIALLY COMPLETE  
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

Slice 2 is now **largely complete from an engineering standpoint**.

The remaining work is not broad workflow construction.
It is:

1. browser-level verification of the latest queue/filter/routing behavior
2. fixing any final runtime mismatches found there
3. formal closeout documentation

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

- browser verification still needs to confirm the section-focused doctrine entry points and review-complete flow

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

- browser verification still needs to confirm queue handoffs, severity/scope filters, and queue bulk-action behavior

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

- browser verification still needs to confirm that the visible counts, pills, and deep links feel coherent in the rendered UI

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

---

## What Is Left

Only the short tail remains:

1. **Browser verification**
   - `/admin`
   - doctrine queue sections
   - incident board / queues
   - admissions / referral handoffs
   - discharge hub
   - family portal / family messages

2. **Fix final runtime stragglers**
   - only if found in the browser pass

3. **Formal closeout**
   - capture pass / pass-with-caveat / fail
   - declare Slice 2 closed or note exact residual caveats

---

## Recommended Next Step

Run the Slice 2 browser pass and use the results to produce the final closeout record.

That is now the highest-value move.
