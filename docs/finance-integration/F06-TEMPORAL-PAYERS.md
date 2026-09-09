# F06 temporal primary-payer selection

The app and Edge monthly producers now select a primary payer against the resident's known inclusive billable interval: requested month intersected with recorded admission/discharge. A June-effective Medicaid payer no longer controls a May invoice. A payer beginning on a May16 admission covers that resident's actual May16–31 interval; a month-start-only filter would incorrectly exclude it.

Every returned primary payer interval is validated. One overlapping primary must cover the entire known billable interval. Wholly nonoverlapping valid rows are ignored, and the established private-rate default remains when no primary overlaps. Invalid/missing/reversed resident or payer dates, overlapping primaries, gaps and mid-period transitions block the preview rather than choosing the last returned row or inventing a split. Already-invoiced residents remain excluded under the existing producer behavior. No source history is reconstructed.

Existing hold, rate, agreement, proration and invoice identity rules remain unchanged. The source guard still requires exact count equality and retains the existing read caps. Ambiguous coverage blocks invoice RPCs through the current app/Edge orchestration.

Independent reference amounts include372000 cents for May with a future June payer,51613 cents for a May16 Medicaid admission at100000/month,48387 cents through a May15 discharge,51724 cents for February15–29 in a leap year, and77419 cents for March8–31 across DST. References use independent UTC civil-day counting and BigInt half-up arithmetic. Each independent scenario ran in both payer orders against actual app/Edge source.

Verification:133 independent cases passed in UTC and133 in America/New_York; all166 existing/dedicated billing tests passed. Root's full unit suite passed3712/3712 with no skips, the focused finance suite passed272, and HFA-F06-TEMPORAL passed. Exact hashes, fixtures and review evidence are under test-results/finance-integration/f06-temporal.

The full handoff supersedes the old split-payer non-goal. Real split/patient/secondary responsibility, authorization-based rates, historical transfers/status, mutable payer history, recurring agreement-line precedence, complete consistent retrieval and durable scheduling remain required engineering. These guarded cases do not complete HFA-039/HFA-040 or F06 and do not establish hosted/provider/business acceptance.
