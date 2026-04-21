-- Migration 201: OCE reconciliation and generation guard
-- Ensures local environments that previously applied the early OCE migrations
-- are repaired to match the corrected replay-safe schema before first deploy.

-- ============================================================================
-- Schema reconciliation
-- ============================================================================

ALTER TABLE operation_task_templates
  ADD COLUMN IF NOT EXISTS requires_dual_sign BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE operation_task_instances
  ADD COLUMN IF NOT EXISTS priority TEXT,
  ADD COLUMN IF NOT EXISTS license_threatening BOOLEAN,
  ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER;

UPDATE operation_task_instances
SET priority = 'normal'
WHERE priority IS NULL;

UPDATE operation_task_instances
SET license_threatening = false
WHERE license_threatening IS NULL;

ALTER TABLE operation_task_instances
  ALTER COLUMN priority SET DEFAULT 'normal',
  ALTER COLUMN priority SET NOT NULL,
  ALTER COLUMN license_threatening SET DEFAULT false,
  ALTER COLUMN license_threatening SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'oti_priority_check'
      AND conrelid = 'operation_task_instances'::regclass
  ) THEN
    ALTER TABLE operation_task_instances
      ADD CONSTRAINT oti_priority_check
      CHECK (priority IN ('critical', 'high', 'normal', 'low'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'oti_estimated_minutes_check'
      AND conrelid = 'operation_task_instances'::regclass
  ) THEN
    ALTER TABLE operation_task_instances
      ADD CONSTRAINT oti_estimated_minutes_check
      CHECK (estimated_minutes IS NULL OR estimated_minutes >= 0);
  END IF;
END $$;

-- ============================================================================
-- Policy reconciliation
-- ============================================================================

DROP POLICY IF EXISTS ott_manage ON operation_task_templates;
CREATE POLICY ott_manage ON operation_task_templates
  FOR ALL USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

DROP POLICY IF EXISTS ott_facility_read ON operation_task_templates;
CREATE POLICY ott_facility_read ON operation_task_templates
  FOR SELECT USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('facility_admin', 'manager', 'coordinator', 'nurse')
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

DROP POLICY IF EXISTS oti_update ON operation_task_instances;
CREATE POLICY oti_update ON operation_task_instances
  FOR UPDATE USING (
    organization_id = haven.organization_id()
    AND (
      assigned_to = auth.uid()
      OR haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'coordinator', 'admin_assistant', 'nurse', 'dietary', 'maintenance_role')
      OR (
        haven.app_role() = 'facility_admin'
        AND facility_id IN (SELECT haven.accessible_facility_ids())
      )
    )
  );

DROP POLICY IF EXISTS oti_delete ON operation_task_instances;
CREATE POLICY oti_delete ON operation_task_instances
  FOR DELETE USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

DROP POLICY IF EXISTS fa_manage ON facility_assets;
CREATE POLICY fa_manage ON facility_assets
  FOR ALL USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'maintenance_role')
  );

-- ============================================================================
-- Constraint repair for previously-applied local environments
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'vendors'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fa_service_vendor_fk'
  ) THEN
    ALTER TABLE facility_assets
      ADD CONSTRAINT fa_service_vendor_fk
      FOREIGN KEY (last_service_vendor_id)
      REFERENCES vendors(id)
      ON DELETE SET NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'facility_assets'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ott_asset_fk'
  ) THEN
    ALTER TABLE operation_task_templates
      ADD CONSTRAINT ott_asset_fk
      FOREIGN KEY (asset_ref)
      REFERENCES facility_assets(id)
      ON DELETE SET NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'vendors'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ott_vendor_fk'
  ) THEN
    ALTER TABLE operation_task_templates
      ADD CONSTRAINT ott_vendor_fk
      FOREIGN KEY (vendor_booking_ref)
      REFERENCES vendors(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================================
-- Cached field backfill
-- ============================================================================

UPDATE operation_task_templates
SET organization_id = '00000000-0000-0000-0000-000000000001'
WHERE organization_id IS NULL;

UPDATE operation_task_instances AS oti
SET template_name = COALESCE(NULLIF(oti.template_name, ''), ott.name),
    template_category = COALESCE(NULLIF(oti.template_category, ''), ott.category),
    template_cadence_type = COALESCE(NULLIF(oti.template_cadence_type, ''), ott.cadence_type),
    assigned_role = COALESCE(oti.assigned_role, ott.assignee_role),
    priority = COALESCE(oti.priority, ott.priority),
    license_threatening = COALESCE(oti.license_threatening, ott.license_threatening),
    estimated_minutes = COALESCE(oti.estimated_minutes, ott.estimated_minutes),
    requires_dual_sign = COALESCE(oti.requires_dual_sign, ott.requires_dual_sign),
    updated_at = now()
FROM operation_task_templates AS ott
WHERE oti.template_id = ott.id
  AND (
    oti.template_name = ''
    OR oti.template_category = ''
    OR oti.template_cadence_type = ''
    OR oti.assigned_role IS NULL
    OR oti.priority IS NULL
    OR oti.license_threatening IS NULL
    OR oti.estimated_minutes IS NULL
    OR oti.requires_dual_sign IS NULL
  );

-- ============================================================================
-- Generator idempotency guard
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_oti_generated_unique
  ON operation_task_instances (
    organization_id,
    facility_id,
    template_id,
    assigned_shift_date,
    COALESCE(assigned_shift, 'all')
  )
  WHERE deleted_at IS NULL
    AND template_id IS NOT NULL;
