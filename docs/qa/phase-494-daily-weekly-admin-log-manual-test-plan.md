# Manual test plan — COL-494 Daily/Weekly Admin Log

**Audience:** Engineering verification and later Homewood UAT  
**Environment:** Haven HFO Staging `iwcnajanvjvynolltflw`, local exact-source Next application  
**Personas:** Synthetic facility administrator, synthetic corporate owner, synthetic second-site administrator  
**Viewports:** tablet 768×1024 primary; desktop 1280×800; mobile 375×812  
**Maps to:** [QA Gate 494](./QA_GATES.md#gate-494--dailyweekly-admin-log)

The fixture publishes explicitly synthetic rules. It never writes Homewood's actual task profile. Actual configuration, staff acceptance and paper retirement remain COL-226/COL-140/COL-20/COL-21.

## Scenarios

| ID | Scenario | Expected | Result | Evidence |
|---|---|---|---|---|
| P494-A1 | Full profile contract | Current Homewood staging profile reports 91 source items / 110 components; AL-D15 remains visible as needing confirmation; unknown timing has no due judgment. | PASS | `browser-proof.json`, profile screenshots |
| P494-A2 | Daily/Weekly inventory | Synthetic organization exposes 27 source rows / 35 components, creates 34 tasks, and withholds a task for subject-unknown AL-D15. | PASS | fixture output, journey register |
| P494-B1 | Routine completion after lost answer | D01 server commit survives a deliberately dropped response; automatic readback reconciles one receipt and no duplicate. | PASS | `routineRecovery` |
| P494-B2 | Append-only correction | D01 correction records a new receipt/history result without rewriting the original. | PASS | `correction`, corporate history |
| P494-C1 | Conditional evidence | D03 records performed work, remains evidence-incomplete, then finalizes a scoped image through prepare → PUT → uploaded → finalize. | PASS | `conditionalEvidence` |
| P494-C2 | Help and absence coverage | D03 exposes supplemental help and accepted synthetic owner/backup coverage without treating that as Homewood acceptance. | PASS | `helpAndCoverage` |
| P494-D1 | Failed generator observation | W01 records a named-asset staff observation as failed, creates an open issue, and satisfies only the matching synthetic occurrence. | PASS | `generatorFailure` |
| P494-D2 | Source invalidation | Voiding the source observation invalidates its satisfaction while the failed-result issue remains open. | PASS | `generatorFailure.sourceVoid`, Needs Attention |
| P494-E1 | Census source context | D17 shows the explicit day's census snapshot while the separate human action records the checklist work. | PASS | `censusContext` |
| P494-E2 | Resident source review | D12 selects a version-pinned vital source and records a review without inferring a clinical conclusion. | PASS | `residentSourceReview` |
| P494-E3 | Employee File context | W06 exposes the authorized Employee File path and separately records the review without an employment action. | PASS | `employeeFileContext` |
| P494-F1 | Corporate history | Corporate sees D01 attribution and correction history. | PASS | `corporate.historyCorrectionVisible` |
| P494-F2 | Needs Attention | Corporate sees the generator failure issue after source invalidation. | PASS | `corporate.generatorIssueVisible` |
| P494-G1 | Cross-site denial | A second-site administrator receives 404/Facility not found for the first site's workspace. | PASS | `secondSiteDenial` |
| P494-H1 | Responsive and accessible surfaces | Work/profile render at 1280×800, 768×1024 and 375×812 with zero axe, page or unexpected console failures. | PASS | screenshots and viewport rows |

## Coverage boundary

The representative browser scenarios test each distinct interaction class. The [journey register](../facility-operations/col494-evidence/daily-weekly-journey-register.md) traces all 27 source rows and 35 components. Ten rows remain explicit source-definition/integration questions; they appear in [Homewood Wave 1 questions](../facility-operations/col494-evidence/homewood-wave-1-questions.md) and are not mislabeled as successful integrations.

## Pass criteria

All P494 scenarios pass, Gate 494 is green, no open P0/P1 remains, exact source/revision and target are recorded, and the synthetic fixture is retired with current access readback. The result is engineering proof only.

