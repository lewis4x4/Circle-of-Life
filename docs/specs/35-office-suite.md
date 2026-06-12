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

## Later F1/F2/F4 sections

Added per segment as they are built (F1-2 morning huddle, F1-3 meeting hub, F1-4 master calendar,
F2-1 letter generator, F2-2 forms builder, F2-3 e-signature/read-ack, F2-4 contact directory,
F4-2 front desk kit, F4-3 petty cash + trust ledger, F4-4 survey binder, F4-1 eFax — blocked on
owner vendor pick).
