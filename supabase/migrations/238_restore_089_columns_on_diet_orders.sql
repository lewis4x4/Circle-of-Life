-- ============================================================
-- Migration 238: Restore 089-era columns on diet_orders
-- ============================================================
--
-- Why this exists
-- ---------------
-- Migration 237 dropped and rebuilt `public.diet_orders` to match 174's
-- intended schema (diet_type, active, allergies/dislikes/preferences,
-- iddsi_liquid_level, ordered_by). That broke admin pages and library
-- code that still reference 089-era columns:
--
--   src/app/(admin)/admin/dietary/page.tsx         — filters .is("deleted_at", null)
--   src/app/(admin)/admin/dietary/new/page.tsx     — same + writes 089 columns
--   src/app/(admin)/admin/dietary/clinical-review/page.tsx
--   src/lib/dietary/dashboard-brief.ts             — count queries on deleted_at
--
-- The codebase has mixed references — the hook layer expects 174 shape,
-- the admin layer expects 089 shape. Rather than rewrite half the frontend
-- in this drift-fix pass, this migration restores the dropped 089 columns
-- additively so both code paths work.
--
-- Both column sets coexist:
--   - 089 currency semantics:  `deleted_at IS NULL`
--   - 174 currency semantics:  `active = true`
-- For any row that is current under both definitions (the common case),
-- both predicates resolve to true. Schema is loose but every consumer
-- works without code changes.
--
-- 089 enum types (`diet_order_status`, `iddsi_fluid_level`) survived the
-- 237 CASCADE drop because they are independent objects — verified.
--
-- This migration is idempotent (uses ADD COLUMN IF NOT EXISTS).

BEGIN;

ALTER TABLE public.diet_orders
  ADD COLUMN IF NOT EXISTS status diet_order_status NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS allergy_constraints text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS texture_constraints text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS iddsi_fluid_level iddsi_fluid_level NOT NULL DEFAULT 'not_assessed',
  ADD COLUMN IF NOT EXISTS aspiration_notes text,
  ADD COLUMN IF NOT EXISTS medication_texture_review_notes text,
  ADD COLUMN IF NOT EXISTS requires_swallow_eval boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);

-- Soft-delete-aware indexes (089 pattern). The 174 active-true indexes
-- created by 237 stay in place; these complement them.
CREATE INDEX IF NOT EXISTS idx_diet_orders_facility_not_deleted
  ON public.diet_orders(facility_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_diet_orders_resident_not_deleted
  ON public.diet_orders(resident_id) WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.diet_orders.deleted_at IS
  'Restored by 238 — 089-era soft delete marker. Coexists with 174s `active` boolean. Either predicate may be used to identify current rows.';

COMMENT ON COLUMN public.diet_orders.status IS
  'Restored by 238 — 089-era status enum (draft/active/superseded/discontinued). Coexists with 174s `active` boolean.';

COMMIT;
