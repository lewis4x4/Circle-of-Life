# Slice 2 Execution Plan

**Status:** ACTIVE EXECUTION PLAN  
**Roadmap source:** [29-col-demo-roadmap.md](/Users/brianlewis/Circle%20of%20Life/Circle-of-Life/docs/specs/29-col-demo-roadmap.md)  
**Previous slice:** [30-slice1-closeout-record.md](/Users/brianlewis/Circle%20of%20Life/Circle-of-Life/docs/specs/30-slice1-closeout-record.md)  
**Slice:** `Workflow Convergence`  
**Date:** 2026-04-14  
**Audience:** Brian Lewis, Circle of Life leadership, future execution agents

---

## Goal

Turn the major business lanes into end-to-end operational systems instead of disconnected modules.

This slice is not about adding broad new surfaces. It is about taking lanes that already exist and making them work as coherent operator workflows:

- document upload -> doctrine review -> promotion
- incident -> follow-up -> escalation -> backlog management
- referral -> admissions -> onboarding work creation
- command-center visibility into what changed and what is blocked

---

## Why This Slice Starts Here

Slice 1 closed the trust gap:

- Grace is safer and more explicit
- demo/sample truth leaks were addressed
- key async/failure states were surfaced
- Knowledge Admin became trustworthy enough to use

That means the next constraint is no longer trust-first UI honesty.
It is **workflow fragmentation**.

Operators can now trust more of the product, but they still have to hop across pages and infer what happens next.
Slice 2 removes that fragmentation.

---

## Acceptance Gates

Slice 2 is complete when all of these are true:

1. A KB upload enters a visible doctrine review path instead of dying as a standalone file.
2. Incident follow-up work is actionable and triageable from backlog surfaces, not only from record detail.
3. Operators can see which work is overdue, unassigned, assigned, or complete.
4. At least one cross-module workflow beyond Knowledge and Incident is operationalized end to end.
5. The command surface can answer “what changed, what is blocked, and what happens next” for the converged lanes.

---

## Active Workstreams

### Workstream A — Doctrine Review Workflow

**Purpose:** Convert uploaded KB documents into governed doctrine review work.

**Delivered**

- document upload -> review page -> draft -> publish/archive
- review owner and due date
- audit trail
- stuck-upload queue
- bulk actions for stuck uploads
- reviewer identity resolution
- explicit reviewer selection

**Primary surfaces**

- `/admin/knowledge/admin`
- `/admin/knowledge/admin/review/[id]`
- `/api/knowledge/document-audit`

**What still remains**

- publish-readiness checks before promotion
- review SLA reporting
- doctrine-review metrics suitable for admin command surfaces
- optional “review completed” event or milestone signal

**Current status:** in progress, strong foundation in place

---

### Workstream B — Incident Follow-up Workflow

**Purpose:** Make incident follow-ups executable from both detail and backlog surfaces.

**Delivered**

- incident detail follow-ups are actionable:
  - assign to me
  - mark complete
- incident detail shows open obligations for notifications/reporting
- incident board uses real follow-up state instead of random presentation state
- incident board exposes:
  - overdue follow-up count
  - unassigned follow-up count
  - follow-up pressure panel
- dedicated `/admin/incidents/overdue-followups` backlog
- dedicated `/admin/incidents/followups` open-work backlog
- bulk actions in backlog views
- ownership pressure summaries in backlog views

**Primary surfaces**

- `/admin/incidents`
- `/admin/incidents/[id]`
- `/admin/incidents/overdue-followups`
- `/admin/incidents/followups`

**What still remains**

- explicit escalation visibility for chronically overdue work
- broader assignment workflows beyond “assign to me”
- root-cause / follow-up / reporting lifecycle linkage in one status model
- optional notification log depth and command-center rollup

**Current status:** in progress, operational backlog lane established

---

### Workstream C — Referral -> Admissions -> Onboarding

**Purpose:** Build the next major end-to-end operational lane after Knowledge and Incidents.

**Why next**

- it was explicitly raised in the demo
- it is one of the clearest examples of disconnected module behavior that must converge
- it creates downstream work across multiple teams, so it is high leverage

**Target outcome**

- a referral or lead becomes an admission case
- admissions create downstream onboarding tasks
- the right roles see the right next actions
- status can be traced from top of funnel to resident onboarding

**Expected first package**

- define the concrete downstream tasks created by admissions
- surface those tasks in a visible admin lane
- avoid hidden automation

**Current status:** not started

---

### Workstream D — Command Surface Workflow Visibility

**Purpose:** Ensure the operator-facing command surfaces can show converged workflow state.

**Target outcomes**

- command surfaces answer:
  - what changed
  - what is blocked
  - what needs action
- doctrine and incident backlog state becomes visible above the record-detail level

**Current status**

- partially started through incident board pressure and doctrine queues
- not yet generalized

---

## Execution Order

### Package 1 — Doctrine review lane foundation

**Status:** shipped

- review page
- audit API
- queue visibility
- stuck-upload reporting
- reviewer assignment

### Package 2 — Incident follow-up lane foundation

**Status:** shipped

- incident detail actions
- truthful board state
- overdue backlog
- open backlog
- bulk queue actions

### Package 3 — Doctrine promotion hardening

**Status:** next in doctrine lane

- block unsafe publish paths
- add stronger readiness criteria
- expose review SLA / publish readiness

### Package 4 — Incident escalation hardening

**Status:** next in incident lane

- overdue escalation visibility
- stronger ownership routing
- lifecycle consistency between incident state and follow-up state

### Package 5 — Referral -> admissions -> onboarding automation visibility

**Status:** next major lane after current two

- create downstream task model
- surface generated work
- make ownership explicit

---

## Recommended Next Step

Continue with **Package 3 or Package 4**, then move to **Package 5**.

Recommended order:

1. finish doctrine promotion hardening
2. finish incident escalation hardening
3. begin referral -> admissions -> onboarding convergence

Rationale:

- Knowledge and Incident lanes already have meaningful momentum
- a half-finished lane switch now would create more fragmentation
- once these two lanes are stronger, the admissions lane becomes the next high-value convergence target

---

## Definition Of “Done Enough To Move On”

Move off a workstream when:

- the lane has a visible backlog surface
- the lane has actionable controls
- ownership is visible
- blocked/overdue work is visible
- the workflow is understandable without engineering explanation

That is the minimum bar for workflow convergence.

---

## What This Slice Is Not

Do not confuse Slice 2 with:

- visual polish
- role redesign
- finance strategy resolution
- Alabama expansion readiness
- commercialization

Those belong to later slices.

Slice 2 is specifically about making the platform’s key lanes behave like operating systems, not demos or disconnected tools.
