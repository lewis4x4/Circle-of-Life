# Employee lifecycle source register

Reviewed 2026-09-08. This register replaces the pasted document's claim that every statement was extracted authoritatively. It is a draft requirements inventory, not approved employment policy, a legal opinion, or proof of deployed functionality.

## Evidence and counts

The three original PDFs contain 82 pages: SECTION1-2.pdf 13, SECTION 3.pdf 33, SECTION 4-5.pdf 36. Page references below are one-based PDF pages including dividers. SHA-256 hashes are recorded in `document-register.json`; original documents remain outside the repository.

All 82 pages were rendered and OCR-processed in private run scratch. Headings and relevant passages were checked. Orientation (S45 p7), training audit (p8), medication completion (p26), and DPC election (S3 p32) received visual verification. Other catalog entries are OCR-checked; signer labels require visual approval before publishing a form. OCR is not a substitute for final form proofreading.

`document-register.json` groups the source into 40 document/reference groups including the index. `requirements.json` now includes full page-delimited OCR draft transcription for 37 document groups, official-form references for W-4/I-9, and precise source-item descriptions for orientation/training. An additional 67 source pages were OCR-processed at 2400-pixel resolution for this content enhancement. Transcription is explicitly unproofread draft source material; it preserves historical wording and known problematic provisions rather than silently rewriting them. Approval must produce a checked, current usable version before anyone signs it. The government references are completion-tracking directions, not substitutes for official forms or text to sign.

`requirements.json` contains 95 proposed entries: 30 orientation items, 26 training/health audit labels, and 39 document/reference groups excluding the index. These are catalog counts, NOT required documents per employee, signature events, or independent completion requirements. A reference handout and its acknowledgment must not cause duplicate assignments. Government-form conditional signers follow the current official form, not a universal preset.

## Corrections to the pasted extraction

- The application occupies S45 pp2–4 (three pages); p5 is a separate new-hire information sheet.
- S3 has 13 grouped documents, but their categories include benefits and treatment consent as well as policies. They do not all belong in a policy table.
- Three witness-bearing forms appear: drug-free acknowledgment S3 p18, workplace safety S3 p23, DPC election S3 p32. A witness is not interchangeable with a supervisor. Printed-name fields are not extra signatures.
- The audit S45 p8 has 26 entries, including health statements and TB evidence. Only four explicitly say annual: medication assistance, food handling, four-hour Alzheimer's update, three-hour LMH continuing education. Nine update lines do not establish nine renewal schedules. Absence of recurrence means unknown, not one-time.
- Only the first two audit rows explicitly tie completion to resident interaction/personal care. S3 p5 independently states a 30-day elopement in-service deadline; do not generalize that deadline to all training. Catalog due dates remain unset pending an approved version and applicability.
- The p7 checklist has 30 named items; medication hands-on x3 occupies three date/initial rows. The p26 form states two days of hands-on training, has one course date plus four one-on-one training dates, and has employee/trainer/administrator signatures. It does not establish five required hands-on sessions. Preserve session evidence and days separately while DEC-02 remains open.
- First day on the floor is a historical event. Record an actual premature start and flag an exception; never rewrite history into a computed eligibility date.
- Role presets, facility LMH designations, legal entities, existing schema availability, current named employee responsibilities, five-building workflow, Gmail usage, and lack of other health coverage are not established by these scans.
- Attendance and separation involve judgment, leave exclusions, overlapping counters, and discretionary credit. Calculations propose review; they cannot terminate an employee or grant legal eligibility.
- Safety S3 p27 contains the obsolete three-hospitalization reporting rule. It is superseded by the official reporting reference in the risk register, not copied into active task deadlines.
- Password on S45 p8 must not become an employee-file field. Use account invitation/access state.

## Activation contract

Every catalog entry starts draft. Preserve source filename/page, document version, interpretation, decision dependencies, applicability, approver, approval time and effective date. Assignment uses an approved immutable version. A newly discovered source or revised policy cannot silently rewrite prior acknowledgments.

Unknown applicability/deadline/renewal must be visible. A person is not cleared solely because no known requirements were assigned. Distinguish missing configuration, pending evidence, verified completion, expired evidence, and approved not-applicable decisions.

No original sensitive PDF, completed employee information, SSN, bank details, medical narrative, or passwords are committed here. The catalog can name restricted forms without exposing completed content. Clinical, payroll, and screening evidence access must be checked independently from ordinary staff record access.

## Files

- `document-register.json`: source hashes, document groups, pages, category and evidence status.
- `requirements.json`: UI-importable draft requirement catalog; source excerpts are normalized headings unless explicitly verbatim. No automatic deployment or activation is implied.
- `risk-and-decisions.md`: corrected findings, official references and external approval queue.
- `acceptance-criteria.md`: behavior and verification requirements for the builder/reviewer.

## Independent security review follow-up

Source review on 2026-09-08 confirmed two reported integrity issues were corrected in migration 335: nurse/coordinator callers cannot assert supervisor/administrator capacity; trainer capacity is limited to manager or nurse; one actor cannot fill several signing capacities on one record. Attendance classification now requires an independent manager and rejects self-review. The source SQL review script includes negative cases for nurse-as-supervisor and self-exclusion. This paragraph records source verification, not a fresh hosted database execution result.

Countersigner record visibility is purpose-scoped in SQL and still excludes medical records without a confidential grant or employee self-access. The API uses the caller client for all data and commands. Reviewer roster reads require owner/org-admin and expose active organization choices with current facility grants. The medical reviewer UI uses named account choices rather than asking users to type UUIDs.

Final executed results are recorded in `VERIFICATION.md`; delivered routes, schema reconciliation, and activation boundaries are in `IMPLEMENTATION.md`. Mocked API tests do not replace executed RLS, Storage, actor-revocation or hosted journey checks.
