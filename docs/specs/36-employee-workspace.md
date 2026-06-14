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
