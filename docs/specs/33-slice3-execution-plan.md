# Slice 3 Execution Plan

**Status:** FORMALLY CLOSED — PASS  
**Roadmap source:** [29-col-demo-roadmap.md](/Users/brianlewis/Circle%20of%20Life/Circle-of-Life/docs/specs/29-col-demo-roadmap.md)  
**Previous slice:** [32-slice2-closeout-record.md](/Users/brianlewis/Circle%20of%20Life/Circle-of-Life/docs/specs/32-slice2-closeout-record.md)  
**Slice:** `Experience By Role`  
**Date:** 2026-04-16  
**Audience:** Brian Lewis, Circle of Life leadership, future execution agents

---

## Goal

Make Haven feel intentionally designed for the roadmap-five roles instead of exposing one giant operator surface:

- owner
- facility admin
- caregiver
- med-tech
- family

This slice focused on role-fit, first-screen priority, role-specific workflow continuity, and phone/tablet comfort for floor work.

---

## Current Read

Slice 3 is now **formally complete and signed off**.

The work landed as a set of coherent role packages instead of one monolithic redesign:

1. role routing and first-screen intent contract
2. owner / facility-admin distinction inside the shared admin shell
3. caregiver workflow depth
4. med-tech exception and controlled-count flow
5. family depth and cross-page product coherence
6. specialist route convergence for nurse and other admin-eligible specialist returns
7. limited-shell convergence for maintenance and broker roles
8. admin-specialist navigation convergence for front desk, coordinator, and nurse
9. stale specialist-route convergence for dietary
10. dietary role-contract convergence
11. med-tech shell convergence at the proxy layer
12. server-side admin home convergence
13. onboarding shell convergence
14. admin command-nav parity for dedicated-home roles
15. caregiver support-lane home-link parity
16. caregiver resident-detail recovery parity
17. shared error-boundary home-link parity

Browser validation was run against the role homes and the key floor/family routes needed by the acceptance gates.

---

## Acceptance Gate Review

### 1. Each role has a clear first screen with the right priorities

**Status:** PASS

Delivered:

- owner home centered on portfolio movement, executive alerts, finance, insurance, and high-severity incident drill-ins
- facility-admin home centered on urgent-now work, blocked workflows, resident watchlist, and recent critical activity
- caregiver home centered on due-now work, assignments, and shift actions
- med-tech home centered on med pass, resident rail, controlled count, incident capture, and shift tape
- family home and deeper pages centered on the linked resident, plain-language care context, messages, calendar, and billing

Primary surfaces:

- `/admin/executive`
- `/admin`
- `/caregiver`
- `/med-tech`
- `/family`

### 2. Floor staff can complete core tasks comfortably on tablet/mobile

**Status:** PASS

Delivered:

- caregiver shell now shows live facility + shift context instead of stale hardcoded header text
- caregiver core routes share one floor-workflow strip that explains how tasks, rounds, meds, PRN reassessment, incident reporting, and handoff connect
- med-tech cockpit now includes real controlled-count access and real incident capture
- phone and tablet browser checks were run for caregiver core routes and the med-tech cockpit

Primary surfaces:

- `/caregiver`
- `/caregiver/tasks`
- `/caregiver/rounds`
- `/caregiver/meds`
- `/caregiver/followups`
- `/caregiver/prn-followup`
- `/caregiver/incident-draft`
- `/caregiver/handoff`
- `/med-tech`
- `/med-tech/controlled-count`

### 3. The family portal no longer feels like a repurposed admin tool

**Status:** PASS

Delivered:

- warmer family shell labels and navigation
- resident-centered page framing across the deeper family routes
- plain-language copy on care, messages, calendar, billing, invoices, and payments
- consistent “for resident” context across the family product

Primary surfaces:

- `/family`
- `/family/messages`
- `/family/care-plan`
- `/family/calendar`
- `/family/billing`
- `/family/invoices`
- `/family/payments`

### 4. Owner/admin views remain powerful without leaking complexity to other roles

**Status:** PASS

Delivered:

- owner and facility admin remain on the same shell, but with clearly different home emphasis
- owner drill-ins stay in an executive decision lane instead of dropping into generic admin reporting
- facility-admin destinations preserve an operational command-center frame
- floor and family roles do not inherit admin complexity

Primary surfaces:

- `/admin/executive`
- `/admin/executive/alerts`
- `/admin/finance`
- `/admin/insurance`
- `/admin`

---

## Workstream Summary

### Workstream A — Role Contract

**Status:** complete

Delivered:

- richer role dashboard configuration in `dashboard-routing`
- explicit role labels, task lanes, first-screen priorities, suppressed sections, and device posture

### Workstream B — Admin Role Depth

**Status:** complete

Delivered:

- owner-first executive priorities
- executive drill-in continuity across alerts, finance, and insurance
- facility-admin command hierarchy on `/admin`

### Workstream C — Caregiver Workflow

**Status:** complete

Delivered:

- live shell header context
- shared floor-workflow strip
- stronger continuity across tasks, rounds, meds, follow-ups, PRN, incident, and handoff

### Workstream D — Med-Tech Workflow

**Status:** complete

Delivered:

- med-tech controlled-count route
- shared count console
- real cockpit incident capture
- med-tech permission and watch-trigger repair for current incident schema

### Workstream E — Family Experience

**Status:** complete

Delivered:

- resident-centered family page framing
- deeper route continuity
- calmer billing/product language

### Workstream F — Specialist Route Convergence

**Status:** complete

Delivered:

- nurse now lands in `/admin/nurse-dashboard` instead of falling directly into the med-tech tool
- nurse still retains access to `/med-tech` as the live medication-workflow tool
- cross-shell redirects now return admin-eligible specialists to their actual role homes instead of collapsing them back to generic `/admin`

### Workstream G — Limited Admin Shell Specialists

**Status:** complete

Delivered:

- maintenance now lands in `/admin/facilities`
- broker now lands in `/admin/insurance`
- `/admin` no longer acts as a generic fallback for roles whose defined home already lives elsewhere
- the shared admin shell now supports per-role nav-item narrowing so limited-shell specialists only see the module lanes they are supposed to operate

### Workstream H — Admin Specialist Nav Contract

**Status:** complete

Delivered:

- front desk, coordinator, and nurse now see explicit specialist home entries inside the shared admin shell
- the admin shell now narrows visible menu items for those roles to the modules their dashboards already promise
- `/admin/care-plans/reviews-due` now exists as a real coordinator destination instead of a dead route referenced by the coordinator dashboard and compliance flows

### Workstream I — Dietary Alias Convergence

**Status:** complete

Delivered:

- `/admin/dietary-dashboard` no longer acts like a stale duplicate specialist page
- dietary users hitting that stale path are now redirected to the canonical `/dietary` command deck
- admin users hitting that stale path are redirected to the canonical `/admin/dietary` hub

### Workstream J — Dietary Role Contract Convergence

**Status:** complete

Delivered:

- the central dashboard-routing contract now reflects the actual dietary home as `/dietary`
- dietary is modeled as its own shell in the role contract instead of as an admin-shell role
- housekeeper users who hit `/dietary` are now redirected back to `/caregiver/housekeeper` instead of falling through to `/login`

### Workstream K — Med-Tech Shell Convergence

**Status:** complete

Delivered:

- `/med-tech` is now protected and role-routed at the proxy layer instead of relying only on client-side shell checks
- the standalone med-tech auth helper now matches the live role contract:
  - nurse allowed
  - facility admin bounced to `/admin`
  - housekeeper bounced to `/caregiver/housekeeper`
  - logged-out users redirected to `/login?next=/med-tech`

### Workstream L — Server-Side Admin Home Convergence

**Status:** complete

Delivered:

- `/admin` now resolves specialist/admin roles to their real home at the shell boundary instead of waiting for a client-side redirect
- owner and org admin now stay on `/admin/executive` when they hit `/admin`
- front desk, coordinator, nurse, maintenance, and broker now resolve directly to their role homes when they hit `/admin`
- facility admin remains the one role whose canonical admin home is still `/admin`

### Workstream M — Onboarding Shell Convergence

**Status:** complete

Delivered:

- `/onboarding` now clearly belongs only to:
  - the dedicated `onboarding` role
  - org-level admin roles (`owner`, `org_admin`)
- other roles now bounce to their actual homes instead of older generic shell targets
- facility admin now explicitly bounces back to `/admin` rather than inheriting org-level onboarding access

### Workstream N — Admin Command Nav Parity

**Status:** complete

Delivered:

- roles whose canonical home is no longer `/admin` no longer see a misleading `Triage Inbox` command item that only redirects back to their own home
- facility admin still keeps the `Triage Inbox` item because `/admin` remains its real home

### Workstream O — Caregiver Support-Lane Home-Link Parity

**Status:** complete

Delivered:

- the canonical caregiver support routes now send housekeeper users back to `/caregiver/housekeeper` instead of generic `/caregiver`
- facility-admin and owner support/admin recovery links already respect their role homes; this pass closes the same parity gap on the floor-side support lane

### Workstream P — Caregiver Resident-Detail Recovery Parity

**Status:** complete

Delivered:

- the canonical resident detail subroutes now send housekeeper users back to `/caregiver/housekeeper` instead of generic `/caregiver`
- invalid-state resident recovery now respects the same role-home contract as the rest of the floor workflow

### Workstream Q — Shared Error-Boundary Home-Link Parity

**Status:** complete

Delivered:

- the shared admin error boundary now returns each admin-side role to its actual home instead of hardcoding `/admin`
- the shared caregiver error boundary now returns housekeeper to `/caregiver/housekeeper` instead of hardcoding `/caregiver`

### Workstream R — Caregiver Clinical Boundary + Incident Recovery

**Status:** complete

Delivered:

- caregiver workflow pages that still hardcoded `/caregiver` recovery links now resolve the signed-in role’s actual home
- housekeeper is now actively bounced out of caregiver-only clinical workflow routes:
  - `/caregiver/tasks`
  - `/caregiver/meds`
  - `/caregiver/followups`
  - `/caregiver/prn-followup`
  - `/caregiver/incident-draft`
- fixed the caregiver incident runtime path by shipping two database repairs:
  - `183_fix_incident_sequence_audit_trigger.sql`
  - `184_harden_incident_number_allocator_against_seeded_data.sql`
- incident number allocation now survives the internal sequence table and seeded incident history, so caregiver incident submission reaches a real success state again

### Workstream S — Admin Compliance Dashboard Return Parity

**Status:** complete

Delivered:

- the compliance deficiency analysis page no longer hardcodes its `Back to Dashboard` link to the facility-admin path
- owner and org-admin now return to `/admin/executive`
- facility admin still returns to `/admin`
- the page now matches the same role-home contract already used on other admin recovery links

### Workstream T — Search-Tools Settings Recovery Parity

**Status:** complete

Delivered:

- the search-tools settings page now exposes a visible `Back to Dashboard` escape hatch even when the permission guard falls back
- the escape hatch resolves from the signed-in admin role after hydration:
  - owner / org-admin -> `/admin/executive`
  - facility admin -> `/admin`
- this keeps the settings surface from trapping users inside a denied or utility-only page with no clear role-home return

### Workstream U — User-Management Settings Recovery Parity

**Status:** complete

Delivered:

- the user-management settings page now exposes a visible `Back to Dashboard` recovery link above the page content
- the recovery link resolves from the signed-in admin role after hydration:
  - owner / org-admin -> `/admin/executive`
  - facility admin -> `/admin`
  - nurse -> `/admin/nurse-dashboard`
- this keeps the settings surface aligned with the same role-home contract already applied to other admin utility pages

### Workstream V — Reporting Hub Dashboard-Return Parity

**Status:** complete

Delivered:

- the reporting hub no longer hardcodes an executive-only recovery path in shared admin usage
- its local recovery CTA now uses neutral copy:
  - `Back to Dashboard`
- the destination resolves from the signed-in reports role context:
  - owner / org-admin -> `/admin/executive`
  - facility admin -> `/admin`

### Workstream W — Executive Route Boundary Enforcement

**Status:** complete

Delivered:

- owner and org-admin still retain `/admin/executive` and its subroutes as their dedicated portfolio surface
- non-executive admin roles are now redirected away from executive routes at the shell boundary:
  - facility admin -> `/admin`
  - nurse -> `/admin/nurse-dashboard`
  - other specialist admin roles -> their existing role homes
- this closes a real Slice 3 role-fit gap where facility-admin and specialist roles could still sit inside owner-only executive pages by direct URL

---

## What Is Left

No Slice 3 implementation blocker remains.

Non-blocking follow-up observations:

1. no remaining specialist role-home blocker is known inside the current Slice 3 scope
2. some non-core role routes such as `/caregiver/me` and `/caregiver/clock` were not part of the explicit Slice 3 browser acceptance pass

---

## Recommended Next Step

Move to Slice 4 from a clean role-fit baseline.
