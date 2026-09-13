# F06 bounded monthly invoice source guards

This segment prevents monthly draft generation from treating incomplete reads or draft rates as authoritative. It does not complete F06, provide a consistent billing snapshot, approve historical charges, or activate scheduling/provider integrations.

## Resulting behavior

Both the app producer and its exact Edge shared copy request an exact count for residents, primary payers, Medicaid providers, active rate agreements, existing period invoices and active organization facilities. A successful read requires a non-null array and a nonnegative safe integer count equal to the returned array length. Missing/null counts, missing/null data, provider errors and count mismatches stop that preview. The existing 500-row limits on residents, agreements and invoices remain; an exceeded limit now blocks generation rather than silently producing a partial batch. Payer/provider/facility reads also detect configured REST limits through the same count comparison.

Rate selection remains the latest schedule applicable at the billing period start, but now allows only published or superseded schedules. Draft schedules are excluded. A historical superseded schedule remains usable when its effective/end dates include the selected period. The intentional single-rate selection remains a one-row query. A null rate response is an incomplete source, distinct from a valid empty result with no applicable schedule.

The Edge organization response now returns the actual `maxFacilities` value under `max_facilities`, eliminating the reachable undefined-variable exception after processing. An organization with blocked or partial facilities reports `ok: false`; incomplete organization facility discovery stops before any preview or invoice write. A facility preview blocked by incomplete sources produces no invoice RPC. Existing per-facility processing, duplicate protection, intentional organization processing cap and partial business-warning behavior remain.

Preview and persistence reject noninteger/invalid months and years before dates or invoice identifiers are generated. The technical accepted range is an integer month 1–12 and a four-digit integer year 1000–9999; this is not an approved historical billing window. The Edge request parser uses the same validation and rejects malformed/non-object or explicitly invalid period inputs instead of silently defaulting them.

## Partial and unknown outcomes

`created` and `skipped_duplicates` report only acknowledged RPC results. If a later invoice request fails, times out or returns no valid acknowledgement, `MonthlyInvoicePersistenceError` retains the earlier acknowledged counts and the same unresolved invoice number. No new invoice identity or automatic retry is introduced. The generic error message includes known counts, but no provider text or resident-derived invoice identity. The unresolved identity remains a typed property and an authorized structured response field. Ordinary Edge telemetry uses a fixed message/code and known counts; it does not log the raw exception, resident ID or unresolved invoice number.

The Edge handler reports `complete`, `partial` and `outcome_unknown` separately. `ok` is true only for a complete run. A failure after earlier acknowledgements preserves their counts; the unresolved mutation is excluded from known counts and flagged through `outcome_unknown` and `unresolved_invoice_number`. It may have committed, and the response does not claim rollback. Organization rows and totals preserve these distinctions, and the single-facility error response is structured rather than losing progress in an uncaught failure.

An intentional organization processing cap sets `truncated: true`, `partial: true` and `complete: false`, with the same processing limit as before. Existing business warnings can still allow known valid charges to persist, but now report partial rather than complete success. Durable reconciliation and scheduled retry orchestration remain future work.

## Executed evidence

The private baseline driver executed the actual app producer, exact Edge shared producer and actual `Deno.serve`-registered Edge handler after TypeScript transpilation. All 28 targeted regressions failed before repair, including draft-rate selection, incomplete/null reads, fractional month, organization `max_facilities` ReferenceError and persistence from an incomplete preview. The retained baseline artifacts are under the run-owned `billing-f06` directory.

The permanent tests execute both producers and their persistence functions against a query-semantic transport with filters, ordering, limits and count metadata. Independent expected charges cover a full private-pay hold 372000 cents, a prorated negotiated agreement 120000 cents with 24000-cent concession, and ten Medicaid days at 12000 cents/day. Published and historically applicable superseded rates produce those same charges. A 2501-resident fixture is actually truncated to the unchanged 500-row cap and rejected.

The actual Edge handler is executed with its real shared modules; only the external Supabase factory, environment/serve registration and HTTP transport are synthetic. Tests prove the organization return path and absence of invoice RPC calls for each incomplete source. This is source execution proof, not hosted Deno, cron, gateway, service-role provisioning or production billing acceptance.

## Remaining work

- Counts establish completeness of each returned query independently. The separate reads are not one database snapshot, and the preview can become stale before persistence.
- Sources larger than the unchanged read/REST caps fail closed. Complete snapshot retrieval, reviewed batching and stable pagination remain unimplemented.
- Scheduling, timezone/month-boundary policy, retry orchestration and durable scheduled-command identity remain open. The current next-month rule is preserved.
- Historical/retroactive resident eligibility, mid-month rate changes, overlapping agreements and approved proration/hold/concession policies still require mapped source history and business review.
- Existing Medicaid missing-rate business warnings and per-facility processing semantics remain. This repair distinguishes incomplete transport from a complete source result; it does not decide new billing policy.

Final scoped evidence: 119 author cases and 131 independent cases passed. The complete unit suite passed all 3,665 cases with no skips after explicitly enabling the existing benchmark fixtures; the earlier run with two skipped benchmarks is retained as incomplete evidence. The focused finance suite passed 225 cases and HFA-F06-SOURCE-GUARDS passed. A future-effective primary payer affecting an earlier month remains a concrete source defect for the next repair, not an external blocker or a policy waiver.
