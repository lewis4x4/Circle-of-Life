# InsureFlow receiver: local synthetic implementation

Build an isolated read-only summary receiver stacked on insurance PR 462. The source ZIP is verified evidence, not a deployment instruction. No live provider is configured or enabled. No new dependencies.

Boundary: complete valid envelope/manifest/event controls are distinct from snapshot validity. Invalid controls reject the full page. Valid controls reconcile membership and withdrawals, quarantine bad bodies, hide affected summaries, and commit cursor plus deduplicated recovery atomically. Preserve immutable first non-null body hashes and distinguish same-ID withdrawn/null redaction. Use decimal strings for PostgreSQL bigint cursors. Explicit account-to-entities mappings only. No linkage into policies, financials, claims, documents, AI, search, exports or offline storage.

Architecture: pure TypeScript validator/reducer in src/lib/insurance/insureflow; per-connection JSON state persisted through service-only fenced lease RPC, with scoped manager read RPC projecting eligible summaries only. No public raw state reads. Transport has fixed configured HTTPS origin, scoped token, no redirects, streaming byte bound and timeout; live execution hard-disabled in this segment. Synthetic fixtures drive local tests. UI has separate agency summaries route with status and provenance; no imported editing or money totals.

Recovery: separate replay cursor, bounded retries, fresh normal poll required before recovered body publication. Every accepted replay page replaces manifest. Read-time freshness and mapping gates; production TTL/readers/retention stay unresolved. SQL connection mode limited to synthetic and must have explicit TTL for reads.
