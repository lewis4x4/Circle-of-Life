# Resident Record Intake

Status: implementation segment RRI-01; source completion does not mean deployment or Homewood acceptance.

## Purpose

Resident Record Intake lets authorized staff upload a whole admission packet in one place, classify every source, identify the resident, review extracted or manually entered facts, and apply approved values to Haven's canonical resident records. AI/OCR output is always a proposal. Unknowns, contradictions, excluded pages, and missing documents remain visible.

Primary entry: `/admin/admissions/new?tab=packet`  
Durable workspace: `/admin/admissions/intake/[id]`

The same intake can later be opened from the linked admission case or resident chart. Missing checklist rows retain per-type **Add** and **Replace** actions.

## Workflow

1. Create a facility-scoped intake. A resident or admission case is optional at this point.
2. Select many PDF or phone-image files in the single bulk upload area.
3. Haven prepares an immutable source identity, uploads into private intake storage, downloads through the current user's scope, verifies magic bytes/size/SHA-256/storage identity, and finalizes the source.
4. Staff complete credential preflight. Any file that cannot be inspected locally, including images and scanned PDFs, requires explicit preview clearance before external processing.
5. When organization policy permits PHI processing, Haven requests structured classification/extraction from the configured provider. Without that policy/provider, staff use the complete manual classification and proposal path.
6. Haven proposes possible resident/referral matches. A person confirms one candidate or explicitly creates an inquiry resident; matching never links automatically.
7. The workspace groups facts by canonical target and displays current value, proposed value, source/page, confidence, conflict, required reviewer, and state.
8. Authorized reviewers approve, reject, defer, or enter an attributable corrected proposal.
9. Apply is separate. The command rechecks the current source/fact revision, target fingerprint, actor authority, facility scope, and domain-specific requirements.
10. Accepted resident sources become `resident_documents`; facts write to their canonical destination; receipts and audit records preserve what happened.

## Source handling

Allowed source MIME types are PDF, JPEG, PNG, WebP, HEIC, and HEIF, up to 20 MiB each. HEIC/HEIF originals remain immutable; the server may create a temporary in-memory JPEG representation for an approved extraction request.

Each uploaded file must resolve to one promotable resident-document type. A PDF containing mixed resident, employee/facility, other-resident, credential, or unreadable pages cannot be attached wholesale. It remains restricted intake evidence and the accepted document pages must be added separately. This prevents excluded pages from becoming readable through the resident document vault.

Document actions:

- **Add:** create another current resident document of the selected type.
- **Replace:** select the current document, verify the new source, record the supersession chain, point checklist evidence to the new document, and retain the prior version as history.

Credential-marked files produce no resident facts and never become resident documents. Only pattern codes and hashes may remain in audit/retention records; secret values are never copied into facts, logs, excerpts, or ordinary responses.

## Canonical data ownership

Existing destinations remain authoritative:

- `residents` — core identity, clinical summary, risk, physician, and confirmed admission attributes.
- `resident_contacts` — family, emergency, professional, proxy, and POA people.
- `resident_documents` — accepted source documents only.
- `assessments` — structured clinical/functional assessments.
- `resident_medications` — complete authorized medication orders; no eMAR history is imported.
- `resident_payers` and `resident_pharmacy_benefits` — coverage and PBM identifiers.
- `advance_directive_documents` — directive evidence and verification.
- `resident_authority_instruments` — authority type, scope, status, dates, reviewer, and source.
- `resident_contracts` / `resident_contract_signers` — agreements, acknowledgments, consents, and paper-signature observations.
- `resident_provider_referrals` — typed external provider/referral records.
- `resident_screening_records` — registry/search evidence and review.
- `form_1823_records` — source-linked April 2021 Form 1823 clinical content.
- `admission_cases` / `admission_document_checklist_items` — admission workflow and document completeness.
- `resident_profile_facts` — controlled secondary resident-book facts whose canonical representation is not a scalar resident column.

The extraction provider returns controlled fact codes only. It cannot select tables, SQL, or arbitrary field paths.

## Reviewer matrix

| Work | Allowed reviewer |
|---|---|
| Upload, classify, match, manual proposal | Owner, org admin, facility admin, nurse |
| Demographics, contacts, admission checklist | Owner, org admin, facility admin |
| Diagnoses, allergies, code status, assessments, Form 1823, directives | Nurse |
| Medication order | Nurse; application reuses `save_medication_order_review` |
| Payer and pharmacy benefits | Owner, org admin, facility admin |
| Authority instruments and legal contracts | Owner, org admin, facility admin |
| Credential override/purge | Owner or org admin with reason |

UI visibility is not authorization. RLS and commands enforce current organization, facility, subject, role, Auth session, and authorization version at execution time.

## Unknowns and conflicts

An intake-created resident remains `inquiry`. Unreviewed code status, mobility, fall risk, elopement/wandering risk, smoking, and payer values are null, not favorable defaults. Activation is blocked while required fields remain unresolved.

Different source proposals never resolve by confidence alone. DOB, admission date, room/bed, authority, medication, diagnosis, allergy, code status, and payer conflicts require an explicit decision and reason. Room text is evidence only; intake cannot occupy or move a bed. A canonical value changed after review makes the proposal stale and blocks application.

Only SSN last four may enter ordinary resident data. Full SSNs are not a supported fact value.

## Form 1823 boundary

The April 2021 form representation includes representative, allergies, height/weight, history, limitations, cognitive/behavioral status, services, precautions, elopement risk, seven ADL assistance levels, diet, five exclusion-condition flags, ALF-needs determination, medication-assistance determination, and examiner certification.

Classification or approval does not promote a Form 1823 source. The nurse-authorized apply command atomically creates the accepted resident document, writes the structured Form 1823 record, and updates admission checklist evidence. A failure rolls back all three.

## AI and PHI boundary

External parsing is disabled unless `ai_invocation_policies.allow_phi` is true for the organization and routing names an approved provider. A missing policy is a hard no-provider state, not implicit consent. The source is preserved and the manual workflow remains usable.

The parser stores request/response hashes and sanitized status metadata, not full prompts or full model responses. Authorization is revalidated after the provider response and immediately before staging proposals.

`ANTHROPIC_API_KEY` remains server-only. `RESIDENT_RECORD_INTAKE_MODEL` is optional non-secret configuration selecting the approved current model.

## Recovery and rollback

- Browser/network uncertainty reuses the same request key. Exact replay returns the prior result; changed scope/content conflicts.
- Reparse appends a parse run and supersedes only unresolved proposals.
- Reviewer corrections append a new manual proposal and retain original extraction.
- Apply receipts are immutable and idempotent.
- Source rollback hides the new routes while preserving source/intake/audit history. After canonical application, use forward correction or supersession; do not delete historical clinical/legal evidence.
- Credential purge is a security-only exception for a source that never became a resident record and requires explicit authorized action.

## Release boundary

Automated tests and source gates prove repository behavior only. Production schema deployment, AI provider/BAA approval, live secrets, Homewood staff workflow acceptance, clinical acceptance, and release acceptance remain separate gates.

