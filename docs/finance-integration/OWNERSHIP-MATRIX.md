# Finance integration ownership matrix

Status: PROPOSED ROLE ASSIGNMENTS; named appointments and delegations are OPEN (D02/D07). Prepared from the source handoff on 2026-09-08. This document neither appoints people nor grants application access. Existing `owner`, `org_admin`, and `facility_admin` roles are implementation context, not evidence of finance authority. Every acceptance ID remains governed by `ACCEPTANCE-MATRIX.json`; this table does not change its status.

The accounting company owns official books; Haven owns detailed resident finance, approved time and purchasing evidence. The selected payroll provider owns actual payroll; bank/processor evidence owns settlement. Controller review is distinct from preparer work. Security review and accounting acceptance require independent human authority; engineering authors cannot self-approve a release.

| Acceptance ID | Phase / requirement | Proposed implementation role | Proposed accountable reviewer / business role | Named person / delegation evidence |
|---|---|---|---|---|
| HFA-001 | F00 — Baseline and target identity | Integration lead | Controller + privacy/security reviewer | OPEN — D02/D07 |
| HFA-002 | F00 — Complete entity and product inventory | Integration lead | Controller + privacy/security reviewer | OPEN — D02/D07 |
| HFA-003 | F00 — Approved ownership and accounting policy | Integration lead | Controller + privacy/security reviewer | OPEN — D02/D07 |
| HFA-004 | F00 — Approved outbound privacy policy | Integration lead | Controller + privacy/security reviewer | OPEN — D02/D07 |
| HFA-005 | F00 — Complete audit action inventory | Integration lead | Controller + privacy/security reviewer | OPEN — D02/D07 |
| HFA-006 | F00 — Quantified operating targets | Integration lead | Controller + privacy/security reviewer | OPEN — D02/D07 |
| HFA-007 | F01 — Atomic payment and allocation | Finance database engineer | Independent security + accounting-workflow reviewer | OPEN — D02/D07 |
| HFA-008 | F01 — Content-bound idempotency | Finance database engineer | Independent security + accounting-workflow reviewer | OPEN — D02/D07 |
| HFA-009 | F01 — Atomic journal posting | Finance database engineer | Independent security + accounting-workflow reviewer | OPEN — D02/D07 |
| HFA-010 | F01 — Posted journal and period enforcement | Finance database engineer | Independent security + accounting-workflow reviewer | OPEN — D02/D07 |
| HFA-011 | F01 — Finance entity and current actor boundaries | Finance database engineer | Independent security + accounting-workflow reviewer | OPEN — D02/D07 |
| HFA-012 | F01 — Audit export authorization repair | Finance database engineer | Independent security + accounting-workflow reviewer | OPEN — D02/D07 |
| HFA-013 | F03 — Approval invalidation and separation | Integration engine engineer | Independent security + reliability reviewer | OPEN — D02/D07 |
| HFA-014 | F02 — One authoritative resident-money ledger | Resident-money and cutover engineer | Controller + resident-funds operator | OPEN — D02/D07 |
| HFA-015 | F02 — Trust transaction correctness | Resident-money and cutover engineer | Controller + resident-funds operator | OPEN — D02/D07 |
| HFA-016 | F02 — Trust three-way reconciliation | Resident-money and cutover engineer | Controller + resident-funds operator | OPEN — D02/D07 |
| HFA-017 | F02 — Typed historic opening balances | Resident-money and cutover engineer | Controller + resident-funds operator | OPEN — D02/D07 |
| HFA-018 | F02 — Repeatable historical import | Resident-money and cutover engineer | Controller + resident-funds operator | OPEN — D02/D07 |
| HFA-019 | F02 — Accepted cutover controls | Resident-money and cutover engineer | Controller + resident-funds operator | OPEN — D02/D07 |
| HFA-020 | F03 — Atomic durable outbound intent | Integration engine engineer | Independent security + reliability reviewer | OPEN — D02/D07 |
| HFA-021 | F03 — Immutable aggregate membership | Integration engine engineer | Independent security + reliability reviewer | OPEN — D02/D07 |
| HFA-022 | F03 — Unknown external outcome | Integration engine engineer | Independent security + reliability reviewer | OPEN — D02/D07 |
| HFA-023 | F03 — Worker concurrency and recovery | Integration engine engineer | Independent security + reliability reviewer | OPEN — D02/D07 |
| HFA-024 | F03 — Inbox correctness | Integration engine engineer | Independent security + reliability reviewer | OPEN — D02/D07 |
| HFA-025 | F03 — Connection and credential lifecycle | Integration engine engineer | Independent security + reliability reviewer | OPEN — D02/D07 |
| HFA-026 | F03 — Outbound stop controls | Integration engine engineer | Independent security + reliability reviewer | OPEN — D02/D07 |
| HFA-027 | F03 — Privacy allowlist enforcement | Integration engine engineer | Independent security + reliability reviewer | OPEN — D02/D07 |
| HFA-028 | F04 — QBO adapter capability proof | Provider adapter engineer | Controller + provider operator | OPEN — D02/D07 |
| HFA-029 | F04 — Desktop adapter capability proof | Provider adapter engineer | Controller + provider operator | OPEN — D02/D07 |
| HFA-030 | F04 — Quicken exchange capability proof | Provider adapter engineer | Controller + provider operator | OPEN — D02/D07 |
| HFA-031 | F04 — Full snapshot and catch-up completeness | Provider adapter engineer | Controller + provider operator | OPEN — D02/D07 |
| HFA-032 | F04 — Import quarantine | Provider adapter engineer | Controller + provider operator | OPEN — D02/D07 |
| HFA-033 | F04 — Capability-aware UI | Provider adapter engineer | Controller + provider operator | OPEN — D02/D07 |
| HFA-034 | F05 — Validated summary booking model | Accounting bridge engineer | Controller | OPEN — D02/D07 |
| HFA-035 | F05 — No detail and summary duplication | Accounting bridge engineer | Controller | OPEN — D02/D07 |
| HFA-036 | F05 — Exact monetary representation | Accounting bridge engineer | Controller | OPEN — D02/D07 |
| HFA-037 | F05 — Correction lifecycle | Accounting bridge engineer | Controller | OPEN — D02/D07 |
| HFA-038 | F05 — Source to provider tie-out | Accounting bridge engineer | Controller | OPEN — D02/D07 |
| HFA-039 | F06 — Contractual charge generation | Billing engineer | Billing operator + controller | OPEN — D02/D07 |
| HFA-040 | F06 — Payer responsibility and authorization | Billing engineer | Billing operator + controller | OPEN — D02/D07 |
| HFA-041 | F06 — Multi-invoice receipt allocations | Billing engineer | Billing operator + controller | OPEN — D02/D07 |
| HFA-042 | F06 — Remittance and denial lifecycle | Billing engineer | Billing operator + controller | OPEN — D02/D07 |
| HFA-043 | F06 — Refund and settlement semantics | Billing engineer | Billing operator + controller | OPEN — D02/D07 |
| HFA-044 | F06 — Resident lifecycle and fund disposition | Billing engineer | Billing operator + controller | OPEN — D02/D07 |
| HFA-045 | F07 — Purchasing/AP control chain | AP/payroll engineer | AP operator + payroll operator + controller | OPEN — D02/D07 |
| HFA-046 | F07 — Vendor banking change authority | AP/payroll engineer | AP operator + payroll operator + controller | OPEN — D02/D07 |
| HFA-047 | F07 — Payroll acknowledgment and actuals | AP/payroll engineer | AP operator + payroll operator + controller | OPEN — D02/D07 |
| HFA-048 | F07 — Historical payroll and duplicate prevention | AP/payroll engineer | AP operator + payroll operator + controller | OPEN — D02/D07 |
| HFA-049 | F07 — Overhead and capital classifications | AP/payroll engineer | AP operator + payroll operator + controller | OPEN — D02/D07 |
| HFA-050 | F07 — Intercompany and consolidation | AP/payroll engineer | AP operator + payroll operator + controller | OPEN — D02/D07 |
| HFA-051 | F08 — Opening movement closing reports | Financial reporting engineer | Controller + independent test reviewer | OPEN — D02/D07 |
| HFA-052 | F08 — No silent financial truncation | Financial reporting engineer | Controller + independent test reviewer | OPEN — D02/D07 |
| HFA-053 | F08 — Stable reproducible snapshots | Financial reporting engineer | Controller + independent test reviewer | OPEN — D02/D07 |
| HFA-054 | F08 — Source status truthfulness | Financial reporting engineer | Controller + independent test reviewer | OPEN — D02/D07 |
| HFA-055 | F08 — Reconciliation exception workflow | Financial reporting engineer | Controller + independent test reviewer | OPEN — D02/D07 |
| HFA-056 | F09 — All-domain audit coverage | Platform audit engineer | Privacy/security reviewer + records custodian | OPEN — D02/D07 |
| HFA-057 | F09 — Enforced sensitive read audit | Platform audit engineer | Privacy/security reviewer + records custodian | OPEN — D02/D07 |
| HFA-058 | F09 — Actor and historical provenance | Platform audit engineer | Privacy/security reviewer + records custodian | OPEN — D02/D07 |
| HFA-059 | F09 — Complete authorized evidence export | Platform audit engineer | Privacy/security reviewer + records custodian | OPEN — D02/D07 |
| HFA-060 | F09 — Audit integrity and secret exclusion | Platform audit engineer | Privacy/security reviewer + records custodian | OPEN — D02/D07 |
| HFA-061 | F09 — Retention legal hold and recovery | Platform audit engineer | Privacy/security reviewer + records custodian | OPEN — D02/D07 |
| HFA-062 | F09 — Clinical continuity during audit outage | Platform audit engineer | Privacy/security reviewer + records custodian | OPEN — D02/D07 |
| HFA-063 | F10 — Operational Finance navigation | Finance UX engineer | Controller + facility tester + accessibility reviewer | OPEN — D02/D07 |
| HFA-064 | F10 — Evidence-based close and reopen | Finance UX engineer | Controller + facility tester + accessibility reviewer | OPEN — D02/D07 |
| HFA-065 | F10 — Least-privilege drill-down | Finance UX engineer | Controller + facility tester + accessibility reviewer | OPEN — D02/D07 |
| HFA-066 | F10 — Constrained useful AI | Finance UX engineer | Controller + facility tester + accessibility reviewer | OPEN — D02/D07 |
| HFA-067 | F10 — Offline owner and approval safety | Finance UX engineer | Controller + facility tester + accessibility reviewer | OPEN — D02/D07 |
| HFA-068 | F11 — Required tests actually execute | Release/reliability engineer | Independent code/security/accounting reviewers | OPEN — D02/D07 |
| HFA-069 | F11 — Targeted independent reviews | Release/reliability engineer | Independent code/security/accounting reviewers | OPEN — D02/D07 |
| HFA-070 | F11 — Measured performance and operations | Release/reliability engineer | Independent code/security/accounting reviewers | OPEN — D02/D07 |
| HFA-071 | F11 — Restore before source creation and external posting | Release/reliability engineer | Independent code/security/accounting reviewers | OPEN — D02/D07 |
| HFA-072 | F11 — Verified release and rollback package | Release/reliability engineer | Independent code/security/accounting reviewers | OPEN — D02/D07 |
| HFA-073 | F12 — Explicit live activation authority | Deployment and rollout operator | Named controller + named facility acceptor | OPEN — D02/D07 |
| HFA-074 | F12 — Hosted layer and read-only shadow proof | Deployment and rollout operator | Named controller + named facility acceptor | OPEN — D02/D07 |
| HFA-075 | F12 — Scoped first production batch | Deployment and rollout operator | Named controller + named facility acceptor | OPEN — D02/D07 |
| HFA-076 | F12 — Sustained real operating cycles | Deployment and rollout operator | Named controller + named facility acceptor | OPEN — D02/D07 |
| HFA-077 | F12 — Every active entity accepted | Deployment and rollout operator | Named controller + named facility acceptor | OPEN — D02/D07 |
| HFA-078 | F12 — Training ownership and final evidence | Deployment and rollout operator | Named controller + named facility acceptor | OPEN — D02/D07 |
| HFA-079 | F03 — Verified pre-dispatch evidence recoverability | Integration engine engineer | Independent security + reliability reviewer | OPEN — D02/D07 |

Each active entity needs a controller, backup operator, privacy/security reviewer and facility tester recorded with current scoped identity, acceptance remit, effective date and evidence reference. Do not copy one facility approval to another entity. Follow the verified rollout sequence; AGENTS.md historical facility labels are discovery leads only.

Source anchors: `AGENTS.md` (client context and current rollout sequence); `docs/specs/00-foundation.md` (role model); `/Users/brianlewis/Circle of Life/Haven Finance and Audit Roadmap 2026-09-08/END-TO-END-BUILD-HANDOFF.md` (authoritative ownership, D02/D07, and F12); source matrix HFA-001–HFA-079. HFA-079 is retained under F03.

Source refresh: original reviewed `3dec84bbdc216d1c58e7296568b007ebe6f101be`; newer main `fad17dcc4bd2dc1deb35400b309c65a047b8de83` integrated at `63e8909a6b17ed11a398052d5baa4de6eec2aeba`. HFA-047/048 owners must reuse upstream payroll source-freshness migration 334. HFA-005/056/057/058/060/065 coverage also includes employee-file lifecycle 335 and its confidential medical/personnel storage paths. Proposed roles and all 79 assignments remain unchanged; no new named signers or acceptance claims are introduced.
