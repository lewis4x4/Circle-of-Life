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

## Later F1/F2/F4 sections

Added per segment as they are built (F1-4 master calendar,
F2-1 letter generator, F2-2 forms builder, F2-3 e-signature/read-ack, F2-4 contact directory,
F4-2 front desk kit, F4-3 petty cash + trust ledger, F4-4 survey binder, F4-1 eFax — blocked on
owner vendor pick).
