# 41 — Document Intake (Haven)

Linear: COL-771 (parent), COL-834..841 (DI-01..DI-08), COL-842 (Homewood + Corporate acceptance), COL-843 (all five facilities).
Plan of record: Linear document "Haven Document Intake — reviewed launch plan and acceptance tests" (2026-09-25).
Decision: `DOCUMENT-INTAKE-DECISION.md` (amended 2026-09-25, see "Haven" there).

## Release boundary

Brian, 2026-09-25: **Document Intake starts at Homewood only on 2026-10-01.** The other four facilities follow one at a time (COL-843). Intake is launch-critical and no longer waits for "after Homewood settles" or for the whole GSMS engine.

## The journey

Received document → preserved original → authorized reader + Jev processing → **Pending review** (original, suggested name, short summary, assessment, proposed destination) → an authorized person approves or changes it → filed record with history.

Every filing needs a person's approval in v1. Filing never approves a payment, a clinical fact, a training completion, an insurance acceptance or a Medicaid deadline.

## Data (migration 545)

| Table | Holds |
|---|---|
| `document_intake_items` | One received document: original bytes (`document-intake` bucket, private), custody, review state, revision. Originals are immutable once attested. |
| `document_intake_runs` | One processing generation: lease + fence, durable dispatch intent before any paid call, outcome. |
| `document_intake_proposals` | Immutable proposal generations (title, summary, type, candidates, Jev answers, checks, warnings, per-stage status). |
| `document_intake_filings` | Filing receipt: prepare → server copy + attest → complete. One live filing per item. |
| `document_intake_events` | Append-only history. |
| `document_intake_catalog` | Document types → destination (config rows, seeded from the existing record types). |
| `document_intake_settings` | Per-organization roles (upload / review / custodian), claim minutes, overdue hours, size cap. |
| `document_intake_reviewers` | Named primary / backup per facility, and the custodian for unknown-facility mail. |
| `document_intake_mailboxes`, `_messages`, `_sender_routes` | Email receipt: per-folder delta cursor, message manifest, authenticated sender → facility. |
| `document_intake_requests` | Idempotency ledger: same key + same request replays; same key + different request is refused. |

### Destinations (catalog `destination_kind`)

| Kind | Canonical record | Opens from |
|---|---|---|
| `resident_document` | `resident_documents` (bucket `resident-documents`) | `/admin/residents/[id]/documents` |
| `benefits_document` | `benefits_documents` (status `ready`, bucket `benefits-documents`) | `/admin/benefits/[caseId]` |
| `employee_file` | `employee_file_records` (status `submitted` — never verified by filing) | `/admin/staff/[id]` |
| `facility_document` | `facility_documents` (bucket `facility-documents`) | facility vault |
| `none` | stays an owned intake exception (payment evidence, unknown) | — |

## Principals

- **People** act through `document_intake_*` RPCs as themselves. Filing re-checks authority at approval time (catalog reviewer role + the destination's own rule: resident at the facility, benefits write grant, employee manager).
- **Worker / mail receiver** (Edge Functions, service role) may call only `document_intake_worker_*`, `document_intake_attest_*` and `document_intake_declare_split_child`. None of these can approve a filing: filing requires `haven.authorized_user_id()` to be a reviewer.

## AI

- **Reader** (Claude through the Anthropic API) runs only when `ai_invocation_policies` allows PHI with a recorded BAA and `routing_json.document_intake.enabled` is true. Otherwise the stage shows "AI not run" with the reason and the document goes to review with no proposal.
- **Jev** (TypeSafe System One) runs after the reader when the catalog row has `jev_enabled`, `routing_json.document_intake.jev_enabled` is true, and — for a type that carries PHI — `routing_json.document_intake.jev_phi_enabled` is true. Unknown or unauthenticated senders never go to Jev.
- **Code** does every date, amount and identity comparison. Jev answers are stored as returned (question version, model, probabilities); probabilities are never shown as "percent correct".
- **Paid-call safety:** dispatch intent is written before every call. A lease that expires after dispatch makes the run `uncertain`; nothing is re-sent until a person confirms "send again" (`reprocess` with `accept_possible_duplicate_charge`).
- Payment evidence (checks, deposit slips) never goes to a reader.

## Splitting

A mixed scan is split into real separate PDF files (`pdf-lib`), one per part, each byte-verified. Every page is placed in exactly one part or explicitly excluded. Once split, the parent is visible only to custodians.

## Preview

Originals are streamed through an authorized same-origin route with a no-script Content-Security-Policy (`default-src 'none'`; set in `next.config.ts` so the site-wide policy cannot override it), `nosniff` and `no-store`. PDFs render in the browser with `pdfjs-dist` onto a canvas (no PDF scripting, no annotation layer). TIFF and WebP are converted to PNG server-side for preview only; iPhone HEIC/HEIF has no on-screen preview (the installed `sharp` cannot decode HEVC) and offers the original instead. The original is never changed.

## Email

**Mailboxes (Brian, 2026-09-25):** six shared mailboxes on circleoflifecommunities.com — `homewood.docs`, `grandecypress.docs`, `oakridge.docs`, `plantation.docs`, `risingoaks.docs` (each routes to its facility's queue) and `frontoffice.docs` (Corporate custodian). Each row in `document_intake_mailboxes` names its facility (migration 548) and is switched on with that facility's rollout; Homewood and Front Office first. An authenticated sender route still wins over the mailbox. This supersedes the single `docs@` address in the decision document.

`document-intake-mail-sync` reads each active mailbox in `document_intake_mailboxes` with Microsoft Graph (application permission scoped by Exchange RBAC to the six intake mailboxes only; env `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`). Per-folder delta; the raw message is stored first; the cursor advances only after every enumerated message has a stored receipt or a recorded exception. Routing: an authenticated sender route (address → facility) first, then the receiving mailbox's facility; mail with neither (Front Office) lands in Needs attention as "Facility unknown" for the custodian.

## Acceptance

The test matrix is `document-intake-test-spec-2026-09-25.md` (U1–U6, I1–I15, E1–E7, O1–O4, P1–P4, A1–A5). Homewood + Corporate acceptance is COL-842; each other facility is separate (COL-843).
