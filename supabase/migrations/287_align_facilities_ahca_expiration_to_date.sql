-- ══════════════════════════════════════════════════════════
-- 260 — Align facilities.ahca_license_expiration to `date`
-- ══════════════════════════════════════════════════════════
--
-- Migration 159 was edited in place to declare ahca_license_expiration as
-- `date` (ADD COLUMN IF NOT EXISTS ... date). On a fresh replay 159 is the
-- column's creator, so it is already `date`. On a database where the column was
-- created earlier as `timestamptz` (the historical 101 enhancement), 159's
-- IF NOT EXISTS is a no-op and the column stays `timestamptz` — a cross-
-- environment type skew.
--
-- The app contract is `date`: src/lib/admin/facilities/license-record-metrics.ts
-- requires a bare YYYY-MM-DD string. PostgREST serializes a `date` as
-- "2026-04-14" (matches) but a `timestamptz` as "2026-04-14T00:00:00+00:00"
-- (fails the anchored regex → license standing/expiry UI silently blanks).
--
-- This forward migration converges any lingering `timestamptz` column to `date`.
-- Guarded so it is a no-op where the column is already `date` (fresh replay).
-- The time component is always midnight, so the cast is lossless in practice.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'facilities'
      AND column_name = 'ahca_license_expiration'
      AND data_type <> 'date'
  ) THEN
    ALTER TABLE public.facilities
      ALTER COLUMN ahca_license_expiration TYPE date
      USING ahca_license_expiration::date;
  END IF;
END $$;
