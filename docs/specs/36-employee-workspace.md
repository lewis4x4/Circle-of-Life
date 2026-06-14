# Module 36 — Employee Workspace (Track F3/F5)

Personal "Notion-style" workspace for staff: private-by-default notes/pages and files,
publish-to-group governance, team spaces, and OCE-integrated kanban. Grows one section per
Track F3/F5 segment. Authoritative scope: `docs/specs/UNIFIED-ROADMAP.md` §2.

## F0 governance (RATIFIED 2026-06-12) — binding on every private-content table

- **F0-1 break-glass:** owner/org_admin can access private content **only** via a typed-reason,
  audit-logged break-glass grant. Ships **in the same segment as the first private-content
  table** (F3-1), never as a follow-up.
- **F0-2 audit + retention:** `haven_capture_audit_log` + soft deletes (`deleted_at`) +
  retention on all private-content tables from their first migration. No hard deletes.
- **F0-3 offboarding:** private content transfers to the employee's manager or moves to a
  legal-hold archive — never deleted silently. Per-item ownership transfer is a primitive in
  F3-1; bulk offboarding orchestration composes it later.
- **F0-4 publish governance:** draft → submit → facility_admin/DON review → publish into KB.
  (F3-3.)

---

## F3-1 — Personal notes/pages (`/admin/workspace`)

**Segment:** `F3-1-personal-notes-pages` · **Shipped:** 2026-06-13

### Problem

Staff keep shift reports, 1:1 notes, incident follow-ups, and meeting notes in personal
notebooks and Google Docs — off-platform, unauditable, lost at offboarding.

### Scope (this segment)

Private-by-default pages with templates, version history, single-editor lock, and the F0-1
break-glass path:

- `src/lib/office/workspace.ts` — template catalog + seed bodies, types.
- `/admin/workspace` — "my pages" list + create-from-template.
- `/admin/workspace/[id]` — editor (title/body), save (writes a version + bumps `version`),
  version history viewer, and — for owner/org_admin viewing someone else's private page — the
  break-glass dialog (typed reason → grant insert → reload).

### DDL — `supabase/migrations/296_workspace_pages.sql`

- `workspace_pages` — owner, title, body, `template_kind`, `visibility` (private now;
  team/org reserved for F3-3/F3-4), single-editor lock columns, `version`.
- `workspace_page_versions` — immutable history.
- `workspace_breakglass_grants` — generic resource pointer (page/file/card), `reason NOT NULL`,
  `expires_at` (24h default).
- RLS: owners fully manage their own pages; **break-glass read** requires a live grant the
  accessor created; owner/org_admin can **transfer ownership** (F0-3). Audit triggers on pages
  + grants (F0-2); versions/grants immutable; soft deletes only.

### Deliberately deferred

- Rich-text/markdown rendering — plain `textarea` body in v1 (publish-to-KB in F3-3 handles
  formatted output).
- Bulk offboarding orchestration — per-item transfer primitive ships here; the
  deactivation-driven sweep is a later segment.
- Realtime co-editing — explicitly out of scope (lock + version history cover v1).

### Acceptance

- Create a page from a template; edit + save creates a version; history lists versions; a
  non-owner owner/org_admin must enter a reason to break-glass read.
- Gate: `npm run segment:gates -- --segment "F3-1-personal-notes-pages" --ui` PASS.

---

## F3-2 — Private file drive (`/admin/files`)

**Segment:** `F3-2-private-file-drive` · **Shipped:** 2026-06-13

### Problem

Staff store license scans, training certs, and working documents on personal drives — invisible
to the org and lost at offboarding.

### Scope (this segment)

Owner-private file drive with folders, upload, signed-URL download, and soft delete:

- `src/lib/office/workspace-files.ts` — bucket constant, path builder
  (`{owner}/{file_id}/{filename}`), filename sanitizer, byte formatter.
- `/admin/files` — upload (client → Storage), folder chips, open (120s signed URL), delete.

### DDL — `supabase/migrations/297_workspace_files.sql`

- `workspace_files` metadata (owner, name, `storage_path`, mime, size, folder, visibility).
- Storage bucket `workspace-files` (private, 50MB, office mime allow-list).
- **Reuses** `workspace_breakglass_grants` (`resource_type='workspace_file'`). The object path
  embeds the `file_id` as the 2nd folder so a single storage RLS policy enforces typed-reason
  break-glass (`foldername[2]` = a live grant's `resource_id`). Owner-only otherwise.
- RLS on metadata mirrors pages (owner manage + break-glass read + admin ownership transfer);
  audit trigger, `updated_at`, soft deletes (F0-2).

### Deliberately deferred

- Admin "browse another employee's drive" UI — break-glass is enforced at the data/storage
  layer here; the picker composes into the offboarding/admin segment.
- In-app preview / thumbnails — open via signed URL in a new tab for v1.
- Versioned re-upload — new file per upload; document versioning lives in the KB.

### Acceptance

- Upload a file into a folder; it lists; open returns a working signed URL; delete soft-deletes
  metadata and removes the object; storage RLS blocks cross-user reads without a grant.
- Gate: `npm run segment:gates -- --segment "F3-2-private-file-drive" --ui` PASS.

---

## F3-3 — Publish-to-group workflow (F0-4) (`/admin/workspace/publish-queue`)

**Segment:** `F3-3-publish-to-group` · **Shipped:** 2026-06-13

### Problem

Good staff write-ups stay trapped as private notes. Promoting them org-wide must be **governed**
(F0-4) — not a one-click broadcast — so the KB stays authoritative.

### Scope (this segment)

`draft → submit → facility_admin/DON review → publish into KB`:

- `src/lib/office/publish.ts` — status tones, audience list, reviewer-role check, word count.
- `/admin/workspace/[id]` — owner "Publish to group" panel (audience + rationale → submit);
  shows current publish status; re-submit allowed after rejection.
- `/admin/workspace/publish-queue` — reviewer queue: expand to read the snapshot, approve
  (creates a `public.documents` KB row, `source='workspace_publish'`, `status='published'`,
  links `published_document_id`) or reject with a note.

### DDL — `supabase/migrations/298_workspace_publish_requests.sql`

- `workspace_publish_requests` — page FK, requester, **immutable title/body snapshot**, target
  audience, rationale, status (`submitted`/`approved`/`rejected`/`published`), reviewer + notes
  + `reviewed_at`, `published_document_id` FK → `documents`.
- RLS: requester sees own; reviewers (`owner`/`org_admin`/`facility_admin`/`manager` = DON tier)
  see the queue + transition status; authors may only submit for a page they own. Audit
  trigger, `updated_at`, soft deletes.

### Deliberately deferred

- Editing the page from the queue — reviewers approve/reject the snapshot; edits go back to the
  author (re-submit after rejection).
- Auto-embedding wait/status surfacing — the KB ingest pipeline picks up the new document; the
  queue marks it published without polling chunk status.
- Team-scoped publish (vs org KB) — composes with F3-4 team spaces.

### Acceptance

- Owner submits a page; a reviewer sees it, approves; a `documents` row is created and the
  request shows `published`; reject path records a note and lets the author re-submit.
- Gate: `npm run segment:gates -- --segment "F3-3-publish-to-group" --ui` PASS.

---

## F3-4 — Team spaces (`/admin/teams`)

**Segment:** `F3-4-team-spaces` · **Shipped:** 2026-06-13

### Problem

Some notes should be shared with a department or project group — broader than private, narrower
than the org-wide KB.

### Scope (this segment)

Spaces with membership + page sharing:

- `src/lib/office/teams.ts` — types + user-label resolver.
- `/admin/teams` — list my spaces + create (creator auto-added as `lead`).
- `/admin/teams/[id]` — manage members (add org users, remove), view pages shared into the space.
- `/admin/workspace/[id]` — owner "Team space" selector shares a page (`visibility='team'` +
  `team_space_id`) or returns it to private.

### DDL — `supabase/migrations/299_workspace_team_spaces.sql`

- `team_spaces`, `team_space_members` (UNIQUE per space+user, `member`/`lead` role), and
  `workspace_pages.team_space_id` column.
- RLS: members + admins see their spaces/rosters; any staff create a space; creator/lead/admin
  manage membership; **team members read pages** where `visibility='team'` and they belong to
  the page's space — the author still owns/edits (single-editor model). Audit triggers,
  `updated_at`, soft deletes.

### Deliberately deferred

- Team-shared files (vs pages) — pages first; file sharing reuses the same membership join later.
- Co-editing within a space — read-shared in v1, consistent with F3-1 single-editor lock.
- Nested/sub-spaces — flat spaces only.

### Acceptance

- Create a space; add a member; share a page to it; the member can read it; removing membership
  revokes read.
- Gate: `npm run segment:gates -- --segment "F3-4-team-spaces" --ui` PASS.

---

## F3-5 — Personal kanban (`/admin/kanban`)

**Segment:** `F3-5-personal-kanban` · **Shipped:** 2026-06-13

### Problem

Staff juggle their own to-dos plus assigned operational (OCE) tasks across separate screens.

### Scope (this segment)

A private three-column board that also reflects the user's live OCE workload:

- `src/lib/office/kanban.ts` — columns, status mapping, move helpers, priority tones.
- `/admin/kanban` — add personal cards to "To do", move left/right between columns, delete; the
  user's open OCE task instances appear **read-only** in their mapped columns (badged "OCE").

### DDL — `supabase/migrations/300_workspace_cards.sql`

- `workspace_cards` — owner, title/details, status (`todo`/`in_progress`/`done`), position,
  due date, optional `source_oce_instance_id` (context link, not ownership).
- RLS: owner-private (select/insert/update own only); audit trigger, `updated_at`, soft deletes.

### Deliberately deferred

- Drag-and-drop — left/right move buttons in v1 (keyboard-accessible, no DnD dependency).
- Acting on OCE tasks from the board — OCE remains the system of record; completion (with its
  dual-sign/evidence rules) stays in the Operations queue. The board only mirrors them.
- Cross-user/shared boards — personal only here.

### Acceptance

- Add a card; move it To do → In progress → Done; delete it; assigned OCE tasks show read-only
  in the correct columns.
- Gate: `npm run segment:gates -- --segment "F3-5-personal-kanban" --ui` PASS.

---

## F3-6 — Shift handoff board (`/admin/handoff`)

**Segment:** `F3-6-shift-handoff-board` · **Shipped:** 2026-06-13

### Problem

Shift-to-shift handoff happens verbally or on a whiteboard — nothing durable, nothing the
incoming shift can confirm they received.

### Scope (this segment)

A facility-shared board scoped to a shift date + shift:

- `src/lib/office/handoff.ts` — shift/category maps, ET `currentShift`/`todayEtIso` defaults,
  priority tones.
- `/admin/handoff` — date + shift selector (defaults to now in ET), post a note (category,
  priority, optional resident), incoming staff **acknowledge** each note; unacknowledged count
  in the header; critical/high sorted first.

### DDL — `supabase/migrations/301_shift_handoff_notes.sql`

- `shift_handoff_notes` — shift_date, shift (`day`/`evening`/`night`), category, optional
  `resident_id`, note, priority, `acknowledged_by`/`acknowledged_at`.
- RLS: all facility staff read/post/acknowledge in accessible facilities (shared operational
  board). Audit trigger (resident-linkable), `updated_at`, soft deletes.

### Deliberately deferred

- Auto-rollover of unacknowledged notes to the next shift — manual date/shift navigation in v1.
- Per-note threaded replies — F3-7 comments will generalize discussion.
- Push/notification on critical handoff — surfaced in-board for now.

### Acceptance

- Post a note on the current shift; switch shift/date to scope the board; another user
  acknowledges; the open count drops.
- Gate: `npm run segment:gates -- --segment "F3-6-shift-handoff-board" --ui` PASS.

---

## F3-7 — Comments + @mentions (`/admin/mentions`)

**Segment:** `F3-7-comments-mentions` · **Shipped:** 2026-06-13

### Problem

Workspace items (pages, cards, handoff notes, spaces) had no way to discuss in context or loop
a colleague in.

### Scope (this segment)

A generic comment thread + mentions:

- `src/lib/office/comments.ts` — types + label/subject maps.
- `src/components/office/comments-thread.tsx` — reusable thread (load, post, "Notify" people
  picker for `@mentions`), embedded in `/admin/workspace/[id]`.
- `/admin/mentions` — "My mentions" inbox (`mentioned_user_ids` contains me), deep-linked to
  the subject.

### DDL — `supabase/migrations/302_workspace_comments.sql`

- `workspace_comments` — polymorphic `subject_type`/`subject_id`, author, body,
  `mentioned_user_ids uuid[]` (GIN-indexed for mentions).
- **RLS inherits subject visibility:** a comment is readable only if the reader is the author,
  is `@mentioned`, or can `SELECT` the subject row — and RLS subqueries are themselves
  RLS-filtered, so a private page's comments stay private automatically. Insert requires the
  author can see the subject. Audit trigger, `updated_at`, soft deletes.

### Deliberately deferred

- Inline `@token` parsing in the body — explicit "Notify" people-picker in v1 for reliable,
  unambiguous mention targeting.
- Threaded replies / reactions — flat chronological thread first.
- Real-time push on mention — surfaced via the `/admin/mentions` inbox; notification fan-out
  is a later wire-up using the denormalized `mentioned_user_ids`.

### Acceptance

- Comment on a page; notify a colleague; they see it under My mentions; a user who cannot see
  the page cannot see its comments (RLS inheritance).
- Gate: `npm run segment:gates -- --segment "F3-7-comments-mentions" --ui` PASS.
