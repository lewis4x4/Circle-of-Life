-- Phase 3.5-B: pwa-offline-emar — idempotency for admin routes

ALTER TABLE emar_records
  ADD COLUMN emar_idempotency_key uuid;

CREATE UNIQUE INDEX idx_emar_idempotency_unique ON emar_records (emar_idempotency_key)
WHERE
  emar_idempotency_key IS NOT NULL
  AND deleted_at IS NULL;

COMMENT ON COLUMN emar_records.emar_idempotency_key IS 'Client-generated key; duplicate insert must no-op or conflict.';
