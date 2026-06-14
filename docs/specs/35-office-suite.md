# Module 35 — Office Suite (Track F: F1 / F2 / F4)

**Status:** PARTIAL — grows one section per Track F segment (per `TRACK-F-BUILD-HANDOFF.md` SPEC-FIRST rule)
**Created:** 2026-06-12
**Scope authority:** `docs/specs/UNIFIED-ROADMAP.md` §2 (Track F)
**Companion spec:** `36-employee-workspace.md` (F3 / F5 — created when the first F3/F5 segment starts)

> Office daily tools for management and officers: approvals, briefings, meetings, calendars,
> document generation, forms, signatures, directories, and ALF-specific office workflows.
> Reuse mandate is binding: no parallel systems — existing tables, KB, OCE, Storage RLS,
> `dispatch-push` only.

---

## F1-1 — Unified approvals inbox (`/admin/approvals`)

**Segment:** `F1-1-unified-approvals-inbox` · **Shipped:** 2026-06-12

### Problem

Approval work is scattered across `/admin/shift-swaps`, `/admin/time-records`,
`/admin/transportation/mileage-approvals`, and `/admin/knowledge/admin` (KB review).
An administrator has no single "waiting on me" view, so requests sit unactioned.

### Scope (this segment)

One read-mostly aggregation page at `src/app/(admin)/admin/approvals/page.tsx` that lists
**pending** items from sources that already have approval semantics, with one-tap actions that
perform the **same writes the source hubs perform** (no new mutation paths, no new tables).

### DDL

**None.** Existing tables only. RLS, audit triggers, and soft-delete behavior of each source
table apply unchanged.

### Sources (v1)

| Source | Pending predicate | Actions | Write semantics (identical to source hub) |
|--------|-------------------|---------|-------------------------------------------|
| `shift_swap_requests` | `status = 'pending' AND deleted_at IS NULL` | Approve / Deny (reason required) | `status='approved', approved_at, approved_by` · `status='denied', denied_reason` |
| `time_records` | `approved = false AND clock_out IS NOT NULL AND deleted_at IS NULL` | Approve | `approved=true, approved_at, approved_by, updated_by` |
| `mileage_logs` | `approved_at IS NULL AND deleted_at IS NULL` | Approve | `approved_at, approved_by, updated_by`; client-side role gate matches mileage hub (`owner`, `org_admin`, `facility_admin`, `nurse`) |
| `documents` (KB) | `status = 'pending_review'` | **Link-out only** → `/admin/knowledge/admin/review/[id]` | None from the inbox — F0-4 requires a real review (draft → review → publish), so publish stays on the KB review surface |

### Deliberately deferred (recorded so it isn't re-litigated)

- **Invoices** — no pending-approval state exists in the billing schema today; add as a source
  when invoice approval semantics ship.
- **Leave requests** — no leave-request table exists; add as a source with its module.
- **Form submissions** — arrive with F2-2 (internal forms builder); that segment extends this inbox.

### UI

- Route: `/admin/approvals` (App Router, `(admin)` route group; client component following the
  existing admin hub pattern: `useFacilityStore` scoping, `AdminFilterBar`-style summary,
  design-token classes only).
- KPI strip: per-source pending counts + total "waiting on me".
- Grouped list sections (Shift swaps / Time punches / Mileage / KB publish reviews), each row with
  context (who, when, amount/hours where relevant) + action buttons + link to the source hub.
- Deny (shift swaps) opens the same reason dialog pattern as `/admin/shift-swaps`; reason is stored
  on the record for audit.
- Facility selector scoping: `shift_swap_requests`, `time_records`, `mileage_logs` filter by
  `facility_id` when a facility is selected; KB documents are organization-scoped
  (`workspace_id`) and labeled as such.
- Nav: "Approvals inbox" item in the AdminShell **Command** group.

### RLS / security

No new policies. All reads and writes go through the user's session client, so existing
RLS on each source table governs visibility and update rights. The inbox never widens access:
a user who cannot approve on the source hub cannot approve here (the update fails at RLS and the
mileage role gate hides the buttons client-side, same as the source page).

### Acceptance

- Page loads with all four source counts; each actionable row approves/denies with the same
  resulting row state as the source hub would produce.
- A denied shift swap requires a non-empty reason.
- KB pending-review rows navigate to the existing review page; no publish action exists on the inbox.
- Gate: `npm run segment:gates -- --segment "F1-1-unified-approvals-inbox" --ui` PASS artifact.

---

## F1-2 — Morning huddle / daily briefing (`/admin/briefing`)

**Segment:** `F1-2-morning-huddle-briefing` · **Shipped:** 2026-06-12

### Problem

Stand-up meetings run off scattered hub pages and a paper notebook. The facility-level sibling of
the executive standup packet: one per-facility page, printable as a one-pager, covering what the
day shift needs to know at 8am.

### Scope (this segment)

- `src/app/(admin)/admin/briefing/page.tsx` — per-facility daily briefing (facility selection
  required; America/New_York calendar day).
- `src/lib/office/morning-huddle.ts` — aggregation over existing tables via the session client
  (RLS governs); `src/lib/office/morning-huddle-print.ts` — standalone print HTML (same pattern
  as the executive standup board print document); Print button opens it in a new window and
  invokes the browser print dialog.
- Nav: "Morning huddle" in the AdminShell **Command** group.

### DDL

**None.** Read-only aggregation; no writes.

### Sections / sources

| Section | Source | Predicate |
|---------|--------|-----------|
| Overnight incidents | `incidents` | `occurred_at >=` now − 24h, facility-scoped; AHCA-reportable flagged |
| Current census | `residents` | count where `deleted_at IS NULL AND discharge_date IS NULL` |
| Census moves | `residents` | `admission_date = today` (move-in), `discharge_date = today` (move-out), `discharge_target_date = today` (planned) |
| Today's shift roster | `shift_assignments` + `staff` | `shift_date = today`, grouped by `shift_type`; `called_out` / `no_show` highlighted |
| Open ops tasks | `operation_task_instances` (OCE — reuse mandate) | `assigned_shift_date <= today AND status IN (pending, in_progress, missed)` |
| Med flags | `emar_records` + `residents` | last 24h with `status IN (refused, held, not_available)`; plus count of `scheduled` doses past due |

### Deliberately deferred

- Stored PDF snapshots in Storage (executive standup pattern) — print HTML covers the daily
  one-pager; revisit if huddle history needs to be retained as documents.
- Editable huddle notes / action items — F1-3 (meeting hub) owns minutes and action items.

### Acceptance

- With a facility selected, all six sections render live counts; print button produces a
  self-contained one-pager with the same data.
- No facility selected → explicit prompt, no queries.
- Gate: `npm run segment:gates -- --segment "F1-2-morning-huddle-briefing" --ui` PASS artifact.

---

## F1-3 — Meeting hub (`/admin/meetings`)

**Segment:** `F1-3-meeting-hub` · **Shipped:** 2026-06-12

### Problem

Standups, QA committee, and safety committee meetings run from `2026 Standup Call Log.xlsx` and
paper notes. Minutes are survey evidence and action items die without follow-through.

### DDL — migration `289_office_meetings.sql`

| Table | Purpose | Notes |
|-------|---------|-------|
| `meeting_templates` | Recurring meeting definitions (standup, QA, safety committee) | `cadence` check (`daily`…`ad_hoc`); `default_agenda jsonb` string array |
| `meetings` | Meeting instances | `status` check (`scheduled`/`in_progress`/`completed`/`cancelled`); `agenda`/`attendees` jsonb string arrays; `minutes text`; `chaired_by` |
| `meeting_action_items` | Action items captured in a meeting | `status` (`open`/`completed`/`cancelled`); `oce_task_instance_id` FK → `operation_task_instances` |

All three: RLS enabled before data (org → `haven.accessible_facility_ids()`), audit triggers
(`haven_capture_audit_log` — minutes are survey evidence per F0-2 spirit), soft deletes
(`deleted_at`, **no DELETE policies**), `haven_set_updated_at` triggers, UUID PKs, denormalized
`organization_id` + `facility_id`, UTC. Create/update limited to
`owner/org_admin/facility_admin/manager/coordinator/nurse`; action-item assignees may update
their own items.

### OCE coupling (reuse mandate)

Adding an action item **creates an `operation_task_instances` row**
(`template_category='meeting_action'`, `template_cadence_type='event_driven'`,
`assigned_shift_date = due_date`, `status='pending'`) and stores its id on the action item —
the existing escalation machinery chases it. Completing the action item completes the linked
OCE instance. No parallel task system.

### UI

- `/admin/meetings` — hub: KPIs (upcoming, completed this month, open action items), template
  list + inline create (name, cadence, default agenda), meetings list.
- `/admin/meetings/new` — create from template (prefills title + agenda) or blank; agenda and
  attendees entered one per line.
- `/admin/meetings/[id]` — status transitions (start / complete / cancel), agenda, attendees,
  minutes editor (audit-logged on save), action items add/complete with assignee picker
  (`user_profiles` active users) and due date.
- Nav: "Meeting hub" in AdminShell **Command** group.
- Shared helpers in `src/lib/office/meetings.ts`.

### Deliberately deferred

- Automatic recurrence spawning (template → scheduled instances) — manual create-from-template
  covers v1; revisit with the F1-4 calendar.
- `grace-transcribe` → draft minutes (roadmap optional).
- Publishing minutes to the KB (F0-4 review flow) — F3-3 territory.

### Acceptance

- Template create → meeting create from template prefills agenda; minutes save and persist;
  action item add creates a linked OCE task instance; completing the item completes the task.
- Gate: `npm run segment:gates -- --segment "F1-3-meeting-hub" --ui` PASS artifact;
  `migrations:verify:pg` replay (Docker locally unavailable → CI `REQUIRE_PG_VERIFY=1` replays).

---

## F1-4 — Facility master calendar (`/admin/calendar`)

**Segment:** `F1-4-facility-master-calendar` · **Shipped:** 2026-06-12

### Problem

Dated obligations live on six different hubs; nothing shows "what is happening at this facility
this month" in one place.

### Scope (this segment)

Read-only month calendar at `src/app/(admin)/admin/calendar/page.tsx` with toggleable layers,
day drill-down list (rows deep-link to source hubs where a detail page exists), and `.ics`
export of the loaded window (`src/lib/office/master-calendar.ts`, RFC 5545 conventions copied
from the transportation calendar export — TZID for timed events, `VALUE=DATE` for all-day).

### DDL

**None.** Read-only aggregation through the session client; existing RLS on every source.

### Layers / sources

| Layer | Source | Date field |
|-------|--------|-----------|
| Transportation | `resident_transport_requests` (+ resident name) | `appointment_date` / `appointment_time` |
| Meetings | `meetings` (F1-3) | `scheduled_at` (ET day + time) |
| In-services | `inservice_log_sessions` | `session_date` |
| Drills & emergency checks | `emergency_checklist_items` (fire/evacuation/generator) | `next_due_date` |
| Document expirations | `facility_documents` (license/insurance vault — same source the `facility-expiration-scanner` Edge Function reads) | `expiration_date` |
| Survey history | `facility_survey_history` | `survey_date` |

### Deliberately deferred

- Vendor visits and family conferences — no dated tables exist yet; add as layers with their
  modules (F2-4 / Module 19, Module 21).
- Forward survey-window projection (predicted next-survey range) — survey history is shown;
  projection belongs to compliance analytics.
- Event creation from the calendar — sources own their create flows.

### Acceptance

- Month grid renders all six layers for the selected facility; layer toggles filter both grid
  and `.ics` export; day click lists events with deep links.
- Gate: `npm run segment:gates -- --segment "F1-4-facility-master-calendar" --ui` PASS artifact.

---

## F2-1 — Letter & document generator (`/admin/letters`)

**Segment:** `F2-1-letter-document-generator` · **Shipped:** 2026-06-12

### Problem

Rate-increase notices, family letters, DCF/payee correspondence, and employment verifications
are typed by hand in Word with no copy of record in the resident or employee file.

### Scope (this segment)

Mail-merge templates rendered on facility letterhead with an immutable generated-letter log:

- `src/lib/office/letters.ts` — merge-field map (`{{resident.*}}`, `{{staff.*}}`,
  `{{facility.*}}`, `{{today}}`), `renderLetterBody` (unknown fields stay visible),
  letterhead print HTML (browser print-to-PDF — repo convention, no PDF dependency).
- `/admin/letters` — template list + inline template editor (category, merge subject, plain-text
  body with field reference) and the generated-letters log with per-row reprint.
- `/admin/letters/generate` — template + subject pickers, live merge preview, "Generate, log &
  print" inserts the `generated_letters` row then opens the print view.

### DDL — `supabase/migrations/290_office_letters.sql`

- `letter_templates` — name, category (`rate_increase` | `family` | `dcf_payee` |
  `employment_verification` | `general`), `subject_kind` (`resident` | `staff` | `none`), body.
- `generated_letters` — template snapshot (`template_name`, `category`), single-subject check
  (`resident_id` XOR `staff_user_id`, both nullable), `rendered_body` stored **verbatim** at
  generation time (legal copy of record; later template edits never change what was sent),
  `merge_values` jsonb for traceability.
- Both: RLS office/admin roles only (`owner`/`org_admin`/`facility_admin`/`manager`/
  `coordinator`), audit triggers, `updated_at` triggers, soft deletes. `generated_letters` has
  no general UPDATE policy — only owner/org_admin soft delete; the rendered body is immutable
  in practice and audit-logged.

### Deliberately deferred

- Rich text / DOCX letterhead upload — plain text on a structured letterhead covers the four
  named letter types; revisit if owners need styled bodies.
- Surfacing the letter log on resident/staff profile pages — the rows carry `resident_id` /
  `staff_user_id` so a profile tab is a later read-only join.
- Bulk merge (e.g. rate increase to all private-pay residents) — one-at-a-time first; bulk is
  a follow-up segment if the office asks.

### Acceptance

- Template with merge fields renders correct preview for a selected resident/staff member;
  generation inserts a `generated_letters` row and opens the letterhead print view; hub log
  reprints the stored body verbatim.
- Gate: `npm run segment:gates -- --segment "F2-1-letter-document-generator" --ui` PASS artifact.

---

## F2-2 — Internal forms builder (`/admin/forms`)

**Segment:** `F2-2-internal-forms-builder` · **Shipped:** 2026-06-12

### Problem

Maintenance requests, supply requests, grievances, and refund requests arrive as paper slips,
texts, and hallway conversations — no queue, no status, no evidence trail.

### Scope (this segment)

Admin-built forms with a jsonb field schema and a per-facility status-tracked queue:

- `src/lib/office/internal-forms.ts` — field/category types, defensive `parseFields`,
  label→key slugging, status tones.
- `/admin/forms` — inline form builder (label/type/required per field; dropdown options;
  types: short text, long text, number, date, dropdown), forms list with "Fill out" links,
  and the submission queue: status filter chips, expandable rows showing submitted values,
  start work / resolve / reject with resolution notes.
- `/admin/forms/submit?template=<id>` — staff-facing fill-out page rendered from the field
  schema with required-field validation.

### DDL — `supabase/migrations/291_office_internal_forms.sql`

- `internal_form_templates` — name, description, category (`maintenance` | `supply` |
  `grievance` | `refund` | `general`), `fields` jsonb (ordered field definitions), `is_active`.
- `internal_form_submissions` — template snapshot (`template_name`, `category`), `values`
  jsonb stored verbatim, status workflow `submitted → in_progress → resolved | rejected`,
  resolution notes + `resolved_at`/`resolved_by`, `submitted_by`/`submitted_at`.
- RLS: all facility staff read active templates and **submit**; submitters see their own
  submissions; office/admin roles (`owner`/`org_admin`/`facility_admin`/`manager`/
  `coordinator`) see and work the whole queue. Audit triggers on both tables (grievance
  intake is survey evidence), `updated_at` triggers, soft deletes only.

### Deliberately deferred

- Routing rules (e.g. maintenance → maintenance_role assignee) — single facility queue first;
  assignment/notification can reuse OCE or `dispatch-push` in a later segment.
- Template editing/versioning UI — submissions snapshot `template_name` + verbatim values, so
  templates can be superseded by creating a new one and deactivating the old.
- File attachments on submissions — needs Storage RLS design; not required for the four
  named form types' v1.

### Acceptance

- Build a form with mixed field types; staff submission lands in the queue with status
  `submitted`; admin can start work, resolve, or reject with notes; status filter works.
- Gate: `npm run segment:gates -- --segment "F2-2-internal-forms-builder" --ui` PASS artifact.

---

## F2-3 — E-signature + read-acknowledgment (`/admin/acknowledgments`)

**Segment:** `F2-3-esignature-read-acknowledgment` · **Shipped:** 2026-06-12

### Problem

No proof staff read updated policies/SOPs/handbook sections — a direct AHCA survey gap.

### Scope (this segment)

Per-role acknowledgment requirements layered on **published KB documents only** (F0-4: the
draft → review → publish flow is the sole path to staff-facing policy; this segment reads
`documents` where `status = 'published'` and never bypasses review):

- `src/lib/office/acknowledgments.ts` — role list (staff app_roles, excludes family/broker),
  outstanding-staff computation.
- `/admin/acknowledgments` — admin dashboard: create requirement (published-doc picker, role
  chips, e-signature vs mark-as-read, due date, note), per-requirement signed/outstanding
  counts with expandable name lists, deep link to the KB document.
- `/admin/acknowledgments/my` — staff view: "waiting on you" with read-document link and
  typed-name signature flow (attestation copy states the record is permanent), plus completed
  history.

### DDL — `supabase/migrations/292_office_document_acknowledgments.sql`

- `document_acknowledgment_requirements` — `document_id` → `public.documents`, title
  snapshot, `required_roles text[]`, `require_signature`, due date, active flag.
- `document_acknowledgments` — immutable signature log: typed `signature_name` verbatim,
  `signer_role` at signature time, `UNIQUE (requirement_id, user_id)`. **No UPDATE or DELETE
  policies at all** — signatures cannot be altered or soft-deleted even by admins;
  corrections happen by issuing a new requirement.
- RLS: staff read requirements and insert acknowledgments **for themselves only**
  (`user_id = auth.uid()`); admin/office roles read the dashboard. Audit triggers on both.

### Deliberately deferred

- Auto-requirement on KB publish/update events — manual issuance first; an Edge Function or
  trigger can create requirements on `documents.status` transitions later.
- Facility-precise eligibility (`user_facility_access` join) — outstanding lists count active
  org staff in required roles; accurate for the single-facility pilot, revisit at facility 2.
- In-service roster signatures — in-service sessions already capture attendees (D41–D43);
  pulling those rosters into this signature log is a follow-up.
- Push/notification chasing — can reuse `dispatch-push` later.

### Acceptance

- Requirement on a published doc shows correct signed/outstanding split; staff member signs
  once (unique constraint blocks repeats); signature row is immutable under RLS.
- Gate: `npm run segment:gates -- --segment "F2-3-esignature-read-acknowledgment" --ui` PASS.

---

## F2-4 — Contact directory + on-call (`/admin/contacts`)

**Segment:** `F2-4-contact-directory-on-call` · **Shipped:** 2026-06-13

### Problem

Pharmacy, hospice, physician, AHCA field office, and MCO case-manager numbers live on sticky
notes and in individual phones; after-hours coverage is unclear during an incident.

### Scope (this segment)

Per-facility rolodex + after-hours on-call schedule, both readable by all facility staff:

- `src/lib/office/contacts.ts` — category list, `activeOnCall` window helper.
- `/admin/contacts` — "On-call now" panel (active shifts highlighted, click-to-call,
  upcoming list, add shift) and the directory (category filter chips, click-to-call, inline
  add contact).

### DDL — `supabase/migrations/293_office_contact_directory.sql`

- `facility_contacts` — name, category (`pharmacy` | `hospice` | `physician` | `hospital` |
  `ahca` | `mco_case_manager` | `dcf` | `emergency_service` | `vendor` | `other`),
  org name, phone, after-hours phone, fax, email, address, notes, active flag.
- `on_call_shifts` — role label, covering user (nullable FK) + verbatim name, phone,
  `starts_at`/`ends_at` (CHECK end > start), notes.
- RLS: all facility staff **read** both (operational phone book); admin/office roles
  (`owner`/`org_admin`/`facility_admin`/`manager`/`coordinator`/`admin_assistant`) manage.
  Audit triggers, `updated_at` triggers, soft deletes only.

### Deliberately deferred

- Recurring on-call rotation generation — single shifts first; a rotation builder is a later
  enhancement.
- Overlap with Module 19 vendor contracts — this is the lighter operational layer by design;
  no attempt to unify the two in this segment.
- Editing/soft-deleting existing rows in the UI — create-first; row management is a follow-up.

### Acceptance

- Add a contact and an on-call shift; "On-call now" reflects the active window; category
  filter narrows the directory; click-to-call links render.
- Gate: `npm run segment:gates -- --segment "F2-4-contact-directory-on-call" --ui` PASS.

---

## F4-2 — Front desk kit (`/admin/front-desk`)

**Segment:** `F4-2-front-desk-kit` · **Shipped:** 2026-06-13

### Problem

Visitor sign-in sheets, package slips, and family-call notes are paper at the front desk — no
screening trail for infection control, no package custody record, no resident-linked call log.

### Scope (this segment)

Tabbed front-desk surface with three logs (visitors / packages & mail / family calls):

- `src/lib/office/front-desk.ts` — type/label maps, resident-name resolver.
- `/admin/front-desk` — visitor check-in with health screening + check-out, package logging
  with mark-delivered, and resident-linked family-call logging with follow-up flag. On-site
  visitor count + pending-package count in the header.

### DDL — `supabase/migrations/294_office_front_desk_kit.sql`

- `visitor_log_entries` — name, type, optional `resident_id`, purpose, check-in/out, and
  **infection-control screening** (`screening_passed`, `temperature_f`, `symptoms_reported`,
  notes) — the surveillance input the roadmap calls for.
- `package_log_entries` — recipient (optional `resident_id`), carrier, type, received/delivered
  custody timestamps + names.
- `family_call_log_entries` — required `resident_id`, caller + relationship, direction,
  summary, follow-up flag.
- RLS: any facility staff record + read (front desk is shared); audit triggers on all three
  (resident-linked + IC data), `updated_at` triggers, soft deletes only.

### Deliberately deferred

- Writing visitor screening into the infection-control surveillance tables — screening is
  captured on the entry; an IC rollup/Edge sync is a later linkage.
- Badge printing / kiosk self-sign-in — staff-operated check-in first.
- Package photo capture — needs Storage RLS (shared with F4-3 receipt capture design).

### Acceptance

- Check a visitor in and out; flag symptoms → screening flag shows; log + mark a package
  delivered; log a resident family call with follow-up.
- Gate: `npm run segment:gates -- --segment "F4-2-front-desk-kit" --ui` PASS.

---

## F4-3 — Petty cash + resident trust ledger (`/admin/cash`)

**Segment:** `F4-3-petty-cash-resident-trust` · **Shipped:** 2026-06-13

### Problem

Petty cash and resident personal-needs/trust funds (Representative Payee / SSA-787) are tracked
on paper — no audited ledger, a real survey and fiduciary risk.

### Scope (this segment)

Two cents-based ledgers behind a tab switch at `/admin/cash`:

- `src/lib/office/ledgers.ts` — category maps, signed-delta helpers; reuses
  `src/lib/finance/format-cents.ts` (`formatCents`, `parseDollarsToCents`).
- Petty cash tab — open a drawer, post credit/debit with category + optional resident, running
  balance shown per entry.
- Resident trust tab — open a per-resident account (Rep Payee / SSA-787 flags), post
  deposit/withdrawal (withdrawals blocked below zero), per-account ledger with running balance.

### DDL — `supabase/migrations/295_office_cash_trust_ledgers.sql`

- `petty_cash_accounts` + `petty_cash_transactions`; `resident_trust_accounts` (UNIQUE per
  resident) + `resident_trust_transactions`. **Money in integer cents** (`amount_cents > 0`,
  `balance_after_cents` for an auditable running total). Ledger tables are **insert-only — no
  UPDATE/DELETE policies** (immutable financial record). `receipt_path` column reserved for a
  Storage object (capture UI deferred).
- RLS: finance/office roles only (`owner`/`org_admin`/`facility_admin`/`manager`/
  `admin_assistant`). Audit triggers on all four tables; `updated_at` on the account tables.

### Deliberately deferred

- Receipt photo capture — column exists; upload needs Storage RLS (shared design with F4-2).
- Transactional post via RPC — current flow inserts the immutable ledger row then updates the
  denormalized account balance; a single `rpc` wrapping both is a hardening follow-up.
- Statement/period export PDF — ledger is on screen; export joins the F4-4 binder / Module 26.

### Acceptance

- Open a drawer, post a disbursement and replenishment; balance + running totals correct.
- Open a resident trust account, deposit then withdraw; withdrawal beyond balance blocked;
  ledger immutable under RLS.
- Gate: `npm run segment:gates -- --segment "F4-3-petty-cash-resident-trust" --ui` PASS.

---

## Later F1/F2/F4 sections

Added per segment as they are built (
F2-1 letter generator, F2-2 forms builder, F2-3 e-signature/read-ack, F2-4 contact directory,
F4-2 front desk kit, F4-3 petty cash + trust ledger, F4-4 survey binder, F4-1 eFax — blocked on
owner vendor pick).
