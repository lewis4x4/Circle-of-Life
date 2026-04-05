# 04 — Daily Operations Offline & eMAR Sync (Phase 3.5)

**Segment:** `pwa-offline-emar`  
**Migrations:** `054_*` (idempotency + related)  
**Parent:** [`04-daily-operations.md`](04-daily-operations.md)

---

## Purpose

Define **service worker cache partitions**, **Background Sync**, and **IndexedDB queue** contracts so caregivers can complete eMAR-adjacent workflows on unreliable networks without double-posting or silent data loss.

---

## Scope

### Migration `054_*` (additive)

- **`emar_records.emar_idempotency_key uuid UNIQUE`** — client-generated per attempted administration; server rejects duplicates.
- Optional: expand per README Phase 3.5-C (`device_id`, `app_version` may ship in `057` — keep compatible).

### Service worker

- Cache partitions per **shell** (caregiver vs admin): document asset groups in [`pwa-caching-contract.md`](pwa-caching-contract.md).

### IndexedDB queue schema (app layer)

- Queue items: `{ id, operation, payload_ref, idempotency_key, created_at, retry_count }`.
- **No offline write** without idempotency key (see caching contract).

### Background Sync

- Register sync tag per facility or per session; flush queue when online; surface conflicts in UI.

---

## Acceptance

1. Duplicate `emar_idempotency_key` returns deterministic 409/conflict — no duplicate clinical rows.
2. Contract documented for mobile QA.
3. Segment gates with `--ui` when SW/routes change.

---

## Non-goals

- Full offline charting — focus on **eMAR / ADL** paths scoped to this segment.
