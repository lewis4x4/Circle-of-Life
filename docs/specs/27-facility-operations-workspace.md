# Facility Operations staff workspace — COL-148 / HFO-10

Source contract for `/admin/operations/work`, stacked on COL-146. This is one shared site workspace for administrators and assistants. It does not activate a policy, publish a schedule, apply migrations, or establish hosted/staff acceptance.

The detailed engineering contract is [col148-evidence/engineering-contracts.md](../facility-operations/col148-evidence/engineering-contracts.md). The owner’s limited dependency exception allows this source-only work against the reviewed COL-143 interface while its hosted Storage proof remains open.

## Read surface

`GET /api/admin/operations/workspace` requires a site UUID and the current operations actor. It uses the session client and existing task/subject RLS. The response includes the current person, facility timezone, generated time, and explicit partial-read markers.

- Today includes due work, all earlier unfinished work, unknown schedules, and a separate legacy group. Unassigned work is visible by default. Mine narrows recorder roles but retains unassigned and unreadable-rule rows.
- Upcoming covers unfinished work after today through fourteen days ahead. Recording is read-only; issue reporting remains available.
- History uses a fifty-row keyset page ordered by due time, nulls last, then ID descending. The count is the complete site count, including when Mine narrows the displayed page. An empty filtered page may still have a next cursor.

Every unrestricted read pages through the provider’s row cap. Dependent IDs are batched. History combines disjoint finished and reversed occurrence queries, preserving microseconds and summing exact disjoint counts. A failed page is not presented as a complete list. Receipt-chain, evidence, and issue detail reads also paginate.

The evidence summary is `{ required_rules, satisfied }`: a prospective rule count and aggregate satisfaction, never a file count. For evidence-requiring receipts the count is null because corrections can carry already satisfied evidence that the unmet-rule snapshot omits. Missing pinned requirements or receipts are unavailable, not silently replaced by current defaults. The receipt-chain response also carries the current occurrence’s safe execution fields so interrupted commands can be reconciled without reloading the workspace.

## Recording and history

The client uses the existing record, correct, reverse, issue, draft-recovery, and verified-evidence commands. The database supplies recorder identity, time, receipt, occurrence state, and acceptance. A routine performed task requiring no additional inputs or evidence has one Complete action. Rule-specific fields, evidence, and exceptional entry options appear inline only when needed.

Receipt chains retain recordings, corrections, reversals, reviews, attachments, and issues. Corrections and reversals name the exact receipt and revision and require a reason. A lost answer resumes the saved request key; client-edited arguments never replace a pending draft. A finalized attachment updates the row using the server’s result and a targeted current receipt/occurrence read, including replay replies with no satisfaction object.

All work payloads remain in memory or the actor-scoped server draft. Actor/site changes discard the visible surface and ignore stale responses. Current person is shown in the header and recording surfaces; the existing account-menu Sign out remains the shared-device switch path.

## Interaction contract

View, site, Mine, and history cursor are held in URL parameters. Saving updates a stable row without reloading the list. Disclosures stay open, scroll position stays put, and complete/cancel/retry return focus to a persistent row control. Controls are keyboard reachable and have at least 44-pixel touch targets. Lists are semantic, with one-column mobile layout and polite save announcements.

The page uses existing PageShell/Panel/Note primitives. PageShell owns TopBar and AuditFooter. Native labeled site and view controls intentionally replace FilterBar’s multiple-facility and arbitrary-date controls, which do not describe this fixed-window, single-site contract.

## Verification and boundaries

Final verification, independent findings and dispositions, strict UI gate, authenticated-axe availability, and rollback are recorded in [COL-148-HANDOFF.md](../facility-operations/COL-148-HANDOFF.md) and its linked evidence files. In-test axe is structural coverage; it does not replace authenticated browser or staff/device acceptance.

No new migration, dependency, source adapter, corporate aggregate, export, reminder, offline draft, or policy activation belongs to this segment. COL-143 hosted proof and COL-140 Homewood policy approval stay separate. COL-147 source adapters are the next module, handed off to Fable 5.1 rather than started here.
