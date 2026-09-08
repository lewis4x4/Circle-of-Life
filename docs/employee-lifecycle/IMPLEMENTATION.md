# Employee packet implementation and review handoff

Branch: `codex/employee-file-lifecycle`. Base: `adb5ecb9` (current main when work began). Mission alignment: **pass for this engineering scope**; operational activation remains subject to the source decisions below.

## Delivered engineering scope

- Corrected source catalog: 82 pages, 40 source groups, 95 draft entries. Full draft OCR text for 37 document groups; current official-form references for W-4/I-9. No scan is declared approved policy merely because it was supplied.
- `/admin/staff/[id]/employee-file`, linked from the existing staff profile. Documents/onboarding, source/version management, evidence, signatures, duty readiness and attendance review are reachable through this page.
- `/employee-file` for employee self-service, linked from caregiver, medication-tech and dietary shells. `/employee-file/reviews` exposes only files in a caller's explicit medical-review grants; it does not expand the general staff-table policy.
- Explicit approved staff-role applicability, separately established deadlines/renewals, and minimum sessions/distinct training days. The medication checklist's count/day ambiguity remains unset in the draft. Empty applicability, unknown timing/count rules and absent upstream duty definitions do not produce clearance.
- Existing training completions, credentials and competency demonstrations can be inspected and referenced during evidence review. They remain different kinds of evidence. The existing training catalog and KB acknowledgment tables are not duplicated or silently reseeded.
- Immutable requirement versions, record-bound independent signing capacities, submission/rejection/verification, historical evidence and private attachments. Medical content uses a separate bucket and explicit grants; general management status is insufficient. Provider signatures are verified from source evidence, never impersonated by an administrator.
- Historical duty activity remains recordable. A database-derived aggregate readiness snapshot flags review needs without revealing medical detail. Its basis is requirements at recording time, explicitly **not** reconstruction of historical policy.
- Existing attendance and discipline tables extended for independent review and retraction. The existing staffing-console callout flow now calls the authorized RPC. Draft threshold suggestions never terminate employment, classify voluntary resignation, reset history or double-add tardy equivalents. Future hires receive a not-started state.
- Personnel checklist JSON export excludes medical records/signatures and free-text employee notes, even for a medical-authorized viewer. Export requests and evidence-download requests are audited. A request log does not assert that a recipient actually opened a file.

## Schema reconciliation

Migration `335_employee_file_lifecycle.sql` extends `staff_attendance_events` (189) and `staff_discipline_records` (143). It adds a source-backed employee-file requirement/evidence layer; it does not mistake organization onboarding (108) for employee onboarding or office KB acknowledgment requirements (292/324) for personnel forms.

The narrow `haven_employee_file_staff` RPC returns nine nonfinancial identity fields. This is necessary because existing staff-table RLS does not permit every authorized countersigner/reviewer to read a full staff row. General staff PII access is unchanged. All employee-file API queries, commands and Storage operations use the caller client; the service-role client is not used to bypass these policies.

Medical payloads are excluded from the general audit log. Dedicated employee-file audit events carry identifiers, action, actor and time only. Existing attendance records retain their existing audit trail; their UI explicitly asks for operational notes rather than diagnoses. Medical access rationales are retained with the restricted grant records.

## Policy activation and unresolved source decisions

Use `risk-and-decisions.md` for all 18 corrected risks and nine decisions. The major outstanding inputs are actual facility/role applicability, medication sessions versus days, approved attendance exceptions/counter treatment, current entity/policy wording, provider/payroll destinations and employment-law/benefits applicability. Government references do not retroactively invalidate or replace previously signed records.

Approving a requirement is an explicit authorized operation with an applicability selection and review rationale. The approver must compare OCR against the original scan and replace obsolete wording with the approved current text. OCR, official links and generated templates are discovery material, not legal or clinical approval.

## Boundaries and acceptance accounting

This delivers the employee-file/onboarding/readiness and attendance-decision-support build recommended in the review. The broader acceptance catalog also records future lifecycle/integration capabilities; those must not be conflated with this delivery:

| Acceptance area | Delivery status |
|---|---|
| Source/version provenance, signer roles, unknown requirements, historical evidence, uploads, counts, independent review, caller/medical isolation | Implemented; verification recorded separately |
| Actual duty event plus exception indication | Implemented as a snapshot at recording; historical policy reconstruction is not asserted |
| Structured application/payroll/medical field-by-field electronic form replicas | Source text and signed-evidence workflows provided; no government form reconstruction or invented clinical fields |
| Per-person declined/not-applicable decisions | Can be documented as reviewed source evidence; dedicated structured waiver/election state machine is not implemented |
| Payroll/provider submissions, receipts and offboarding integrations | No external destination has been configured or invoked; no transmission/coverage/account-change success is claimed |
| Automatic scheduling/clinical permission enforcement based on new duty readiness | Not activated; this view reports readiness and preserves factual history; existing background-screening scheduling protections remain |
| General knowledge/AI publication of packet policies | No draft or confidential employee material was published into KB retrieval |
| Current personnel-file compliance, FMLA/ACA analysis, entity confirmation and policy approval | External evidence/owner/legal decisions remain open |

These boundaries prevent a source packet from silently changing personnel policy or exporting sensitive records. They are not hidden green acceptance results.

## Validation and release

See `VERIFICATION.md` for executed results and artifacts. PostgreSQL replay uses an isolated native PostgreSQL 17 cluster with Supabase auth/storage stubs. Browser evidence uses production components/CSS against explicitly synthetic APIs at desktop/mobile sizes. Neither establishes authenticated hosted database/Storage behavior or owner UAT. The general segment UI gate covers `/`; the employee-specific browser harness supplies the actual component workflow checks.

No production migration, policy activation, employee-data import, provider transmission or deployment occurred in this task. Before release, review the diff, apply the migration to an authorized test environment, and exercise the real authenticated employee/countersigner/medical-reviewer Storage flows there. Existing broader Haven launch gates remain separate.
