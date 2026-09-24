# Shared payroll packet — COL-357

Workforce → Payroll prepares one packet for a facility and completed pay period. It is the same handoff for a phone call or manual entry in RUN. No ADP upload, API submission or payroll payment is performed by this feature. The reference is `Payroll Outline.xlsx`, Outline!A1:J45.

## Operator flow

1. An owner or organization administrator opens **Payroll rules**, fills the employer, calendar, workweek/time zone, overtime group, meal/rounding treatment, salary presentation and approval authority, then explicitly confirms with the payroll owner. Incomplete settings can be saved; they cannot authorize a packet. COL-428 remains the operational decision record.
2. **Prepare payroll packet** with inclusive period dates and a check date. Choose each employee's pay basis, department and identifier, review hours and supplemental amounts, and provide reasons for manual allocations. On-call and bonus are dollars. Training is worked time reclassified from regular hours; holiday/personal are additional paid leave. Reviewed allocation supports payroll-owner determinations outside that automatic model.
3. Resolve blocking timecard, identity, policy and source issues. Save and review every row. Correct the check date while still a draft. Missing kiosk hours display Unknown; they are not fabricated from paid hours. Salary amount/unchanged rows are excluded from hour totals.
4. The configured approver confirms and **Approve packet** freezes the exact PDF, printable HTML and CSV, policy, source references, approver and timestamp. Downloading has no reporting effect.
5. Call in or enter the approved packet in RUN. **Record phone call / RUN entry** captures the method, operator and confirmation/reference.
6. Compare ADP's preview/confirmation against the packet. Record a difference if it does not match; only explicit matching reconciliation completes the packet. Corrections after approval create linked versions with renewed row review. Original files remain retrievable and unchanged.

Legacy batches and their detail pages remain under **Legacy batches**. They are not silently converted into new packets. The supporting worked-hours view does not certify staffing compliance or adopt the workbook's census matrix as policy.

## Integrity and access

The server authenticates each request and rechecks current profile/facility authority for mutations and file delivery. Service-only SQL RPCs independently check the actor; direct writes to packet tables are revoked. Policy edits and packet events retain the actor's name and ID. Raw group timeclock data stays on the server. Cross-building automatic overtime uses the configured employer workweek and consistent settings across its facilities, allocates work chronologically, then clips the target facility/period.

Source revision locks and policy revisions protect approval against concurrent changes. Saving manual edits clears employee review marks if the saved hours or rules changed in the meantime; unchanged business data keeps its marks. Unrelated source changes can refresh revision metadata only when the complete business snapshot is unchanged. Source pagination is complete and revision checked. Approved PDF bytes are SHA-256 checked before delivery; HTML/CSV are stored once with the same approval. CSV formula prefixes and HTML text are escaped. Print documents disclose the PDF's ASCII fallback; HTML/CSV retain exact Unicode text.

No financial rules are preconfirmed during installation. Shipping this capability does not close COL-428, COL-429, staff acceptance, ADP acceptance or uPunch retirement.

## Verification and release

- `npx vitest run src/lib/payroll-packets src/components/payroll-packets src/components/workforce/WorkforceContext.test.tsx src/lib/workforce/load.test.ts`: 72 focused checks.
- `scripts/payroll-packets/verify-local.ts`: native PostgreSQL clone; actual paginated RPC source, calculation, real document approval, stale-source rejection, Phone/difference/reconciliation, RUN amendment and identical original bytes. Synthetic data only; clone removed.
- `scripts/payroll-packets/preview.mts` + `browser-proof.mjs`: actual components, calculator and renderer with explicitly synthetic persistence. Desktop/mobile, both methods, amendments, errors and accessibility. Not hosted auth or provider acceptance.
- `supabase/tests/review_payroll_packets.sql`: rollback-only SQL role, facility, freshness, immutability, audit and lifecycle probe. For hosted staging omit the two local auth bootstrap statements; never redefine hosted auth helpers.
- Required repository segment, bundle and current-base CI gates; exact migration before app release; mandatory post-merge CI because this change includes financial logic and SQL.

Evidence in `payroll-packets-evidence/` is synthetic and dated. Hosted release receipt will be linked from COL-357. No real employee packet is created or approved as a smoke test.

## Recovery

Migration 505 creates the new tables/functions and source-change triggers without changing legacy exports. Deploy the prior application revision if rollback is required. `payroll-packets-rollback.sql` disables packet writers while preserving policy, immutable documents and audit history. Do not drop financial evidence tables or replace approved files. Re-enabling writers requires a reviewed forward grant to the exact service RPCs.
