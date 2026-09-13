# COL-152 / HFO-15 — approved in-app reminders

Source implementation on `codex/hfo-col152-reminders`, based on the unmerged HFO stack at `94b1f90a`. Mission alignment: **pass** — clearer current work and accountable responses without fabricated due dates, recipients, completed work or provider delivery. This is local/source evidence, not deployment, staff, Homewood operating-cycle or external-channel acceptance.

## Ownership and source

COL-32 remains the calendar/rule ownership issue. Its existing operating catalog, the COL-137 evaluator, the COL-139 occurrence snapshot, COL-144 issue follow-up and the COL-148 work row remain the authoritative sources. No parallel task engine, recurrence evaluator, scheduler, external channel, policy activation or live configuration is introduced.

A task reminder consumes the managed occurrence's persisted due/grace instant and its explicit reminder instant. Both a deadline and a reminder window are required, including for overdue work. A manual occurrence does not acquire a schedule from its compatibility queue date. A problem reminder consumes that specific issue's explicit follow-up time; another problem on the same task has its own episode, recipient, response state and identity. Missing windows or recipients remain visible as configuration needed. No lead time, escalation delay, recipient, default snooze duration or operating urgency is supplied.

## Persistence and transactions

Migration `350_hfo_in_app_reminders.sql` extends `operation_escalation_deliveries` with reminder state, phase, configuration problem, revision, generation, source identity/revision, acknowledgement and snooze metadata. A partial unique task index preserves one task reminder and a separate partial issue index preserves one reminder per issue. No row is removed on resolution. Repeated refreshes of unchanged source state make no new row, revision or audit transition. Work-row presentation itself supplies a compact grouping; no duplicate toast, digest sender or repeat notification is created.

`operation_reminder_responses` is the immutable, RLS-enabled command receipt ledger. Every response request key retains its actor and exact request fingerprint; a retry after a later response does not reapply the earlier action, and a successful snooze retry after its time passes remains a replay. Changed content under the same key is rejected. Generic audit visibility excludes the response and delivery tables, preserving protected subject boundaries. Administrative database history remains retained by the existing audit trigger.

The session-only public invoker RPC delegates to a private definer command. It serializes reminder commands for one task before taking an issue lock, matching the existing issue-to-task ordering. COL-142 work authority locks the current subject, site, actor, grant and session. Explicit ownership, person grants, protected domain grants and the ledger are locked before selecting a current recipient. Authority and clock-dependent recipient checks are repeated after waits and after the audited write. The delivery guard uses the existing owner-secret transaction token in a reminder-specific setting; direct authenticated or service ledger writes cannot invent delivery for a managed occurrence.

## State and response semantics

| Condition | Episode result |
| --- | --- |
| Missing approved task deadline or reminder instant | Configuration needed |
| Issue lacks explicit follow-up time | Configuration needed |
| Named primary lacks current work-response authority and no eligible named backup exists | Configuration needed |
| Approved window has not started | Upcoming |
| Task reminder instant reached | Active / due |
| Task deadline including grace reached, with approved reminder window present | Active / overdue |
| Issue follow-up instant reached | Active / follow-up |
| Task completed/cancelled | Task episode resolved only |
| Issue resolved | That issue episode resolved only |
| Source reopens | Same episode identity; generation increments; suppression clears |
| Source revision, phase, state or recipient changes | Suppression clears; current source replaces the projection |

An explicit task assignee takes precedence over its governing facility requirement's named owner; a named backup on that requirement is fallback. Issue episodes use only their own named owner/backup. Role-only routing never selects an arbitrary staff member. Eligibility mirrors the command's current work authority: site, operations role, protected domain recording grants, resident recorder role, employee personnel self/manager rules, employee medical access and financial owner/admin rules. A primary who cannot respond cannot block an eligible explicit backup.

Only the current named eligible recipient can acknowledge or snooze an active reminder, using the revision they read. Acknowledge and snooze suppress this episode and never update a receipt, work status, issue status or source record. A future snooze time is selected explicitly. `delivery_status=sent` is written only after that authenticated in-app response; merely creating or refreshing an episode stays `queued`. This means confirmed in-app interaction, not email, SMS, voice, provider receipt or completed work. Those external channels have no activated path here.

## Staff presentation and API

`POST /api/admin/operations/occurrences/[id]/reminder` accepts `refresh`, `acknowledge` or `snooze`; optional `issue_id` selects an independent issue episode. Responses require a UUID revision and durable request key, and snooze requires an explicit timestamp. Strict schemas reject recipient/channel/completion injection. The route revalidates session authority before the RPC and after it before returning the validated safe projection.

The existing work row automatically loads reminders when expanded or showing history. It uses the existing current issue endpoint for issue identities, never displays its unconfirmed summaries, and obtains every visible label from the authorized reminder RPC. The initial group includes the task and at most five open issue episodes; a count and Show more action exposes further issues without losing them. Resolved historical issues are excluded from the initial active group, while a mounted issue can refresh to its resolved state. Each rendered episode has unique input IDs. Actor/occurrence keys and stale-response guards protect shared devices. A network-uncertain response retains its exact request for an explicit retry even after refresh. Snooze begins empty and rejects nonexistent DST wall times by a facility-time round trip.

## Verification and remaining boundaries

See the parent closeout's final gate/review records for the exact source revision and strict gate artifact. Targeted tests cover request schemas, safe delivery claims, automatic presentation, empty time, uncertain retry, DST gap, bounded issue presentation and actor changes. The native SQL probe executes real session commands against synthetic rollback fixtures for episode identity, due/overdue/configuration, independent issues, acknowledgement and snooze without completion, durable replay, resolution/reopen, current recipient/backup selection and authenticated/service denials. Concurrency proof is recorded separately.

Migration 350 is provisional until reconciled with current main. No hosted migration, provider call, email/SMS/voice, rule confirmation, facility activation, named live assignment or acceptance occurred. COL-143 hosted Storage proof remains separate; Q05/Q29 remain unresolved configuration. The final source commit and draft PR are recorded in Linear closeout; merge, deployment and hosted acceptance remain separate.
