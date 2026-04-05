# PWA Caching Contract (Phase 3.5)

**Segment:** `pwa-sw-caching-contract`  
**Related migrations:** `054`–`055` (offline + push)  
**See also:** [`04-daily-operations-offline.md`](04-daily-operations-offline.md)

---

## Purpose

Standardize **stale-while-revalidate** behavior, **max ages**, and **offline write rules** across shells so performance and correctness stay predictable under PgBouncer and flaky networks.

---

## Stale-while-revalidate (illustrative — tune per env)

| Resource type | Shell | Max stale | Notes |
|---------------|-------|-----------|--------|
| App shell / JS chunks | All | 7d versioned | Cache-bust via build id |
| API GET (read-only lists) | Admin | 0–60s | Must not cache PHI aggressively on shared devices |
| Static assets | All | 30d | Non-PII icons, fonts |
| eMAR queue (IndexedDB) | Caregiver | N/A | Source of truth until sync |

**Rule:** **No offline writes** without an **idempotency key** (see `04-daily-operations-offline.md`).

---

## Supabase connection pooling

- Document **PgBouncer transaction mode** requirement for serverless/Edge clients.
- **`.env.local`:** use **pooler URL** for high-concurrency routes; document variable name in deployment guide (values not in repo).

---

## Push notifications

- VAPID keys in Supabase secrets; **`notification_subscriptions`** table — see README Phase 3.5-B.

---

## Acceptance

1. This document referenced from segment gates / `DESIGN_REVIEW_ROUTES` when PWA behavior changes.
2. Engineering sign-off that caregiver flows never double-submit without idempotency.
