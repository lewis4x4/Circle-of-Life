# Authenticated Document Intake — Implementation Plan & UX States

**Date:** 2026-05-05
**Scope:** Replace the standalone `facility-launch-center` document register with the real authenticated upload → parse → review → apply flow inside the Haven Next.js app, wired to the already-deployed `ingest` + `facility-launch-parser` Edge Functions and the `document_*` / `facility_launch_module_values` schema (migration `216_facility_launch_document_parser.sql`).
**Audience:** Non-technical onboarding users (Document Custodian, ED, CFO). They sign in to Haven; everything else is invisible plumbing.
**Mode:** Planning only. No source files modified.
**Author:** JARVIS

---

## Context / Scope

The current standalone register (`facility-launch-center/src/app.js` lines ~445–586, plus `documentIntelligence.js` + `supabasePipeline.js`) leaks the production architecture in three places that a non-technical custodian should never see:

1. **A "Connect Supabase OCR/AI pipeline" config panel** that asks for Supabase URL, anon key, current user JWT, organization UUID, and facility UUID (`app.js:445–475`, `supabasePipeline.js:1–82`). Five fields no operator can produce.
2. **A "Local draft workbook — not auto-writing to Supabase" disclaimer** (`app.js:453`). Translation: *"this thing you're using isn't real."*
3. **Filename-only classification** (`documentIntelligence.js:69–101`) running locally even when the production parser is available, so the "AI" experience is a regex on the file name.

Meanwhile the production back end — already shipped — does the real work:

- `supabase/functions/ingest` accepts the multipart upload, stores the file, runs OCR/Markdown extraction (`pdf-parse`, `mammoth`, `xlsx`, `turndown`), creates a `documents` row.
- `supabase/functions/facility-launch-parser` reads `documents.markdown_text/raw_text`, runs Claude Haiku 4.5 OR a heuristic fallback, writes typed `document_extracted_facts` rows with confidence + evidence excerpt + proposed module/field, and exposes `parse_document` / `list_document_facts` / `approve_fact` / `reject_fact` / `apply_fact` / `approve_and_apply_fact` actions.
- Migration `216_facility_launch_document_parser.sql` already enforces RLS: org-scoped read for authenticated users, write only for `owner | org_admin | facility_admin`. PHI auditing + provenance is wired through `haven_capture_audit_log`.

The Haven app already has the right shell (`src/components/layout/OnboardingShell.tsx` — sticky header, nav, sign-out, `useOnboardingStore` hydrate) and the right route group (`src/app/(onboarding)/`). The active `Onboarding Command Center` nav is just three items: **Overview / Departments / Questions**. We add a fourth: **Documents**.

The plan below moves the authoritative intake experience into that authenticated route, retires the standalone page's config panel + filename classifier, and stages every status the operator actually needs to see.

---

## Plan

### 1. Routing and shell

**Add a new authenticated route** under the existing onboarding shell:

```
src/app/(onboarding)/onboarding/documents/page.tsx          (list / overview)
src/app/(onboarding)/onboarding/documents/[documentId]/page.tsx (per-doc review)
```

**Edit:** `src/components/layout/OnboardingShell.tsx` — extend `NAV_ITEMS` with:

```ts
{ href: "/onboarding/documents", label: "Documents", icon: FileText }
```

**Retire / fence off** `src/app/facility-launch/page.tsx`. Two acceptable options; I recommend (b):

  (a) Hard-redirect to `/onboarding/documents` (server redirect in `page.tsx`).
  (b) Keep the route but render a banner that says *"This is the read-only field-prep workbook; the live document intake lives in your authenticated Haven session →"* with a CTA to `/onboarding/documents`. Useful for the 0-config sales demo posture; never used by COL operators in production.

**Auth & role gating:**
- The `(onboarding)` group already calls `useOnboardingStore().hydrate()` which fetches the user's organization. Reuse that gate.
- The Edge functions already require `owner | org_admin | facility_admin`. Mirror that on the client by reading `app_role` from the existing onboarding store and rendering a "read-only — request access" empty state for `caregiver`/`med_tech`/etc. (We do not need a new RBAC layer.)

**Active facility context:** read from `useFacilityStore` (already exists in `src/hooks/useFacilityStore.ts`). One header chip in the page: *"Acting on Homewood Lodge ALF · switch facility"* — mirrors how the admin shell handles facility scoping.

### 2. Data layer (no new SQL)

All schema is in place. Add a thin client-side service module:

```
src/lib/onboarding/documents.ts
```

Exposed functions (all wrap `fetch` to the existing Edge Functions, using the user's session JWT from `createClient().auth.getSession()`):

| Function | Edge call |
|---|---|
| `uploadDocument(file, { facilityId, audience: "facility_scoped" })` | `POST /functions/v1/ingest` (multipart) |
| `requestParse(documentId, facilityId)` | `POST /functions/v1/facility-launch-parser` `{ action: "parse_document" }` |
| `pollParserJob(parserJobId)` | `POST /functions/v1/facility-launch-parser` `{ action: "run_job" }` (the existing `run_job` action is reusable as a status echo; if a true status read is needed, add a `get_job` action — small backend add) |
| `listDocumentFacts(documentId)` | `{ action: "list_document_facts" }` |
| `approveFact(factId, notes?)` | `{ action: "approve_fact" }` |
| `rejectFact(factId, notes)` | `{ action: "reject_fact" }` |
| `approveAndApplyFact(factId, notes?)` | `{ action: "approve_and_apply_fact" }` |
| `editFactValue(factId, newValue)` | (small backend add — `update_fact` action that overwrites `extracted_value/normalized_value` + flips status to `pending` for re-review) |

**One small Edge Function addition** (5–10 LoC) is recommended:
- `update_fact` — lets the human edit a parsed value before approve/apply. Without it, "edit" becomes "reject + re-extract" which is jarring. Insert into the existing switch in `facility-launch-parser/index.ts:331–401`.
- (Optional) `get_job` — explicit job status lookup. The current `run_job` will re-trigger parsing, which is wrong semantics for polling.

**Client store** (Zustand, mirroring `useOnboardingStore`):

```
src/hooks/useFacilityLaunchDocuments.ts
```

State:
- `documents: DocumentRow[]` (joins `documents` + latest `document_parser_jobs.status` + counts of pending/approved/rejected/applied facts)
- `factsByDocument: Record<docId, ExtractedFact[]>`
- `uploads: Record<localId, { phase, progress, file, error? }>` — local-only, ephemeral
- `appliedValues: Record<moduleCode, Record<fieldPath, AppliedValue>>` (from `facility_launch_module_values`) — used for the "what's missing" view + readiness impact callout
- Actions: `hydrate()`, `addUpload()`, `cancelUpload()`, `approveFact()`, `rejectFact()`, `editFact()`, `applyFact()`, `replaceWithCurrentCopy(documentId, file)` (multi-step: upload, link to same `document_group_id`, mark new doc as source of truth)

**A `documents_overview` view** is worth adding (one migration, optional but high-leverage) so the list page is a single round-trip:

```sql
CREATE VIEW haven.documents_overview AS
SELECT d.id, d.title, d.workspace_id, d.created_at,
       jl.id            AS latest_job_id,
       jl.status        AS latest_job_status,
       jl.completed_at  AS latest_job_completed_at,
       (SELECT count(*) FROM document_extracted_facts f WHERE f.document_id = d.id AND f.approval_status = 'pending')  AS pending_facts,
       (SELECT count(*) FROM document_extracted_facts f WHERE f.document_id = d.id AND f.approval_status = 'approved') AS approved_facts,
       (SELECT count(*) FROM document_extracted_facts f WHERE f.document_id = d.id AND f.approval_status = 'applied')  AS applied_facts
FROM documents d
LEFT JOIN LATERAL (
  SELECT id, status, completed_at FROM document_parser_jobs j
  WHERE j.document_id = d.id AND j.deleted_at IS NULL
  ORDER BY created_at DESC LIMIT 1
) jl ON true
WHERE d.deleted_at IS NULL;
```

(RLS inherits via `documents`. Saves ~3 round-trips per page load.)

### 3. Things explicitly removed

- The "Connect Supabase OCR/AI pipeline" disclosure (`app.js:445–475`).
- The `data-pipeline-config` form fields (URL, anon key, JWT, org id, facility id).
- The `data-supabase-ocr-upload` button copy "Upload to Supabase OCR/AI pipeline" — replaced by a single primary "Upload" button that just works.
- `loadPipelineConfig` / `savePipelineConfig` / `pipelineConfigured` from `supabasePipeline.js` — deleted entirely once the standalone page is gone or fenced.
- The "Local draft workbook" yellow disclaimer.

### 4. Page architecture

#### `/onboarding/documents` (list)

Five regions, vertically:

1. **Hero drop zone** — full-width card; "Drop a document, or browse." Accepts multiple files; supports drag of an entire folder. Sub-line names accepted artifact types in plain English. While files are uploading, this region grows a stack of file cards (one per upload) showing per-file status.
2. **Readiness impact strip** (sticky after first upload) — `"Today: 78% ready. 3 documents need your review · 2 stale · 1 duplicate group unresolved."` Each fragment is a chip that scrolls/links to the matching panel.
3. **What we still need** panel — module-by-module checklist of expected artifacts vs current evidence:
   - ✓ have a current source-of-truth
   - ⚠ have stale-only
   - ✗ none yet
   Each ✗ row has a "Drop one here" mini drop target that opens the same upload flow with the artifact type pre-selected.
4. **Documents inbox** table — every doc in the org/facility scope with: title, artifact type chip, term, currency badge (fresh/aging/stale/unknown), status badge (see § 5), pending facts count, "Review →" CTA.
5. **Source-of-truth resolver banner** — surfaces only when there are unresolved duplicate groups; deep-links to a per-group resolver (existing logic; just relocated).

The Decision Log + Reset Demo button do **not** come over from the standalone — the production app has audit logging via `document_audit_events`.

#### `/onboarding/documents/[documentId]` (review)

Three columns on desktop, stacked on mobile:

- **Left:** document preview (PDF rendered with `react-pdf`; falls back to `documents.markdown_text` excerpt if no PDF). Highlights the `source_excerpt` of the currently-focused fact when one is hovered.
- **Center:** **Extracted facts review queue** — one card per `document_extracted_facts` row. See § 6.
- **Right:** sidecar with: artifact type, facility, term/currency, mapped modules, source-of-truth toggle, "Replace with current copy" button, audit trail (parser job + reviewer history).

### 5. UX states

These are the canonical states the operator sees. Every visible status string in the UI should map to exactly one of these.

#### Document-level status

| State | Trigger | UI |
|---|---|---|
| `queued` | File picked, not yet uploaded | Card with file name + spinner + "Uploading…" + cancel-X |
| `uploading` | Multipart `POST /ingest` in flight | Progress bar (0–100%) on the card |
| `uploaded` | `ingest` returned `document_id`, parser not yet started | Pill: *"Stored · waiting to read"* |
| `parsing` | `document_parser_jobs.status = running` | Pill: *"Reading the document…"* + animated dots |
| `parsed_no_facts` | Parser job `completed`, 0 facts extracted | Pill: *"Couldn't read clear facts — review manually"* + CTA |
| `awaiting_review` | ≥1 fact `approval_status = pending` | Pill: *"N facts to review"* (count) |
| `partially_approved` | Some pending, some approved/rejected | Pill: *"In review · N left"* |
| `approved` | All facts approved or rejected, none applied yet | Pill: *"Approved · ready to apply"* |
| `applied` | ≥1 fact `applied`, no pending/approved-not-applied | Pill: *"Live in modules"* + chip row of touched modules |
| `parse_failed` | Job `failed` with `error_message` | Pill: *"Couldn't read · retry"* + retry CTA |
| `superseded` | Newer doc replaced this one as source of truth | Pill: *"Replaced by [link]"* |
| `stale` | `expirationDate < now` | Stale badge (yellow) + "Replace with current copy" CTA |

#### Per-fact status (in the review queue)

| State | UI affordance |
|---|---|
| `pending` | Card with three primary actions: **Approve & apply** · **Approve only** · **Reject**; secondary: **Edit value**, **Show evidence** (expands `source_excerpt` + page number); confidence ribbon (HIGH/MED/LOW computed from `confidence` numeric: ≥0.75 / 0.50–0.75 / <0.50) |
| `approved` | Green check + "Approve & apply" CTA collapses to a single "Apply" |
| `applied` | Locked card with "Applied to M17 → documents.expirationDate · provenance" + a small Undo (writes a `superseded_at` to the live `facility_launch_module_values` row + flips fact back to `approved`) |
| `rejected` | Greyed; "Reasoning: [review_notes]"; "Bring back" reopens to pending |
| `superseded` | Greyed; "Newer extraction available" link to the latest fact |
| `editing` | Inline form replacing the value; cancel + save buttons; on save flips back to `pending` and re-renders confidence as `manual` |

#### Upload-zone states

| State | UI |
|---|---|
| Idle | Dashed border, hero copy *"Drop a document, or browse"* + accepted-types caption |
| Hover-with-files | Filled bg, *"Drop to upload N file(s)"* |
| Uploading (single) | Card replaces hero; thin progress bar; per-file status |
| Uploading (batch) | Vertical stack of cards; aggregate "3 / 5 uploaded · 1 reading · 1 ready for review" line above |
| Network failure | Inline retry on the failed card; remaining files continue |
| Auth lost mid-upload | Top-of-page banner: *"Your session expired — please sign in again"* + sign-in deep link with `?return=/onboarding/documents` |
| Wrong-role | Drop zone disabled; tooltip: *"Document upload is restricted to ED, Document Custodian, and Org Admins"* |

#### Apply-to-module states

When the user hits **Approve & apply**, three things happen visibly:

1. The fact card collapses with a green slide animation showing the destination: `M17 · documents.expirationDate ← 2027-01-01`.
2. A toast: `"Applied to M17 (Documents) · M16 readiness moved 78 → 82"` — with **Undo** for ~12 seconds.
3. The "What we still need" panel updates inline (the expected-artifact row flips ✗ → ✓ or ⚠ → ✓).

If apply fails (RLS rejected, network error), the card returns to `approved` state and shows an inline error with **Retry**. No fact ever silently fails.

### 6. Extracted-facts review card (anchor of the experience)

This is the artifact that satisfies *"AI proposes, humans approve"* (Spec §93–99).

**Header row:**
- Fact label: e.g., *"Expiration date"*
- Confidence ribbon: HIGH / MEDIUM / LOW (color + numeric in tooltip)
- Source page chip: *"p. 2"* (clicking deep-links the left preview to that page)

**Body:**
- Big readable value: `2027-01-01` (formatted by `fact_key` — dates as ISO + locale, money as `$xxx,xxx`, plain text otherwise)
- Evidence excerpt block: monospace, the surrounding ~280 chars from `source_excerpt`, with the value bolded (substring highlight)
- Routes-to chip row: `[M17 · Documents]` — clickable, scrolls/navigates to the module field

**Footer / actions:**
- Primary: **Approve & apply →** (single click; the 80% case)
- Secondary row: **Edit** · **Reject** · **Approve only** (advanced)
- Tertiary: **Show parser provenance** (collapsed) — model name, parser version, parser job id, ISO timestamp; only relevant for audit replay

**"Why was this suggested" line** (always visible, one sentence):

> *"Read from the document's expiration field on page 2 with high confidence."*

We can derive this server-side from `evidence.extraction` (`heuristic` vs `ai`) + page number + confidence bucket, so the operator gets a real explanation, not a regex string.

### 7. "What we still need" panel — driving readiness

This is the answer to PRD §291 (*"what is missing, who owns it"*) and the highest-leverage piece for non-technical onboarding users.

Build by joining:
- The static catalog of expected artifacts per in-scope module (already encoded in `facility-launch-center/src/intakeCatalog.js` — port to TS as `src/lib/onboarding/expected-artifacts.ts`).
- The current `facility_launch_module_values` rows (active = `superseded_at IS NULL`).
- The current `document_extracted_facts` (any pending/approved-not-applied counts).

Render per module:

```
M17 · Insurance & Documents              82% ready
  ✓ State license — current source of truth (HOMEWOOD AHCA 2026)
  ⚠ General Liability cert — only 2022 copy (stale, expired 2023-01-01)   [Replace with current →]
  ✗ Property policy — none yet                                              [Drop one here ↧]
```

Each row's CTA opens the same upload dialog with `artifactType` + `entityAssociation` pre-selected — so the operator never has to know what an "artifact type" is. (Drag-onto-row should also work.)

### 8. Replace-with-current-copy flow

The natural human reaction to *"stale 2022 doc"* is *"let me grab the 2026 one."* The static review (`docs/reviews/2026-05-05-document-intake-ux-review.md` MF10) calls this out and the production version supports it cleanly:

1. Click **Replace with current copy** on a stale document or stale module-row.
2. Same drop modal opens, with artifact type + facility pre-selected and a hidden `link_to_document_group_id` carried through.
3. On `ingest` success, set the new document as source of truth via the existing group resolver (server side — small new RPC `set_document_group_source_of_truth(group_id, doc_id)` if not already there).
4. Trigger parse.
5. On `applied`, the old document automatically transitions to `superseded` state.

### 9. Permission, audit, and HIPAA posture

- All writes pass through `facility-launch-parser` which already enforces role + org via `loadActor()` and writes to `ai_invocations` + `document_audit_events`.
- The client never holds Supabase keys, JWTs, or org ids in form fields. The onboarding session JWT is the only credential, transparently attached by `@supabase/ssr` cookies and the existing `createClient()`.
- PHI class is set to `limited` in `recordAiInvocation` — onboarding documents (insurance, license, vendor agreements) are non-PHI; if a resident roster ever lands here we should add a `phi_class` toggle on upload (out of scope for this plan; flag in handoff).

### 10. Test plan (high-level)

| Layer | Test |
|---|---|
| Unit (lib) | `documents.ts` correctly attaches Authorization header from active session; surfaces 401/403 as typed errors |
| Unit (store) | Upload state machine transitions queued → uploading → uploaded → parsing → awaiting_review on happy path |
| Component | `ExtractedFactCard` renders confidence ribbon by bucket, calls `approveAndApplyFact` on primary, blocks Apply when `approval_status !== "approved"` |
| Integration (Playwright in `(onboarding)` group) | Authenticated user uploads `HOMEWOOD GL CERT.pdf` → parser job appears → 1+ facts shown → approve & apply → readiness strip moves → "what we still need" updates ✗→⚠/✓ |
| Server / Edge | `update_fact` action validates `app_role` and re-enters `pending`; `apply_fact` superseded path uniqueness held by `idx_facility_launch_module_values_active_unique` |
| RLS | Caregiver role gets 403 on parse/approve/apply paths; org_admin in different org gets 404 not 403 |
| A11y | Drop zone reachable by keyboard; per-fact action buttons have explicit `aria-label`s; live-region announces "Applied to M17" on apply |

The static `facility-launch-center/scripts/verify.mjs` checks stay where they are (they protect the local-only seed register; the Haven flow gets its own Playwright + Vitest coverage under `src/lib/onboarding/__tests__` + `e2e/`).

### 11. Sequencing — proposed build order (one engineer, ~5 days)

| Day | Deliverable |
|---|---|
| 1 | Route scaffold (`/onboarding/documents`, `/onboarding/documents/[documentId]`), `OnboardingShell` nav update, `useFacilityLaunchDocuments` hydrate (read-only list against the new `documents_overview` view) |
| 2 | Hero drop zone + multi-file upload pipeline (multipart to `ingest`, optimistic queue cards, retry, batch progress); kick off `parse_document` automatically on upload success |
| 3 | Per-document review page + extracted-facts cards (Approve / Reject / Approve & apply); fact polling; document status pill state machine |
| 4 | "What we still need" panel + readiness impact strip + Source-of-truth resolver banner; replace-with-current flow; toast + undo |
| 5 | Edge `update_fact` + `get_job` action additions; Playwright happy path; copy polish; retire/redirect `src/app/facility-launch/page.tsx`; remove `supabasePipeline.js` config panel |

### 12. Out of scope for this plan

- PDF region highlighting (visual bbox over the source excerpt). Deferred — `react-pdf` text-layer is good enough for the MVP.
- Multi-facility batch upload with auto facility detection (currently relies on filename heuristic + active-facility chip; OK for COL pilot which is one-facility-at-a-time onboarding).
- ML-backed classifier swap. The Haiku-based extractor is the production model; a tuned classifier is a later enhancement.
- E-signature / DocuSign provenance on custodian approval (acceptable static-app limitation per L5 in the prior review).
- Resident-PHI document handling (would need `phi_class = strict` plumbing).

---

## Summary

The production back end (ingest + parser + RLS + audit) is already done. What's missing is a single authenticated UI surface where a non-technical onboarding user can:

1. **Drop documents** (no config, no JWT, no org-id field).
2. **Watch them parse** with explicit, plain-English status pills.
3. **Review one fact at a time** with confidence + evidence + a single "Approve & apply" primary.
4. **See readiness move** the instant a fact is applied.
5. **See what's still needed** broken down by module, with drop targets to fix it.

That surface goes under `/onboarding/documents` inside the existing `(onboarding)` route group, reuses the `OnboardingShell`, talks to the already-deployed Edge Functions, and retires the standalone "Supabase OCR/AI pipeline" config panel entirely. ~5 engineer-days. Two tiny back-end additions (`update_fact`, `get_job`, plus an optional `documents_overview` view) keep the experience smooth without inventing new infrastructure.

The single highest-leverage piece is the **Extracted Facts Review card** (§ 6) — that's where *"AI proposes, humans approve"* finally becomes a button the operator clicks.

---

## Jarvis Frontend Handoff

Backend changes implied by this plan (confirm before merge):

1. **Edge Function `facility-launch-parser`** — add `update_fact` action (mutates `document_extracted_facts.extracted_value/normalized_value`, flips `approval_status` back to `pending`, role-gated to `owner|org_admin|facility_admin`).
2. **Edge Function `facility-launch-parser`** — add `get_job` action (read-only status fetch by `parser_job_id`; replaces current overload of `run_job` for polling).
3. **(Optional) New view `haven.documents_overview`** — flattens `documents` + latest parser job + per-status fact counts; RLS inherits from `documents`. Saves N+1 queries on the list page.
4. **TypeScript types** — add `DocumentRow`, `ExtractedFact`, `ParserJob`, `AppliedModuleValue`, `DocumentStatus` enum to `src/types/facility-launch.ts` (new file). Mirror the existing `src/lib/onboarding/types.ts` style.
5. **No CHECK-constraint or enum changes** required — the existing `approval_status IN ('pending','approved','rejected','applied','superseded')` covers every UI state in § 5.
6. **No breaking changes** to existing onboarding queries (`onboarding_questions`, `onboarding_responses`).

**Report saved at:** `facility-launch-center/docs/reviews/2026-05-05-authenticated-document-intake-plan.md`
