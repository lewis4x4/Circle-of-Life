# Section 4 execution contract

Section 3 source implementation and independent review are complete at `009333d2`; deployment and clinical acceptance remain separate. Continue on `codex/haven-remaining-roadmap` in the isolated remaining-roadmap worktree. Execute bounded segments, independent source review, required gates, atomic commits and push. Parent centrally allocates migration numbers; BUS-001 is assigned 338.

## Bounded sequence

1. BUS-001: one idempotent payment-and-invoice-application transaction; do not manufacture credit/overpayment policy. Preserve current actor, tenant, facility, resident and entity boundaries. Existing application command silently returns on missing invoices and clamps amounts; client currently ignores returned errors.
2. BUS-002: create purchase order header and initial lines together with the existing number allocator and stable request identity. Do not leave orphan headers or allocate a new request after ambiguous failure.
3. BUS-003: source GL posting must atomically produce validated lines and posted status. Existing drafts are not evidence of posting. Preserve period/account/entity validation and historical drafts; characterize safe recovery instead of deleting financial history.
4. BUS-006: editable payroll import and export must respect current source approval/version. Preserve historical exported snapshots and block stale current exports. Inspect batch lifecycle before choosing refresh behavior.
5. SYS-006 plus retained SYS-005 gap: durable send ownership and uncertain outcomes, atomic webhook receipt/state changes, and current facility authority immediately before embedded-link disclosure.

## Official BoldSign contract research

Read-only research completed by an independent native subagent; no provider sends, webhook deliveries or messages were performed.

- [Template send](https://developers.boldsign.com/documents/send-document-from-template/) documents API-key authentication and optional labels. No provider-native idempotency key or complete lost-response recovery contract was located. Never automatically repeat an ambiguous send.
- [Document listing](https://developers.boldsign.com/documents/list-documents/) permits label filtering. An opaque attempt label may support reconciliation, but an empty result is not proof that no document was sent; immediate consistency and uniqueness are not guaranteed by the inspected contract.
- [Document readiness](https://support.boldsign.com/kb/article/14469/know-whether-document-or-template-is-ready) distinguishes initial ID response from completed asynchronous creation. Sent/SendFailed outcomes need durable processing.
- [Embedded signing](https://developers.boldsign.com/embedded-signing/get-embedded-signing-link/) selects an actual signer by email/phone and supports explicit `signLinkValidTill`. Default/maximum lifetime was not established. Verify signer and current facility authority immediately before returning the link.
- [Webhook metadata](https://developers.boldsign.com/webhooks/event-metadata/) places the unique identifier and event type at `event.id` and `event.eventType`; current code misses these nested fields. `event.created` is Unix time.
- [Webhook lifecycle](https://developers.boldsign.com/webhooks/webhook-configuration-and-lifecycle/) requires a prompt 200 response and documents retries/duplicates. No ordering guarantee was found. Deduplication and local state transition must commit together.
- [Signature verification](https://developers.boldsign.com/webhooks/verify-webhook-events/) documents HMAC-SHA256 over timestamp, dot and raw body, with `t`, `s0` and optional rotation signature `s1` in the signature header. Preserve constant-time validation and timestamp tolerance. Do not relax the existing 300-second check based on assumptions about retry timestamps.

## Verification

Each segment needs rendered failure/retry coverage and actual SQL rollback, concurrent/repeated requests and permission probes. No production financial or signing side effects are part of local verification. Keep source proof, hosted deployment, provider outcomes and named-user acceptance distinct. Final integration review must resolve actionable findings without inventing missing clinical/staffing/vendor policy.
