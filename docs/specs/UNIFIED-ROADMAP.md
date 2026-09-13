# Haven — Unified Roadmap

**Status:** ACTIVE — single forward-looking index for all build tracks
**Created:** 2026-06-12
**Owner:** Brian Lewis

> **What this file is:** the one place to see every track (shipped, open, and proposed) and what comes next. Detailed scope still lives in the per-track roadmaps and module specs linked below — this file indexes them and is the canonical home for **newly approved workstreams** until their specs are written.
>
> **What this file is not:** an implementation spec. Segments are still built one at a time from `docs/specs/<NN>-*.md` files with gate artifacts per `docs/agent-gates-runbook.md`.

---

## 1. Current position (2026-09-09)

**Primary delivery direction:** one shared Haven Facility Operations application, Homewood first, under the September 9 owner-approved build package. [COL-18 baseline/readiness](../facility-operations/COL-18-BASELINE.md) reconciles current source and hosted evidence; [bounded handoff](../facility-operations/HANDOFF.md) selects COL-132 next, with COL-133 also dependent only on COL-18. Open operating acceptance gates do not block this authorized foundation build. Baseline completion does not mean the core or Homewood is release-ready.

| Fact | Value |
|------|-------|
| Repo migrations | **338 files**, numbered sequence `001`–`335` plus three retained May timestamp migrations, at main `fad17dcc`. The numerical successor is `336`, but concurrent branches overlap `335`–`342`; reconcile before reserving a number. |
| Remote tracking | Fresh September 9 read: **344 ledger records**, no source version missing; six retained August supplemental entries. Installed statement hashes for `319`–`335` match source. This is not a full live-schema diff; see the COL-18 manifest and limitations. |
| README "current state" drift | Reconcile `docs/specs/README.md` when the next DDL segment ships; treat **this file + the migrations folder** as current |
| Pilot | Homewood Lodge is the current acceptance and controlled launch facility (`docs/homewood/`); preserve historical Oakridge seeded validation evidence. RLS-02 must run before Oakridge goes live. |
| Production | Netlify publishes `fad17dcc`, deployment `6aa054790bc9d700089b72cb`; 37 deployed Edge slugs match source names. Full baseline gates and latest nightly FAIL; security/dependency and operating acceptance remain open. |

### Track ledger

| Track | Scope | Status | Authoritative doc |
|-------|-------|--------|-------------------|
| **A** | Phase 1 acceptance closeout (auth, RLS, UAT, Pro/BAA/PITR, waivers) | **A5 CLOSED (2026-08-26).** Pro + BAA 2026-05-11; PITR 2026-08-19; owner re-attested. Remaining: A3 §B–§E depth UAT, A4 seed/env as needed, A6 waivers, and RLS-02 before Oakridge goes live. A separate current BAA/HIPAA controls evidence refresh gates PHI rollout but does not reopen A5. | [TRACK-A-CLOSEOUT-ROADMAP.md](./TRACK-A-CLOSEOUT-ROADMAP.md) |
| **B** | Platform hardening (CI, observability, Sentry) | Closed (engineering) 2026-04-09; ongoing work is operational | README §Track B |
| **C** | Workflow hardening (Edge functions, lifecycle runbooks) | Closed (engineering) 2026-04-09; per-project deploy/crons are ops | [TRACK-C-WORKFLOW-HARDENING.md](./TRACK-C-WORKFLOW-HARDENING.md) |
| **D** | Phase 6 completion pass + Enhanced backlog | Core D1–D10 + Enhanced D12–D84 shipped; D85+ optional per owner priority | [TRACK-D-ENHANCED-BACKLOG-PLAN.md](./TRACK-D-ENHANCED-BACKLOG-PLAN.md), [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md) |
| **E** | Cross-cutting sweep + next strategic DDL (Resident Assurance 25, Reporting 26, OCE 27, Grace memory 27/28, Executive Standup pack, Facility Admin Portal, KB) | Large portions shipped through migration `288`; see per-spec status | [TRACK-E-CROSS-CUTTING-SWEEP.md](./TRACK-E-CROSS-CUTTING-SWEEP.md), [KB-NEXT-ROADMAP.md](./KB-NEXT-ROADMAP.md), [24-executive-standup-pack-roadmap.md](./24-executive-standup-pack-roadmap.md) |
| **F** | **Employee Workspace & Office Suite** (this document, §2) | **BUILT except F4-1** — eFax still needs an owner vendor pick; F5-1 live Drive bytes need OAuth | [TRACK-F-BUILD-HANDOFF.md](./TRACK-F-BUILD-HANDOFF.md) |

### Standing gates that apply to everything below

1. **A5 remains PASS; current PHI-launch evidence must be refreshed separately.** Preserve the 2026-08-26 owner-attested closeout. Before PHI rollout, owner/legal must confirm current BAA coverage, HIPAA add-on, required project controls, and PITR as described in [PHASE1-ENV-CONFIRMATION.md](./PHASE1-ENV-CONFIRMATION.md#post-closeout-phi-launch-evidence-refresh--2026-09-06). Absence of a locally inspected contract is not evidence that no BAA exists. A3 depth UAT remains open.
2. One bounded segment at a time; `npm run segment:gates -- --segment "<id>"` (+ `--ui` for routes/visuals); PASS artifact in `test-results/agent-gates/` before "done".
3. New DDL takes a freshly reconciled/reserved migration number and updates this file. Main's current numerical successor `336` overlaps active branches; never reuse it blindly.
4. Mission alignment (`pass` | `risk` | `fail`) recorded in every segment handoff.

---

## 2. Track F — Employee Workspace & Office Suite

**Current boundary (2026-09-05):** Office 365 owns email, general calendar, chat, files at rest, and the general document library. Haven owns resident workflows, staff compliance records, survey artifacts, and workflows with escalation: survey binders, policy acknowledgments, meeting minutes that create OCE tasks, front desk records, cash and trust ledgers, and letters generated from resident or staff records. This boundary does not itself move any files or enable an integration.

Haven KB search ingests curated, approved documents from SharePoint or Drive. Preserve source ownership, audience restrictions, review/publish governance, and revocation handling; do not bulk-copy the general library. COL-34 still chooses the general library's destination and source permissions. Office 365 meeting transport, general calendars, and the general contact directory must not be duplicated by new Haven segments; Haven retains workflow minutes, operational deadlines, and facility on-call context.

**Adoption gate:** F3-1, F3-2, and F3-4 are **built and frozen**. No further feature segments there until staff interviews and adoption evidence justify them. Existing privacy, retention, audit, and security obligations still apply.

**Origin:** owner direction, 2026-06-12. Sequenced office-tools-first per owner priority ("tools management/officers can use day to day").

**Reuse mandate — do not build parallel systems:**

| Need | Build on |
|------|----------|
| Published docs / group library | Existing KB: `documents` + `chunks` + `ingest` / `knowledge-agent` Edge Functions (migrations `126`+); publishing = promotion into KB with `lifecycle_status`, `review_owner`, `approved_by` |
| Tasks / kanban cards | OCE (`operation_task_templates` / `operation_task_instances`, Module 27); personal kanban renders OCE-assigned tasks as cards + free-form personal cards |
| Private files | Supabase Storage, per-user prefix RLS (`auth.uid()`), explicit share action into group space |
| Notifications | `dispatch-push` Edge Function |
| Voice capture / transcription | `grace-transcribe` / `grace-tts` |
| Expirations on calendar | `facility-expiration-scanner` (migration `131`) |
| Search | platform-search substrate |

### F0 — Governance decisions (owner) — **RATIFIED 2026-06-12 (Brian Lewis)**

"Private" space in a PHI platform needs explicit policy first. The five decisions were ratified on 2026-06-12. F0-1 through F0-4 remain in force; F0-5 is superseded below:

| # | Decision | Ratified position | Status |
|---|----------|-------------------|--------|
| F0-1 | PHI in private notes/files | Private = private **from coworkers, not from compliance**. Owner/org_admin break-glass access path requiring a typed reason, fully audit-logged; employees told up front in the UI | **RATIFIED** |
| F0-2 | Audit + retention | Yes — private content gets `haven_capture_audit_log`, soft deletes, defined retention; discoverable in survey/litigation | **RATIFIED** |
| F0-3 | Offboarding | On offboarding, private content transfers to the employee's manager or moves to a legal-hold archive — never deleted silently | **RATIFIED** |
| F0-4 | Publish governance | Real approval workflow: draft → submit → facility_admin/DON review → published to team/facility/org — not one-click share | **RATIFIED** |
| F0-5 | Google Drive cutover date | Historical target **2026-07-01** retired. No automatic Drive read-only change or bulk migration; Records & Data decision COL-34 governs the general library. | **SUPERSEDED 2026-09-05** |

### F1 — Office daily tools (highest priority)

Mostly new surfaces over existing data — cheap relative to impact.

| Seg | Item | Description | Depends on |
|-----|------|-------------|------------|
| F1-1 | **Unified approvals inbox** | One "Waiting on me" queue aggregating shift swaps, time-record punches, mileage, invoices, leave, document publishing; one-tap approve/deny. Today these are scattered across `/admin/shift-swaps`, `/admin/time-records`, `/admin/transportation/mileage-approvals` | Existing tables only |
| F1-2 | **Morning huddle / daily briefing** | Per-facility printable one-pager: overnight incidents, census changes, today's shift roster, open OCE tasks, meds flags, move-ins/outs. Facility-level sibling of the executive standup PDF | Existing data; standup PDF route as pattern |
| F1-3 | **Meeting hub** | Recurring meeting templates (standup, QA, safety committee), agendas, in-app minutes, action items that become OCE task instances (escalation-chased). Replaces `2026 Standup Call Log.xlsx`. Optional: `grace-transcribe` → draft minutes | OCE; F0-4 for shared minutes |
| F1-4 | **Facility master calendar** | One calendar layering survey windows, fire drills, in-services, vendor visits, family conferences, license/insurance expirations (expiration scanner), transportation; `.ics` export (pattern exists in transportation) | Existing data |

### F2 — Documents & communication (weekly-use)

| Seg | Item | Description | Depends on |
|-----|------|-------------|------------|
| F2-1 | **Letter & document generator** | Mail-merge on facility letterhead: rate-increase notices, family letters, DCF/payee correspondence, employment verification; merge fields from resident/staff records; PDF output logged to the resident or employee file | Existing records |
| F2-2 | **Internal forms builder** | Admin-built forms (maintenance request, supply request, grievance intake, refund request); submissions route to status-tracked queues | — |
| F2-3 | **E-signature + read-acknowledgment** | Policy/SOP/handbook acknowledgment per role on publish or update; admin dashboard of outstanding signatures; in-service rosters. Direct AHCA survey evidence | KB publish flow (F0-4) |
| F2-4 | **Contact directory + on-call** | Per-facility rolodex (pharmacy, hospice, physicians, AHCA field office, MCO case managers) + after-hours on-call schedule. Lighter layer than Module 19 vendor contracts | — |

### F3 — Employee workspace (personal Notion-style)

| Seg | Item | Description | Depends on |
|-----|------|-------------|------------|
| F3-1 | **Personal notes/pages — BUILT / FROZEN** | Private-by-default pages with templates (shift report, incident follow-up, 1:1 notes, meeting notes, family-call log); version history; single-editor lock (no realtime co-editing in v1) | F0-1..F0-3 |
| F3-2 | **Private file drive — BUILT / FROZEN** | Per-user Storage prefix, quotas, previews (PDF/image); share action copies/links into team or group space | F0-1..F0-3 |
| F3-3 | **Publish-to-group workflow** | Draft → review → publish into existing KB with audience scoping; published notes enter `ingest` so Grace can cite them | F0-4; KB |
| F3-4 | **Team spaces — BUILT / FROZEN** | Middle tier between Private and Org: per-facility, per-department (nursing, dietary, maintenance), ad-hoc project spaces | F3-1..F3-3 |
| F3-5 | **Personal kanban** | Board rendering the employee's OCE-assigned tasks as cards + personal free-form cards; due dates; "my week" view | OCE |
| F3-6 | **Shift handoff board** | Per-shift kanban: what 3–11 hands to 11–7; composes with OCE bulk shift-complete | OCE; F3-5 |
| F3-7 | **Comments + @mentions** | On shared pages/files/cards; notifications via `dispatch-push` | F3-1..F3-4 |
| F3-8 | **Workspace search + ask-Grace-about-my-notes** | "My stuff + shared with me" search; private notes retrievable only by their owner in Grace queries | platform-search; KB |

### F4 — ALF-specific office tools

| Seg | Item | Description | Depends on |
|-----|------|-------------|------------|
| F4-1 | **eFax send/receive** | Integrated fax (pharmacies, physicians, hospitals) with documents attached to resident records + delivery log | Vendor selection (owner) |
| F4-2 | **Front desk kit** | Visitor log (feeds infection control), package/mail log, family phone-call log attached to resident | — |
| F4-3 | **Petty cash + resident trust ledger** | Per-facility petty cash log; per-resident trust account ledger (Rep Payee / SSA-787 context); receipt photo capture; money in cents | Module 17 patterns |
| F4-4 | **Survey-readiness binder** | Auto-assembled virtual binder (license, staffing, training rosters, fire drills, menus) exportable as one PDF packet | Existing data; F1-4 |

### F5 — Migration & cutover

| Seg | Item | Description | Depends on |
|-----|------|-------------|------------|
| F5-1 | **SharePoint/Drive to KB ingest** | Curated documents only; approved source scope, audience mapping, provenance, update/revocation behavior, and review before KB publication. Existing Drive import code is foundation; SharePoint support is not claimed built. | COL-34; source OAuth; F0-4; integration spec update before code |
| F5-2 | **Records transition** | No standing cutoff. Owner approves destination and retention, permissions, and reconciliation before any source becomes read-only. Haven is the workflow record; Office 365 or Drive retains the general library. | COL-34; verified records transition plan |

### Explicitly deprioritized (recorded so it isn't re-litigated)

- Realtime collaborative editing (Google Docs style) — version history + editor lock covers v1.
- Full Notion database/relations clone — pages + templates + folders + search is the v1 bar.
- Built-in spreadsheet/slide editors — CSV exports + Module 26 reporting cover it.
- Built-in email client — compose deeplinks (existing Outlook/Google Calendar pattern) suffice.

### Track F sequencing

1. **F0** governance decisions (owner) — gates F3; F1/F2 segments without private-space semantics may proceed in parallel.
2. **F1** office daily tools, in order F1-1 → F1-2 → F1-3 → F1-4.
3. **F2** documents & communication.
4. **F3** employee workspace.
5. **F4** ALF office tools (F4-1 needs vendor pick; F4-2/F4-3 can interleave earlier if owner prioritizes).
6. **F5** curated KB ingest after COL-34 and an updated integration spec; no bulk cutover.

**Spec files to create when promoted to build:** `35-office-suite.md` (F1/F2/F4) and `36-employee-workspace.md` (F3/F5) — numbered to avoid the `30`–`34` slice-record filenames already in this folder. Until then, this section is the authoritative scope statement for Track F.

---

## 3. What's next, in order

1. **Finish remaining Track A UAT** (owner-led: A3 §B–§E depth, A6 waivers as needed). **A5 remains PASS.** Complete the separate current BAA/HIPAA controls evidence refresh before PHI rollout, without inferring that a missing local contract copy means no agreement exists.
2. **Homewood acceptance and adoption:** resolve clinical source data and staff access with Homewood staff, then record depth UAT; run RLS-02 against the current multi-facility target before Oakridge goes live.
3. **Records & Data:** resolve COL-34, then update the integration spec for curated SharePoint/Drive KB ingest. F0-1 through F0-4 are already ratified; F3-1, F3-2, and F3-4 stay frozen.
4. **Remaining Track F:** eFax requires a vendor decision. Prioritize adoption of shipped workflow tools before expanding scope.

---

## 4. Maintenance rules for this file

- New workstreams land here first as a track section, then graduate to numbered specs.
- Update the **next free migration number** in §1 whenever DDL ships.
- When a track closes, collapse its row to a one-line pointer at its closure record.
- `docs/roadmap-overview.md` stays orientation-only; this file and module specs are authoritative (per `.cursor/rules/col-roadmap-context.mdc`).
