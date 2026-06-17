-- Module 16: resident negotiated billing terms + concession tracking
-- Forward-only segment for Homewood/COL billing clarity.
-- Standard posted rates remain the baseline; resident_rate_agreements stores resident-specific negotiated terms.

-- ============================================================
-- ENUMS
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rate_agreement_status') THEN
    CREATE TYPE rate_agreement_status AS ENUM ('draft', 'pending_approval', 'active', 'superseded', 'ended');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rate_room_class') THEN
    CREATE TYPE rate_room_class AS ENUM ('private', 'companion', 'other');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'care_charge_mode') THEN
    CREATE TYPE care_charge_mode AS ENUM ('standard', 'flat', 'bundled', 'waived');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'concession_reason') THEN
    CREATE TYPE concession_reason AS ENUM (
      'none',
      'move_in_incentive',
      'financial_hardship',
      'length_of_stay_loyalty',
      'legacy_rate_lock',
      'medicaid_pending_bridge',
      'referral_partner',
      'care_level_offset',
      'goodwill_service_recovery',
      'other'
    );
  END IF;
END $$;

-- ============================================================
-- RESIDENT RATE AGREEMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS resident_rate_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents (id),
  facility_id uuid NOT NULL REFERENCES facilities (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),

  status rate_agreement_status NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  effective_date date NOT NULL,
  end_date date,
  supersedes_id uuid REFERENCES resident_rate_agreements (id),

  rate_schedule_id uuid REFERENCES rate_schedules (id),
  room_class rate_room_class NOT NULL DEFAULT 'private',
  standard_base_rate_at_signing integer NOT NULL CHECK (standard_base_rate_at_signing >= 0),
  standard_care_surcharge_at_signing integer NOT NULL DEFAULT 0 CHECK (standard_care_surcharge_at_signing >= 0),
  standard_monthly_total_at_signing integer NOT NULL CHECK (standard_monthly_total_at_signing >= 0),

  negotiated_base_rate integer NOT NULL CHECK (negotiated_base_rate >= 0),
  care_charge_mode care_charge_mode NOT NULL DEFAULT 'standard',
  negotiated_care_surcharge integer CHECK (negotiated_care_surcharge IS NULL OR negotiated_care_surcharge >= 0),
  negotiated_monthly_total integer NOT NULL CHECK (negotiated_monthly_total >= 0),

  concession_amount_at_signing integer NOT NULL DEFAULT 0,
  concession_pct_at_signing numeric(7, 2) NOT NULL DEFAULT 0,
  concession_reason concession_reason NOT NULL DEFAULT 'none',
  concession_notes text,
  concession_expires_on date,

  approved_by uuid REFERENCES auth.users (id),
  approved_at timestamptz,
  agreement_document_url text,
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  deleted_at timestamptz,

  CONSTRAINT rra_flat_requires_amount CHECK (care_charge_mode <> 'flat' OR negotiated_care_surcharge IS NOT NULL),
  CONSTRAINT rra_effective_before_end CHECK (end_date IS NULL OR end_date >= effective_date),
  CONSTRAINT rra_active_requires_approval CHECK (status <> 'active' OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)),
  CONSTRAINT rra_concession_reason_required CHECK (concession_amount_at_signing <= 0 OR concession_reason <> 'none')
);

CREATE INDEX IF NOT EXISTS idx_rra_resident ON resident_rate_agreements (resident_id, effective_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_rra_facility ON resident_rate_agreements (facility_id, effective_date DESC)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_rra_one_current_active_per_resident
  ON resident_rate_agreements (resident_id)
  WHERE status = 'active' AND end_date IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_rra_facility_concessions ON resident_rate_agreements (facility_id, effective_date DESC)
  WHERE deleted_at IS NULL AND status = 'active' AND concession_amount_at_signing <> 0;

CREATE INDEX IF NOT EXISTS idx_rra_expiring_concessions ON resident_rate_agreements (concession_expires_on)
  WHERE deleted_at IS NULL AND concession_expires_on IS NOT NULL;

COMMENT ON TABLE resident_rate_agreements IS 'Versioned resident-specific negotiated billing terms. Posted rate schedules remain the baseline; this table stores actual negotiated monthly rent and concession metadata.';
COMMENT ON COLUMN resident_rate_agreements.concession_amount_at_signing IS 'standard_monthly_total_at_signing - negotiated_monthly_total. Positive means discount/concession; negative means premium above posted rate.';
COMMENT ON COLUMN resident_rate_agreements.room_class IS 'COL billing class: private, companion/shared, or other. companion maps to rate_schedules.base_rate_semi_private.';

-- Optional itemization for future recurring fee detail. Header totals are sufficient for current Homewood slice.
CREATE TABLE IF NOT EXISTS resident_rate_agreement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES resident_rate_agreements (id),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  line_type text NOT NULL,
  description text NOT NULL,
  standard_unit_price integer NOT NULL DEFAULT 0 CHECK (standard_unit_price >= 0),
  negotiated_unit_price integer NOT NULL CHECK (negotiated_unit_price >= 0),
  quantity numeric(8, 2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  is_recurring boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rra_lines_agreement ON resident_rate_agreement_lines (agreement_id);
COMMENT ON TABLE resident_rate_agreement_lines IS 'Optional recurring line detail for resident_rate_agreements; invoice generation falls back to header totals when no lines exist.';

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE resident_rate_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE resident_rate_agreement_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admins_see_resident_rate_agreements ON resident_rate_agreements;
CREATE POLICY admins_see_resident_rate_agreements ON resident_rate_agreements
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

DROP POLICY IF EXISTS admins_insert_resident_rate_agreements ON resident_rate_agreements;
CREATE POLICY admins_insert_resident_rate_agreements ON resident_rate_agreements
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

DROP POLICY IF EXISTS admins_update_resident_rate_agreements ON resident_rate_agreements;
CREATE POLICY admins_update_resident_rate_agreements ON resident_rate_agreements
  FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

-- No DELETE policy by design: billing agreements are financial records and must be soft-deleted
-- by setting deleted_at through the UPDATE policy.
DROP POLICY IF EXISTS admins_soft_delete_resident_rate_agreements ON resident_rate_agreements;

DROP POLICY IF EXISTS admins_see_resident_rate_agreement_lines ON resident_rate_agreement_lines;
CREATE POLICY admins_see_resident_rate_agreement_lines ON resident_rate_agreement_lines
  FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND EXISTS (
      SELECT 1
      FROM resident_rate_agreements rra
      WHERE rra.id = resident_rate_agreement_lines.agreement_id
        AND rra.organization_id = haven.organization_id()
        AND rra.facility_id IN (SELECT haven.accessible_facility_ids())
        AND rra.deleted_at IS NULL
    )
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

DROP POLICY IF EXISTS admins_manage_resident_rate_agreement_lines ON resident_rate_agreement_lines;
DROP POLICY IF EXISTS admins_insert_resident_rate_agreement_lines ON resident_rate_agreement_lines;
CREATE POLICY admins_insert_resident_rate_agreement_lines ON resident_rate_agreement_lines
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND EXISTS (
      SELECT 1
      FROM resident_rate_agreements rra
      WHERE rra.id = resident_rate_agreement_lines.agreement_id
        AND rra.organization_id = haven.organization_id()
        AND rra.facility_id IN (SELECT haven.accessible_facility_ids())
        AND rra.deleted_at IS NULL
    )
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

DROP POLICY IF EXISTS admins_update_resident_rate_agreement_lines ON resident_rate_agreement_lines;
CREATE POLICY admins_update_resident_rate_agreement_lines ON resident_rate_agreement_lines
  FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND EXISTS (
      SELECT 1
      FROM resident_rate_agreements rra
      WHERE rra.id = resident_rate_agreement_lines.agreement_id
        AND rra.organization_id = haven.organization_id()
        AND rra.facility_id IN (SELECT haven.accessible_facility_ids())
        AND rra.deleted_at IS NULL
    )
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND EXISTS (
      SELECT 1
      FROM resident_rate_agreements rra
      WHERE rra.id = resident_rate_agreement_lines.agreement_id
        AND rra.organization_id = haven.organization_id()
        AND rra.facility_id IN (SELECT haven.accessible_facility_ids())
        AND rra.deleted_at IS NULL
    )
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

-- Direct financial writes are intentionally disabled. Agreement creation/replacement must
-- go through public.haven_replace_active_resident_rate_agreement(), which recomputes posted
-- standard/concession math and preserves effective-dated audit history.
DROP POLICY IF EXISTS admins_insert_resident_rate_agreements ON resident_rate_agreements;
DROP POLICY IF EXISTS admins_update_resident_rate_agreements ON resident_rate_agreements;
DROP POLICY IF EXISTS admins_insert_resident_rate_agreement_lines ON resident_rate_agreement_lines;
DROP POLICY IF EXISTS admins_update_resident_rate_agreement_lines ON resident_rate_agreement_lines;

-- No DELETE policy for line detail either. Financial detail rows must be corrected with
-- audited updates or superseded through a new resident_rate_agreement.

-- ============================================================
-- AUDIT + CACHE SYNC
-- ============================================================
DROP TRIGGER IF EXISTS tr_rra_set_updated_at ON resident_rate_agreements;
CREATE TRIGGER tr_rra_set_updated_at
  BEFORE UPDATE ON resident_rate_agreements
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

DROP TRIGGER IF EXISTS tr_rra_audit ON resident_rate_agreements;
CREATE TRIGGER tr_rra_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_rate_agreements
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

DROP TRIGGER IF EXISTS tr_rra_lines_audit ON resident_rate_agreement_lines;
CREATE TRIGGER tr_rra_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON resident_rate_agreement_lines
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_capture_audit_log();

CREATE OR REPLACE FUNCTION public.haven_sync_resident_rate_cache(p_resident_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current resident_rate_agreements%ROWTYPE;
BEGIN
  SELECT *
  INTO v_current
  FROM resident_rate_agreements
  WHERE resident_id = p_resident_id
    AND deleted_at IS NULL
    AND status = 'active'
    AND effective_date <= CURRENT_DATE
    AND (end_date IS NULL OR end_date >= CURRENT_DATE)
  ORDER BY effective_date DESC, created_at DESC
  LIMIT 1;

  IF FOUND THEN
    UPDATE residents
    SET
      monthly_base_rate = v_current.negotiated_base_rate,
      monthly_care_surcharge = CASE
        WHEN v_current.care_charge_mode = 'flat' THEN COALESCE(v_current.negotiated_care_surcharge, 0)
        WHEN v_current.care_charge_mode = 'standard' THEN v_current.standard_care_surcharge_at_signing
        ELSE 0
      END,
      monthly_total_rate = v_current.negotiated_monthly_total,
      rate_effective_date = v_current.effective_date,
      updated_at = now()
    WHERE id = p_resident_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.haven_sync_resident_rate_cache_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.haven_sync_resident_rate_cache(NEW.resident_id);
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.haven_sync_resident_rate_cache(OLD.resident_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_rra_sync_resident_cache ON resident_rate_agreements;
CREATE TRIGGER tr_rra_sync_resident_cache
  AFTER INSERT OR UPDATE OR DELETE ON resident_rate_agreements
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_sync_resident_rate_cache_trigger();

CREATE OR REPLACE FUNCTION public.haven_validate_resident_rate_agreement_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_resident record;
  v_schedule record;
  v_supersedes_resident uuid;
BEGIN
  SELECT id, organization_id, facility_id
  INTO v_resident
  FROM residents
  WHERE id = NEW.resident_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'resident_rate_agreements must reference an active resident.';
  END IF;

  IF v_resident.organization_id IS DISTINCT FROM NEW.organization_id
    OR v_resident.facility_id IS DISTINCT FROM NEW.facility_id THEN
    RAISE EXCEPTION 'resident_rate_agreements organization_id/facility_id must match the resident.';
  END IF;

  IF NEW.rate_schedule_id IS NOT NULL THEN
    SELECT id, organization_id, facility_id
    INTO v_schedule
    FROM rate_schedules
    WHERE id = NEW.rate_schedule_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'resident_rate_agreements must reference an active rate schedule.';
    END IF;

    IF v_schedule.organization_id IS DISTINCT FROM NEW.organization_id
      OR v_schedule.facility_id IS DISTINCT FROM NEW.facility_id THEN
      RAISE EXCEPTION 'resident_rate_agreements rate_schedule_id must match the resident facility.';
    END IF;
  END IF;

  IF NEW.supersedes_id IS NOT NULL THEN
    SELECT resident_id
    INTO v_supersedes_resident
    FROM resident_rate_agreements
    WHERE id = NEW.supersedes_id;

    IF v_supersedes_resident IS DISTINCT FROM NEW.resident_id THEN
      RAISE EXCEPTION 'resident_rate_agreements may only supersede an agreement for the same resident.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_rra_validate_integrity ON resident_rate_agreements;
CREATE TRIGGER tr_rra_validate_integrity
  BEFORE INSERT OR UPDATE ON resident_rate_agreements
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_validate_resident_rate_agreement_integrity();

-- ============================================================
-- POSTED RATE VERSIONING GUARD
-- ============================================================
ALTER TABLE rate_schedules
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published'
  CHECK (status IN ('draft', 'published', 'superseded'));

CREATE OR REPLACE FUNCTION public.haven_rate_schedule_published_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_allowed_keys text[];
BEGIN
  IF OLD.status IN ('published', 'superseded') THEN
    IF OLD.status = 'published' AND NEW.status NOT IN ('published', 'superseded') THEN
      RAISE EXCEPTION 'published rate_schedules may only remain published or be superseded; create a new version instead of reverting to draft.';
    END IF;

    IF OLD.status = 'superseded' AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'superseded rate_schedules are immutable financial baselines.';
    END IF;

    v_allowed_keys := CASE
      WHEN OLD.status = 'published' THEN ARRAY['end_date', 'status', 'notes', 'updated_at', 'updated_by']
      ELSE ARRAY['notes', 'updated_at', 'updated_by']
    END;

    IF (to_jsonb(NEW) - v_allowed_keys) IS DISTINCT FROM (to_jsonb(OLD) - v_allowed_keys) THEN
      RAISE EXCEPTION 'rate_schedules are versioned and read-only once published; create a new effective-dated version instead.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.haven_rate_schedule_no_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'rate_schedules are financial records and cannot be hard-deleted; supersede or soft-delete draft data through an audited update.';
END;
$$;

CREATE OR REPLACE FUNCTION public.haven_publish_rate_schedule(
  p_facility_id uuid,
  p_organization_id uuid,
  p_name text,
  p_effective_date date,
  p_base_rate_private integer,
  p_base_rate_semi_private integer,
  p_care_surcharge_level_1 integer,
  p_care_surcharge_level_2 integer,
  p_care_surcharge_level_3 integer,
  p_community_fee integer,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_new_id uuid;
  v_conflicting_current_count integer;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'rate schedule name is required.';
  END IF;

  IF p_effective_date IS NULL THEN
    RAISE EXCEPTION 'rate schedule effective date is required.';
  END IF;

  IF p_base_rate_private IS NULL OR p_base_rate_private <= 0 THEN
    RAISE EXCEPTION 'private base rate must be positive.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text, 0));

  IF NOT EXISTS (
    SELECT 1 FROM facilities f
    WHERE f.id = p_facility_id
      AND f.organization_id = p_organization_id
      AND f.deleted_at IS NULL
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'facility does not belong to the requested organization.';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'signed-in user required.';
    END IF;

    IF haven.app_role() NOT IN ('owner', 'org_admin', 'facility_admin') THEN
      RAISE EXCEPTION 'insufficient permission to publish rate schedules.';
    END IF;

    IF p_organization_id IS DISTINCT FROM haven.organization_id()
      OR NOT (p_facility_id IN (SELECT haven.accessible_facility_ids())) THEN
      RAISE EXCEPTION 'facility is outside the current user access scope.';
    END IF;
  END IF;

  SELECT count(*)
  INTO v_conflicting_current_count
  FROM rate_schedules
  WHERE organization_id = p_organization_id
    AND facility_id = p_facility_id
    AND deleted_at IS NULL
    AND end_date IS NULL
    AND effective_date >= p_effective_date;

  IF v_conflicting_current_count > 0 THEN
    RAISE EXCEPTION 'new posted rate effective date must be after the current open schedule.';
  END IF;

  INSERT INTO rate_schedules (
    facility_id,
    organization_id,
    name,
    effective_date,
    end_date,
    base_rate_private,
    base_rate_semi_private,
    care_surcharge_level_1,
    care_surcharge_level_2,
    care_surcharge_level_3,
    community_fee,
    notes,
    status,
    created_by,
    updated_by
  ) VALUES (
    p_facility_id,
    p_organization_id,
    p_name,
    p_effective_date,
    NULL,
    p_base_rate_private,
    p_base_rate_semi_private,
    COALESCE(p_care_surcharge_level_1, 0),
    COALESCE(p_care_surcharge_level_2, 0),
    COALESCE(p_care_surcharge_level_3, 0),
    COALESCE(p_community_fee, 0),
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    'published',
    v_actor,
    v_actor
  ) RETURNING id INTO v_new_id;

  UPDATE rate_schedules
  SET
    end_date = p_effective_date - 1,
    status = 'superseded',
    updated_at = now(),
    updated_by = v_actor
  WHERE organization_id = p_organization_id
    AND facility_id = p_facility_id
    AND deleted_at IS NULL
    AND end_date IS NULL
    AND effective_date < p_effective_date
    AND id <> v_new_id;

  RETURN v_new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.haven_replace_active_resident_rate_agreement(
  p_resident_id uuid,
  p_facility_id uuid,
  p_organization_id uuid,
  p_effective_date date,
  p_rate_schedule_id uuid,
  p_room_class rate_room_class,
  p_standard_base_rate_at_signing integer,
  p_standard_care_surcharge_at_signing integer,
  p_standard_monthly_total_at_signing integer,
  p_negotiated_base_rate integer,
  p_care_charge_mode care_charge_mode,
  p_negotiated_care_surcharge integer,
  p_negotiated_monthly_total integer,
  p_concession_amount_at_signing integer,
  p_concession_pct_at_signing numeric,
  p_concession_reason concession_reason,
  p_concession_notes text DEFAULT NULL,
  p_concession_expires_on date DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_resident record;
  v_schedule record;
  v_current record;
  v_has_current boolean := false;
  v_new_id uuid;
  v_version integer;
  v_standard_base integer;
  v_standard_care integer;
  v_standard_total integer;
  v_concession integer;
  v_concession_pct numeric(7, 2);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'signed-in user required.';
  END IF;

  IF haven.app_role() NOT IN ('owner', 'org_admin', 'facility_admin') THEN
    RAISE EXCEPTION 'insufficient permission to manage resident billing agreements.';
  END IF;

  SELECT id, organization_id, facility_id, acuity_level
  INTO v_resident
  FROM residents
  WHERE id = p_resident_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'resident not found.';
  END IF;

  IF v_resident.organization_id IS DISTINCT FROM p_organization_id
    OR v_resident.facility_id IS DISTINCT FROM p_facility_id THEN
    RAISE EXCEPTION 'resident does not match the requested organization/facility.';
  END IF;

  IF p_organization_id IS DISTINCT FROM haven.organization_id()
    OR NOT (p_facility_id IN (SELECT haven.accessible_facility_ids())) THEN
    RAISE EXCEPTION 'resident is outside the current user access scope.';
  END IF;

  IF p_effective_date IS NULL THEN
    RAISE EXCEPTION 'agreement effective date is required.';
  END IF;

  IF p_negotiated_monthly_total < 0 OR p_negotiated_base_rate < 0 THEN
    RAISE EXCEPTION 'agreement monetary amounts must be non-negative.';
  END IF;

  IF p_care_charge_mode = 'flat' AND p_negotiated_care_surcharge IS NULL THEN
    RAISE EXCEPTION 'flat care charge mode requires a negotiated care surcharge.';
  END IF;

  IF p_rate_schedule_id IS NULL THEN
    RAISE EXCEPTION 'rate schedule is required for resident billing agreements.';
  END IF;

  SELECT
    rs.id,
    rs.base_rate_private,
    rs.base_rate_semi_private,
    rs.care_surcharge_level_1,
    rs.care_surcharge_level_2,
    rs.care_surcharge_level_3
  INTO v_schedule
  FROM rate_schedules rs
  WHERE rs.id = p_rate_schedule_id
    AND rs.organization_id = p_organization_id
    AND rs.facility_id = p_facility_id
    AND rs.deleted_at IS NULL
    AND rs.effective_date <= p_effective_date
    AND (rs.end_date IS NULL OR rs.end_date >= p_effective_date);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rate schedule does not match the resident facility.';
  END IF;

  v_standard_base := CASE
    WHEN p_room_class = 'companion' THEN COALESCE(v_schedule.base_rate_semi_private, v_schedule.base_rate_private)
    ELSE v_schedule.base_rate_private
  END;

  v_standard_care := CASE v_resident.acuity_level::text
    WHEN 'level_1' THEN COALESCE(v_schedule.care_surcharge_level_1, 0)
    WHEN 'level_2' THEN COALESCE(v_schedule.care_surcharge_level_2, 0)
    WHEN 'level_3' THEN COALESCE(v_schedule.care_surcharge_level_3, 0)
    ELSE 0
  END;

  v_standard_total := v_standard_base + v_standard_care;
  v_concession := v_standard_total - p_negotiated_monthly_total;
  v_concession_pct := CASE
    WHEN v_standard_total > 0 THEN round((v_concession::numeric / v_standard_total::numeric) * 100, 2)
    ELSE 0
  END;

  IF v_concession > 0 AND p_concession_reason = 'none' THEN
    RAISE EXCEPTION 'concession reason is required when negotiated rent is below posted standard.';
  END IF;

  SELECT id, effective_date
  INTO v_current
  FROM resident_rate_agreements
  WHERE resident_id = p_resident_id
    AND deleted_at IS NULL
    AND status = 'active'
    AND end_date IS NULL
  ORDER BY effective_date DESC, created_at DESC
  LIMIT 1
  FOR UPDATE;

  v_has_current := FOUND;

  SELECT COALESCE(max(version), 0) + 1
  INTO v_version
  FROM resident_rate_agreements
  WHERE resident_id = p_resident_id;

  IF v_has_current THEN
    IF p_effective_date < v_current.effective_date THEN
      RAISE EXCEPTION 'new agreement effective date cannot be before the current active agreement effective date.';
    END IF;

    IF p_effective_date = v_current.effective_date THEN
      UPDATE resident_rate_agreements
      SET
        status = 'superseded',
        end_date = v_current.effective_date,
        updated_by = v_actor
      WHERE id = v_current.id;
    ELSE
      UPDATE resident_rate_agreements
      SET
        end_date = p_effective_date - 1,
        updated_by = v_actor
      WHERE id = v_current.id;
    END IF;
  END IF;

  INSERT INTO resident_rate_agreements (
    resident_id,
    facility_id,
    organization_id,
    status,
    version,
    effective_date,
    end_date,
    supersedes_id,
    rate_schedule_id,
    room_class,
    standard_base_rate_at_signing,
    standard_care_surcharge_at_signing,
    standard_monthly_total_at_signing,
    negotiated_base_rate,
    care_charge_mode,
    negotiated_care_surcharge,
    negotiated_monthly_total,
    concession_amount_at_signing,
    concession_pct_at_signing,
    concession_reason,
    concession_notes,
    concession_expires_on,
    approved_by,
    approved_at,
    notes,
    created_by,
    updated_by
  ) VALUES (
    p_resident_id,
    p_facility_id,
    p_organization_id,
    'active',
    v_version,
    p_effective_date,
    NULL,
    v_current.id,
    p_rate_schedule_id,
    p_room_class,
    v_standard_base,
    v_standard_care,
    v_standard_total,
    p_negotiated_base_rate,
    p_care_charge_mode,
    p_negotiated_care_surcharge,
    p_negotiated_monthly_total,
    v_concession,
    v_concession_pct,
    p_concession_reason,
    NULLIF(btrim(COALESCE(p_concession_notes, '')), ''),
    p_concession_expires_on,
    v_actor,
    now(),
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    v_actor,
    v_actor
  ) RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.haven_create_invoice_with_line_items(
  p_facility_id uuid,
  p_resident_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_due_date date,
  p_period_start date,
  p_period_end date,
  p_subtotal integer,
  p_adjustments integer,
  p_tax integer,
  p_total integer,
  p_amount_paid integer,
  p_balance_due integer,
  p_payer_type text,
  p_payer_name text,
  p_notes text,
  p_line_items jsonb
)
RETURNS TABLE(invoice_id uuid, inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid;
  v_entity uuid;
  v_invoice_id uuid;
  v_item jsonb;
  v_non_adjustment_total integer;
  v_adjustment_total integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'signed-in user required.';
    END IF;

    IF haven.app_role() NOT IN ('owner', 'org_admin', 'facility_admin') THEN
      RAISE EXCEPTION 'insufficient permission to generate invoices.';
    END IF;
  END IF;

  SELECT r.organization_id, f.entity_id
  INTO v_org, v_entity
  FROM residents r
  JOIN facilities f ON f.id = r.facility_id
  WHERE r.id = p_resident_id
    AND r.facility_id = p_facility_id
    AND r.deleted_at IS NULL
    AND f.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'resident/facility not found.';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF v_org IS DISTINCT FROM haven.organization_id()
      OR NOT (p_facility_id IN (SELECT haven.accessible_facility_ids())) THEN
      RAISE EXCEPTION 'resident is outside the current user access scope.';
    END IF;
  END IF;

  IF p_total IS DISTINCT FROM COALESCE(p_subtotal, 0) + COALESCE(p_adjustments, 0) + COALESCE(p_tax, 0) THEN
    RAISE EXCEPTION 'invoice total must equal subtotal + adjustments + tax.';
  END IF;

  IF p_balance_due IS DISTINCT FROM p_total - COALESCE(p_amount_paid, 0) THEN
    RAISE EXCEPTION 'invoice balance_due must equal total - amount_paid.';
  END IF;

  IF jsonb_typeof(COALESCE(p_line_items, '[]'::jsonb)) <> 'array'
    OR jsonb_array_length(COALESCE(p_line_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'invoice must include at least one line item.';
  END IF;

  SELECT
    COALESCE(sum(CASE WHEN value->>'line_type' IN ('negotiated_concession', 'rate_premium') THEN 0 ELSE (value->>'total')::integer END), 0),
    COALESCE(sum(CASE WHEN value->>'line_type' IN ('negotiated_concession', 'rate_premium') THEN (value->>'total')::integer ELSE 0 END), 0)
  INTO v_non_adjustment_total, v_adjustment_total
  FROM jsonb_array_elements(p_line_items);

  IF v_non_adjustment_total IS DISTINCT FROM p_subtotal THEN
    RAISE EXCEPTION 'invoice non-adjustment line total must equal subtotal.';
  END IF;

  IF v_adjustment_total IS DISTINCT FROM p_adjustments THEN
    RAISE EXCEPTION 'invoice adjustment line total must equal adjustments.';
  END IF;

  BEGIN
    INSERT INTO invoices (
      resident_id,
      facility_id,
      organization_id,
      entity_id,
      invoice_number,
      invoice_date,
      due_date,
      period_start,
      period_end,
      status,
      subtotal,
      adjustments,
      tax,
      total,
      amount_paid,
      balance_due,
      payer_type,
      payer_name,
      notes,
      created_by,
      updated_by
    ) VALUES (
      p_resident_id,
      p_facility_id,
      v_org,
      v_entity,
      p_invoice_number,
      p_invoice_date,
      p_due_date,
      p_period_start,
      p_period_end,
      'draft',
      p_subtotal,
      p_adjustments,
      p_tax,
      p_total,
      p_amount_paid,
      p_balance_due,
      NULLIF(p_payer_type, '')::payer_type,
      NULLIF(btrim(COALESCE(p_payer_name, '')), ''),
      NULLIF(btrim(COALESCE(p_notes, '')), ''),
      v_actor,
      v_actor
    ) RETURNING id INTO v_invoice_id;
  EXCEPTION WHEN unique_violation THEN
    invoice_id := NULL;
    inserted := false;
    RETURN NEXT;
    RETURN;
  END;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_line_items) LOOP
    INSERT INTO invoice_line_items (
      invoice_id,
      organization_id,
      line_type,
      description,
      quantity,
      unit_price,
      total,
      sort_order
    ) VALUES (
      v_invoice_id,
      v_org,
      v_item->>'line_type',
      v_item->>'description',
      COALESCE((v_item->>'quantity')::numeric, 1),
      (v_item->>'unit_price')::integer,
      (v_item->>'total')::integer,
      COALESCE((v_item->>'sort_order')::integer, 0)
    );
  END LOOP;

  invoice_id := v_invoice_id;
  inserted := true;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.haven_publish_rate_schedule(uuid, uuid, text, date, integer, integer, integer, integer, integer, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.haven_replace_active_resident_rate_agreement(uuid, uuid, uuid, date, uuid, rate_room_class, integer, integer, integer, integer, care_charge_mode, integer, integer, integer, numeric, concession_reason, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.haven_create_invoice_with_line_items(uuid, uuid, text, date, date, date, date, integer, integer, integer, integer, integer, integer, text, text, text, jsonb) TO authenticated, service_role;

-- Install the guards after the Homewood cleanup below so this migration can correct the published baseline.

-- ============================================================
-- HOMEWOOD POSTED RATE CLEANUP
-- ============================================================
DO $$
DECLARE
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_homewood uuid := '00000000-0000-0000-0002-000000000003';
  v_schedule_id uuid;
BEGIN
  -- Close any older open Homewood legacy schedules before the May 2026 posted-rate card.
  UPDATE rate_schedules
  SET
    end_date = DATE '2026-04-30',
    status = 'superseded',
    updated_at = now(),
    notes = concat_ws(E'\n', notes, 'Closed by migration 306: superseded by Homewood posted rates effective 2026-05-01.')
  WHERE organization_id = v_org
    AND facility_id = v_homewood
    AND deleted_at IS NULL
    AND end_date IS NULL
    AND effective_date < DATE '2026-05-01';

  SELECT id
  INTO v_schedule_id
  FROM rate_schedules
  WHERE organization_id = v_org
    AND facility_id = v_homewood
    AND deleted_at IS NULL
    AND effective_date = DATE '2026-05-01'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_schedule_id IS NULL THEN
    INSERT INTO rate_schedules (
      facility_id,
      organization_id,
      name,
      effective_date,
      end_date,
      base_rate_private,
      base_rate_semi_private,
      care_surcharge_level_1,
      care_surcharge_level_2,
      care_surcharge_level_3,
      community_fee,
      notes,
      status
    ) VALUES (
      v_homewood,
      v_org,
      '2026 Homewood Posted Rates',
      DATE '2026-05-01',
      NULL,
      555000,
      440000,
      0,
      0,
      0,
      0,
      'Homewood posted May 2026 room rates: private $5,550; companion $4,400. Created by migration 306.',
      'published'
    ) RETURNING id INTO v_schedule_id;
  ELSE
    UPDATE rate_schedules
    SET
      base_rate_private = 555000,
      base_rate_semi_private = 440000,
      care_surcharge_level_1 = COALESCE(care_surcharge_level_1, 0),
      care_surcharge_level_2 = COALESCE(care_surcharge_level_2, 0),
      care_surcharge_level_3 = COALESCE(care_surcharge_level_3, 0),
      end_date = NULL,
      status = 'published',
      updated_at = now(),
      notes = concat_ws(E'\n', notes, 'Corrected by migration 306: Homewood companion posted rate set to $4,400 effective 2026-05-01.')
    WHERE id = v_schedule_id;
  END IF;

  -- Close duplicate same-effective Homewood rows so current-rate resolution is deterministic.
  UPDATE rate_schedules
  SET
    end_date = DATE '2026-04-30',
    status = 'superseded',
    updated_at = now(),
    notes = concat_ws(E'\n', notes, 'Closed by migration 306: duplicate Homewood May 2026 posted-rate card superseded by canonical row.')
  WHERE organization_id = v_org
    AND facility_id = v_homewood
    AND deleted_at IS NULL
    AND effective_date = DATE '2026-05-01'
    AND id <> v_schedule_id;

  -- If the facility-admin posted-rate-version table exists, correct its current companion/semi-private amount too.
  IF to_regclass('public.rate_schedule_versions') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE rate_schedule_versions
      SET
        amount_cents = 440000,
        rate_confirmed = true,
        updated_at = now(),
        notes = concat_ws(E'\n', notes, 'Corrected by migration 306: Homewood companion posted rate set to $4,400 effective 2026-05-01.')
      WHERE organization_id = '00000000-0000-0000-0000-000000000001'::uuid
        AND facility_id = '00000000-0000-0000-0002-000000000003'::uuid
        AND rate_type = 'semi_private_room'
        AND effective_from = DATE '2026-05-01'
        AND effective_to IS NULL
        AND deleted_at IS NULL
    $sql$;
  END IF;
END $$;

DROP TRIGGER IF EXISTS tr_rate_schedules_published_guard ON rate_schedules;
CREATE TRIGGER tr_rate_schedules_published_guard
  BEFORE UPDATE ON rate_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_rate_schedule_published_guard();

DROP TRIGGER IF EXISTS tr_rate_schedules_no_delete_guard ON rate_schedules;
CREATE TRIGGER tr_rate_schedules_no_delete_guard
  BEFORE DELETE ON rate_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.haven_rate_schedule_no_delete_guard();
