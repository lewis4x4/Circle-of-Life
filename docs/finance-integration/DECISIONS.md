# Finance integration decision register

Recorded 2026-09-08. All business decisions below are **OPEN / NOT APPROVED** unless their evidence is subsequently entered. Existing records are discovery leads; the user handoff supplies engineering defaults, not accounting/privacy acceptance. No accounting company, account, balance, named signer or production authority is inferred. The hosted inventory below separately verifies stored Haven entities/facilities.

## D01 — Entity and product inventory / CircleFlow

- Proposed decision owner: Owner + controller; named appointment OPEN.
- Evidence inspected: AGENTS.md client context names five facilities/LLCs and Homewood-first sequence; module 17 repeats historical structure. HOSTED-INVENTORY.json verifies five stored active entity/facility relationships; legal completeness and company-file/product inventory remain unapproved. CircleFlow remains an unconfirmed COL workflow label.
- Required fact/decision: Current active legal entities, facilities and relationships; product/edition/OS/company file and bank/trust account references per entity.
- Status: OPEN. Effective date: NOT SET. Affected entities: five hosted active entity rows in HOSTED-INVENTORY.json; official-book scope unapproved.
- Dependent acceptance: HFA-002, HFA-028–030, HFA-073–077. These dependencies restrict activation or final acceptance; shared engine, synthetic cases and repair work may continue.
- Approval evidence / signer / timestamp: NONE.

## D02 — Named accountable operators and reviewers

- Proposed decision owner: Owner; named appointment OPEN.
- Evidence inspected: Existing app roles are documented, but no scoped appointments for this finance integration are evidenced. Historical names in response logs do not appoint signers.
- Required fact/decision: Controller, backup, privacy/security reviewer, payroll/AP/funds operators and facility testers with current identity and scope.
- Status: OPEN. Effective date: NOT SET. Affected entities: five hosted active entity rows in HOSTED-INVENTORY.json; official-book scope unapproved.
- Dependent acceptance: HFA-003–006, HFA-019, HFA-034, HFA-061, HFA-069–070, HFA-073–078. These dependencies restrict activation or final acceptance; shared engine, synthetic cases and repair work may continue.
- Approval evidence / signer / timestamp: NONE.

## D03 — Official books and accounting model

- Proposed decision owner: Controller; named appointment OPEN.
- Evidence inspected: Module 17 requires per-entity COA and asks whether charts are shared; budgets are not supplied there. USD cents and America/New_York are repo conventions, not signed entity policy.
- Required fact/decision: Official book owner/company, basis, fiscal calendar, timezone/currency, chart/control accounts/dimensions, intercompany and materiality rules.
- Status: OPEN. Effective date: NOT SET. Affected entities: five hosted active entity rows in HOSTED-INVENTORY.json; official-book scope unapproved.
- Dependent acceptance: HFA-003, HFA-014–019, HFA-034–038, HFA-049–055, HFA-064, HFA-075–077. These dependencies restrict activation or final acceptance; shared engine, synthetic cases and repair work may continue.
- Approval evidence / signer / timestamp: NONE.

## D04 — Outbound privacy and vendor suitability

- Proposed decision owner: Privacy/security reviewer + controller; named appointment OPEN.
- Evidence inspected: User handoff locks non-identifying approved summaries, no resident details/free text; source research V01/V02 is the vendor-reference lead. No approved aggregation policy is evidenced.
- Required fact/decision: Versioned payload allowlist, aggregation granularity/context review, contract suitability and re-identification review.
- Status: OPEN. Effective date: NOT SET. Affected entities: five hosted active entity rows in HOSTED-INVENTORY.json; official-book scope unapproved.
- Dependent acceptance: HFA-004, HFA-027–030, HFA-034, HFA-059–061, HFA-066, HFA-073–075. These dependencies restrict activation or final acceptance; shared engine, synthetic cases and repair work may continue.
- Approval evidence / signer / timestamp: NONE.

## D05 — Cutover and reconciled opening records

- Proposed decision owner: Controller + funds/billing operators; named appointment OPEN.
- Evidence inspected: Module 16 describes historical AR and Statement of Accounts.xlsx; current opening balances, source files and cutover watermark are not evidenced.
- Required fact/decision: Effective date, reconciled TB/AR/AP/trust/cash/payroll, duplicate dispositions, history retention and approved opening bridge.
- Status: OPEN. Effective date: NOT SET. Affected entities: five hosted active entity rows in HOSTED-INVENTORY.json; official-book scope unapproved.
- Dependent acceptance: HFA-017–019, HFA-035, HFA-048, HFA-051, HFA-071, HFA-074–077. These dependencies restrict activation or final acceptance; shared engine, synthetic cases and repair work may continue.
- Approval evidence / signer / timestamp: NONE.

## D06 — Specialist interfaces and transaction origins

- Proposed decision owner: Payroll/AP/billing operators + controller; named appointment OPEN.
- Evidence inspected: May 6 response log says ADP API scoping starts; staffing UI says ADP-linked directory. Current upstream 334 supplies guarded source-fresh payroll snapshots; generic CSV still does not establish accepted ADP/Gusto templates. Module 16 lists payer leads; none proves accepted current interfaces.
- Required fact/decision: Actual payroll product/company/template, MCO/remittance and bank/processor feeds, bill creation/payment origin, approved templates and provider readback evidence.
- Status: OPEN. Effective date: NOT SET. Affected entities: five hosted active entity rows in HOSTED-INVENTORY.json; official-book scope unapproved.
- Dependent acceptance: HFA-028–033, HFA-039–050, HFA-055, HFA-075–077. These dependencies restrict activation or final acceptance; shared engine, synthetic cases and repair work may continue.
- Approval evidence / signer / timestamp: NONE.

## D07 — Scoped separation and automation authority

- Proposed decision owner: Owner + controller + security reviewer; named appointment OPEN.
- Evidence inspected: Foundation role model and existing current-actor patterns are reusable, but finance action delegations are not supplied.
- Required fact/decision: Prepare/approve/release/reconcile/close/reopen/mapping/bank-change authority, material thresholds and current automation delegation.
- Status: OPEN. Effective date: NOT SET. Affected entities: five hosted active entity rows in HOSTED-INVENTORY.json; official-book scope unapproved.
- Dependent acceptance: HFA-003, HFA-011, HFA-013, HFA-023, HFA-026, HFA-037, HFA-046, HFA-064–067, HFA-073–075. These dependencies restrict activation or final acceptance; shared engine, synthetic cases and repair work may continue.
- Approval evidence / signer / timestamp: NONE.

## D08 — Retention, recovery, operating targets and spend

- Proposed decision owner: Records custodian + security reviewer + controller + operations owner; named appointment OPEN.
- Evidence inspected: Existing retention/recovery context must be retained. No finance-specific approved category policy, measured recovery target or integration spend authorization found in inspected source.
- Required fact/decision: Category retention/legal hold, key custody, RPO/RTO, alert routing/backup, cadence, throughput targets and spend ceiling.
- Status: OPEN. Effective date: NOT SET. Affected entities: five hosted active entity rows in HOSTED-INVENTORY.json; official-book scope unapproved.
- Dependent acceptance: HFA-006, HFA-023, HFA-025, HFA-060–062, HFA-070–072, HFA-078–079. These dependencies restrict activation or final acceptance; shared engine, synthetic cases and repair work may continue.
- Approval evidence / signer / timestamp: NONE.

## D09 — Environments and exact activation scope

- Proposed decision owner: Owner + deployment operator + controller; named appointment OPEN.
- Evidence inspected: Read-only HOSTED-INVENTORY.json verifies manfqmasfqppukpobpld.supabase.co for the recorded query. Handoff disables production outbound. Netlify/staging/provider company identities and activation remain unverified.
- Required fact/decision: Verified synthetic/staging/production identities and signed per-entity/company/payload/mapping/transaction activation scope.
- Status: OPEN. Effective date: NOT SET. Affected entities: five hosted active entity rows in HOSTED-INVENTORY.json; official-book scope unapproved.
- Dependent acceptance: HFA-001–002, HFA-025–030, HFA-068–077. These dependencies restrict activation or final acceptance; shared engine, synthetic cases and repair work may continue.
- Approval evidence / signer / timestamp: NONE.

The current defaults are: resident detail and membership remain in Haven; external accounting owns official books; USD integer-cent fixtures only; no guessed account mappings, paid changes or deletion; no automatic history re-export; separate material preparer/approver; production outbound disabled. Payment initiation, payroll submission and external messages need separately identified authorization.

Source anchors: `AGENTS.md` client context; `docs/specs/17-entity-facility-finance.md:276`; `docs/specs/16-billing.md:442`; `docs/specs/19-vendor-contract-management.md:571`; `docs/specs/13-payroll-integration.md:45`; `docs/specs/COL-RESPONSE-LOG-2026-05-06.md:192`; `src/components/staffing/AdminStaffingConsolePageClient.tsx:303`; `src/lib/payroll/payroll-export-csv.ts:92`; source handoff D01–D09 and companion `SOURCE-EVIDENCE.md` E20/V01–V08. Historical five-facility/five-LLC notes are not a schema invariant or a signed current inventory.

Proposed engineering targets pending D08 approval and measurement: preserve every existing stricter repository budget; interactive finance/report preparation p95 <= 2 seconds at a documented representative dataset; asynchronous 100,000-row export <= 60 seconds with exact counts/hashes and an explicit pending state; alert delivery <= 5 minutes after a configured stale/failed/unknown-outcome threshold; rehearsed service restoration <= 4 hours. Recovery tolerance for acknowledged external economic effects is zero lost recoverable commands: verified protected evidence must precede dispatch (HFA-079). A provisional <= 5 minute general-data RPO must never permit loss of that financial recovery evidence. These are proposals, not current performance, approved SLAs or permission to weaken budgets. Establish actual expected/high portfolio volume and cadence before HFA-006 passes.

Consolidated information request for the owner/controller: provide one current per-entity inventory covering active facilities and their relationships; accounting product/edition/OS/company and bank/trust references; the controller/backup/security/facility acceptors; approved basis/calendar/COA/control accounts; payroll/MCO/bank interfaces and bill/payment origin; reconciled opening/cutover files; and existing payload, delegation, retention/recovery and activation policies. References to secured records are sufficient; do not place credentials or resident records in this register.

## Hosted inventory observed by the implementation lead

`HOSTED-INVENTORY.json` records a read-only REST observation of `manfqmasfqppukpobpld.supabase.co` at `2026-09-08T22:55:40.799Z`. It reports complete retrieval of one organization, five active entity rows and five active facility rows. This verifies stored Haven relationships at that observation; it does not establish legal completeness, current product/company bindings, account policy, book balances or business acceptance. All observed facilities use America/New_York.

| Hosted facility | Stored legal entity relationship |
|---|---|
| Oakridge ALF | Pine House, Inc. |
| Rising Oaks ALF | Smith & Sorensen LLC |
| Homewood Lodge, ALF | Sorensen, Smith & Bay LLC |
| The Plantation on Summers | The Plantation on Summers, LLC |
| Grande Cypress ALF | Grande Cypress ALF LLC |

Exact UUIDs and query counts are retained in `HOSTED-INVENTORY.json`; do not invent accounting company IDs from these Haven IDs. Read-only counts: `invoices` 90, `payments` 0, `journal_entries` 0, `journal_entry_lines` 0, `audit_log` 10808, `resident_trust_accounts` 0, `resident_trust_transactions` 0, `trust_account_entries` 0, `payroll_export_batches` 0, `vendor_invoices` 0. These are table counts at observation, not reconciled accounting totals. The 10,808 audit rows exceed the configured 1,000 REST cap and make complete-export tests material. Zero recorded payments/journals does not prove no actual external activity. The expected hosted Supabase target was verified for this read; Netlify, staging and provider identities/activation remain open.

## Upstream and hosted refresh — 2026-09-08

The original handoff/source review remains `3dec84bbdc216d1c58e7296568b007ebe6f101be`. The implementation lead verified newer main/deployed source `fad17dcc4bd2dc1deb35400b309c65a047b8de83` and integrated it at `63e8909a6b17ed11a398052d5baa4de6eec2aeba`. This refresh reads the committed integration delta; in-progress finance 336/audit 337 and other uncommitted root edits remain provisional and are not acceptance evidence. `HOSTED-MIGRATIONS.json` records read-only SQL against `manfqmasfqppukpobpld` at `2026-09-08T23:00:30.493Z`: 344 migration-history records, with numbered sequence through 335 plus timestamped records. Migration-history presence is not runtime, authorization, payroll-provider or finance reconciliation proof.

Upstream `supabase/migrations/334_payroll_source_freshness.sql` adds punch source revisions, source freshness checks, serialized payroll writes, immutable historical exported lines, editable-draft refresh/exclusion commands and guarded snapshot export. Current `src/app/(admin)/payroll/[id]/page.tsx` calls `refresh_payroll_time_records`, `exclude_payroll_draft_punch` and `payroll_export_snapshot`; CSV comes from the returned snapshot and verifies line count. Reuse these controls and test their current behavior; do not reconstruct a stale client-only payroll architecture from older module documents. Generic CSV still does not prove actual ADP company binding, proprietary-template acceptance, payroll actuals or settlement. Historical exported evidence is retained, with the UI explicitly noting that legacy batches lack an original file archive.

Upstream `supabase/migrations/335_employee_file_lifecycle.sql` introduces six employee-file tables (requirements, medical access, records, signatures, duty events and audit events), scoped command/helper functions, personnel/medical storage boundaries and immutable history. Actual routes include `/employee-file`, `/employee-file/reviews/[id]`, `/admin/staff/[id]/employee-file` and the staff employee-file API/catalog/requirements/training/download handlers. The download handler records `record_download` through `haven_employee_file_command` before requesting a 60-second signed URL. This is an existing implementation to inspect and extend, not proof every direct storage/SQL/read path is audited. Employee medical evidence must remain separately scoped and confidential payloads excluded from general audit history.

D06 therefore remains OPEN for the actual provider/company, accepted template/acknowledgment and payroll actuals, while existing payroll-source controls and employee-file implementation must be reused. D09 hosted migration-history identity is now evidenced through 335; exact runtime parity and any new finance activation remain separate.
