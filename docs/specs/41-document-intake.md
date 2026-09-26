# 41 — Document Intake (Haven)

Linear: COL-771 (parent), COL-834..841 (DI-01..DI-08), COL-842 (Homewood + Corporate acceptance), COL-843 (all five facilities).
Plan of record: Linear document "Haven Document Intake — reviewed launch plan and acceptance tests" (2026-09-25).
Decision: `DOCUMENT-INTAKE-DECISION.md` (amended 2026-09-25, see "Haven" there).

## Release boundary

Brian, 2026-09-25: **Document Intake starts at Homewood only on 2026-10-01.** The other four facilities follow one at a time (COL-843). Intake is launch-critical and no longer waits for "after Homewood settles" or for the whole GSMS engine.

## The journey

Received document → preserved original → authorized reader + Jev processing → **Pending review** (original, suggested name, short summary, assessment, proposed destination) → an authorized person approves or changes it → filed record with history.

Every filing needs a person's approval in v1. Filing never approves a payment, a clinical fact, a training completion, an insurance acceptance or a Medicaid deadline.

## Data (migrations 545, 559-561)

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

Later migrations: 559 replaces `document_intake_prepare_filing` to take reviewer verdicts on flagged Jev checks (stored at `document_intake_filings.reviewer_changes.checks`). 560 adds `haven.wilson_lower` and the read-only views `document_intake_jev_outcomes` and `document_intake_jev_check_outcomes` (security_invoker). 561 extends `document_intake_worker_subjects` (same signature, grants and `SECURITY DEFINER`): residents carry `admission_date`, `facility` carries names, city, AHCA license number and expiration and licensed beds, and a new `org_facilities` array lists every facility in the organization (`id`, `name`, `legal_name`, `dba`, `city`).

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

### Per-type evidence and questions (`intake-v2`)

- **Reader copies evidence.** For the catalog code it picks, the reader returns an `evidence` object (short verbatim excerpts, dates, whole numbers, one-sentence descriptions of signature lines), per type plus `COMMON_EVIDENCE`. Evidence is masked with `maskIdentifiers` before storage and before Jev; bad fields become one `reader_evidence_invalid` warning (field names only). Stored at `result.reader.evidence`.
- **Jev judges, code decides.** Each type has its own question set; Jev is never asked whether something is expired, late, adequate or within a window. Every date window, count and identity comparison runs in code (`supabase/functions/_shared/intake-type-checks.ts`) after Jev, so it can use Jev's classifications. Constants shared with admissions (medical exam window, Form 1823 365-day default) are drift-tested against `src/lib/admissions/`.
- **Question wording is versioned data** in `supabase/functions/_shared/intake-type-questions.ts`. Each proposal records `jev.questions_version` = `intake-v2/<code>.<n>`. Any wording or rule change to a type bumps that type's `version`; shared wording or builder changes bump `INTAKE_QUESTIONS_VERSION`. Never edit wording without the bump.
- **What Jev sees:** document type label, title, summary, the evidence, reader notes, page count, names found (person, employee, vendor, agency), candidate labels, and the receiving and sister Circle of Life facility names (`name`, `legal_name`, `dba`, `city`). Never the original, never a date of birth, never ids.
- **PHI gate (unchanged):** a `contains_phi` type needs `jev_phi_enabled`. With today's settings Jev runs on the non-PHI facility and vendor types only; the resident, Medicaid and staff sets ship ready and switch on with the flag.
- **Pre-selection:** Jev's destination pick is pre-selected only when its lead over the runner-up clears the margin, Jev's `type_matches` is not "no", and no `dob_matches` check failed for that candidate. The same gate applies to code's own pick; a blocked pick leaves nothing pre-selected, with warning `jev_preselect_blocked`. Margin: `routing_json.document_intake.jev_margin_by_type[<code>]`, else `jev_margin`, else 0.2; values outside 0 to 1 are ignored.
- **Reviewer verdicts (migration 559):** each Jev check with result Fail or Unknown shows "Was Jev right?" (Right, Wrong, Can't tell). When Jev ran, filing requires a verdict on every flagged check; unknown codes or values are refused. Stored at `document_intake_filings.reviewer_changes.checks`.
- **Accuracy page** `/admin/document-intake/accuracy` ("Jev accuracy" in the workspace header, same gate as the queue), over views `document_intake_jev_outcomes` and `document_intake_jev_check_outcomes` (security_invoker, migration 560). Per type and current `questions_version`: top pick right (k of n with the Wilson lower bound), the margin recommendation (Collect, Keep, Loosen, Tighten, Off; logic in `src/lib/document-intake/jev-accuracy.ts`), per-check right rate and unknown share, and the misses. The page renders the setting change as SQL for Brian; it never writes a setting.

### Open owner decisions

- Physician assistants as Form 1823 examiners (Jessica): `pa` passes until decided.
- Florida POA and surrogate execution formalities in `authority_instrument` (Donna): as written until decided.
- Vendor COI general liability minimum (Brian): `VENDOR_COI_MIN_GL_EACH_OCCURRENCE_CENTS` is null, no check.
- Freshness rule for Medicaid application bank statements (Jessica): not encoded, no check.
- Legal entity names for Oakridge, Rising Oaks, Grande Cypress and Plantation (`facilities.legal_name` is null), and Homewood's LLC versus LLLC (Brian, Donna): facility match falls back to name, DBA and address.

## Splitting

A mixed scan is split into real separate PDF files (`pdf-lib`), one per part, each byte-verified. Every page is placed in exactly one part or explicitly excluded. Once split, the parent is visible only to custodians.

## Preview

Originals are streamed through an authorized same-origin route with a no-script Content-Security-Policy (`default-src 'none'`; set in `next.config.ts` so the site-wide policy cannot override it), `nosniff` and `no-store`. PDFs render in the browser with `pdfjs-dist` onto a canvas (no PDF scripting, no annotation layer). TIFF and WebP are converted to PNG server-side for preview only; iPhone HEIC/HEIF has no on-screen preview (the installed `sharp` cannot decode HEVC) and offers the original instead. The original is never changed.

## Email

**Mailboxes (Brian, 2026-09-25):** six shared mailboxes on circleoflifecommunities.com — `homewood.docs`, `grandecypress.docs`, `oakridge.docs`, `plantation.docs`, `risingoaks.docs` (each routes to its facility's queue) and `frontoffice.docs` (Corporate custodian). Each row in `document_intake_mailboxes` names its facility (migration 548) and is switched on with that facility's rollout; Homewood and Front Office first. An authenticated sender route still wins over the mailbox. This supersedes the single `docs@` address in the decision document.

`document-intake-mail-sync` reads each active mailbox in `document_intake_mailboxes` with Microsoft Graph (application permission scoped by Exchange RBAC to the six intake mailboxes only; env `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`). Per-folder delta; the raw message is stored first; the cursor advances only after every enumerated message has a stored receipt or a recorded exception. Routing: an authenticated sender route (address → facility) first, then the receiving mailbox's facility; mail with neither (Front Office) lands in Needs attention as "Facility unknown" for the custodian.

## Acceptance

The test matrix is `document-intake-test-spec-2026-09-25.md` (U1–U6, I1–I15, E1–E7, O1–O4, P1–P4, A1–A5). Homewood + Corporate acceptance is COL-842; each other facility is separate (COL-843).
