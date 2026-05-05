# Facility Launch Document Parser Pipeline

Status: implemented scaffold, pending Supabase deploy/secrets/UAT.

## Purpose

Facility Launch document intake must not trust AI output directly. The production path is:

1. Upload document to Supabase Storage through `ingest`.
2. Convert PDF/DOCX/XLSX/text to Markdown/text OCR intermediate representation.
3. Run `facility-launch-parser` to create field-level extracted facts.
4. Human reviews each fact: approve, reject, or approve-and-apply.
5. Approved facts write to `facility_launch_module_values` with source document/fact provenance.

## Backend surfaces

- Migration: `supabase/migrations/216_facility_launch_document_parser.sql`
- Edge Function: `supabase/functions/facility-launch-parser/index.ts`
- Static client connector: `facility-launch-center/src/supabasePipeline.js`

## Tables

- `document_parser_jobs`
  - Tracks parse lifecycle per document.
  - Scoped by `organization_id` and optional `facility_id`.
- `document_extracted_facts`
  - Stores proposed values, confidence, source excerpt, proposed module/field, review status.
- `facility_launch_module_values`
  - Stores approved/applied module values with `source_document_id`, `source_fact_id`, and provenance JSON.

All three tables use RLS, soft delete, updated-at triggers, and `haven_capture_audit_log`.

## Edge Function actions

`POST /functions/v1/facility-launch-parser`

- `parse_document` — extract facts from existing `documents.markdown_text/raw_text`.
- `run_job` — run a queued parser job.
- `list_document_facts` — return facts for a document.
- `approve_fact` — mark a fact approved, without writing it.
- `reject_fact` — reject a fact.
- `apply_fact` — write an approved fact to module values.
- `approve_and_apply_fact` — approve then write in one action.

The function verifies JWT, permits `owner`, `org_admin`, and `facility_admin`, and records AI invocation hashes in `ai_invocations` when Anthropic extraction runs.

## Current parser behavior

- Uses existing OCR/Markdown output from `ingest`.
- If `ANTHROPIC_API_KEY` exists, runs AI fact extraction.
- If no AI key exists or AI fails, falls back to deterministic filename/text heuristics.
- Never writes directly to onboarding/facility module values until human approval.

## Required deployment operations

1. Apply migration 216 to Supabase.
2. Deploy Edge Function `facility-launch-parser`.
3. Confirm secrets exist:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY` for AI extraction; without it the function still works in heuristic mode.
4. In the Facility Launch page, configure:
   - Supabase URL
   - Supabase anon key
   - current authenticated user JWT
   - organization UUID
   - facility UUID
5. Upload a PDF from Document Intake and confirm extracted facts await approval.

## Safety rule

AI output is a proposal, not a fact. Do not bypass `document_extracted_facts.approval_status` before writing to `facility_launch_module_values`.
