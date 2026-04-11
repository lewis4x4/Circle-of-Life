-- Module 26 - Reporting module RLS
-- Idempotent: drop existing policies first (remote may have partial prior application)

DROP POLICY IF EXISTS report_templates_select ON report_templates;
DROP POLICY IF EXISTS report_templates_admin_write ON report_templates;
DROP POLICY IF EXISTS report_template_versions_select ON report_template_versions;
DROP POLICY IF EXISTS report_template_versions_admin_write ON report_template_versions;
DROP POLICY IF EXISTS report_saved_views_select ON report_saved_views;
DROP POLICY IF EXISTS report_saved_views_insert ON report_saved_views;
DROP POLICY IF EXISTS report_saved_views_update ON report_saved_views;
DROP POLICY IF EXISTS report_schedules_select ON report_schedules;
DROP POLICY IF EXISTS report_schedules_write ON report_schedules;
DROP POLICY IF EXISTS report_schedule_recipients_select ON report_schedule_recipients;
DROP POLICY IF EXISTS report_schedule_recipients_write ON report_schedule_recipients;
DROP POLICY IF EXISTS report_runs_select ON report_runs;
DROP POLICY IF EXISTS report_runs_insert ON report_runs;
DROP POLICY IF EXISTS report_exports_select ON report_exports;
DROP POLICY IF EXISTS report_exports_insert ON report_exports;
DROP POLICY IF EXISTS report_packs_select ON report_packs;
DROP POLICY IF EXISTS report_packs_write ON report_packs;
DROP POLICY IF EXISTS report_pack_items_select ON report_pack_items;
DROP POLICY IF EXISTS report_pack_items_write ON report_pack_items;
DROP POLICY IF EXISTS report_permissions_select ON report_permissions;
DROP POLICY IF EXISTS report_permissions_write ON report_permissions;
DROP POLICY IF EXISTS report_benchmarks_select ON report_benchmarks;
DROP POLICY IF EXISTS report_benchmarks_write ON report_benchmarks;
DROP POLICY IF EXISTS report_nlq_mappings_select ON report_nlq_mappings;
DROP POLICY IF EXISTS report_nlq_mappings_write ON report_nlq_mappings;

ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedule_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_pack_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_nlq_mappings ENABLE ROW LEVEL SECURITY;

-- Templates
CREATE POLICY report_templates_select ON report_templates
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      organization_id IS NULL
      OR organization_id = haven.organization_id ()
    )
  );

CREATE POLICY report_templates_admin_write ON report_templates
  FOR ALL
  USING (
    deleted_at IS NULL
    AND (
      organization_id IS NULL
      OR organization_id = haven.organization_id ()
    )
    AND haven.app_role () IN ('owner', 'org_admin')
  )
  WITH CHECK (
    (
      organization_id IS NULL
      OR organization_id = haven.organization_id ()
    )
    AND haven.app_role () IN ('owner', 'org_admin')
  );

-- Template versions
CREATE POLICY report_template_versions_select ON report_template_versions
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT
        1
      FROM
        report_templates t
      WHERE
        t.id = report_template_versions.template_id
        AND t.deleted_at IS NULL
        AND (t.organization_id IS NULL OR t.organization_id = haven.organization_id ())
    )
  );

CREATE POLICY report_template_versions_admin_write ON report_template_versions
  FOR ALL
  USING (
    deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
    AND EXISTS (
      SELECT
        1
      FROM
        report_templates t
      WHERE
        t.id = report_template_versions.template_id
        AND t.deleted_at IS NULL
        AND (t.organization_id IS NULL OR t.organization_id = haven.organization_id ())
    )
  )
  WITH CHECK (
    haven.app_role () IN ('owner', 'org_admin')
    AND EXISTS (
      SELECT
        1
      FROM
        report_templates t
      WHERE
        t.id = report_template_versions.template_id
        AND t.deleted_at IS NULL
        AND (t.organization_id IS NULL OR t.organization_id = haven.organization_id ())
    )
  );

-- Saved views
CREATE POLICY report_saved_views_select ON report_saved_views
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR owner_user_id = auth.uid ()
      OR (
        sharing_scope = 'facility'
        AND facility_id IN (SELECT haven.accessible_facility_ids ())
      )
      OR sharing_scope = 'organization'
    )
  );

CREATE POLICY report_saved_views_insert ON report_saved_views
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND owner_user_id = auth.uid ()
  );

CREATE POLICY report_saved_views_update ON report_saved_views
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR owner_user_id = auth.uid ()
    )
  )
  WITH CHECK (
    organization_id = haven.organization_id ()
  );

-- Schedules + recipients
CREATE POLICY report_schedules_select ON report_schedules
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR created_by = auth.uid ()
      OR (
        facility_id IS NOT NULL
        AND facility_id IN (SELECT haven.accessible_facility_ids ())
      )
    )
  );

CREATE POLICY report_schedules_write ON report_schedules
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
  )
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
  );

CREATE POLICY report_schedule_recipients_select ON report_schedule_recipients
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
  );

CREATE POLICY report_schedule_recipients_write ON report_schedule_recipients
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
  )
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
  );

-- Runs + exports (append/read)
CREATE POLICY report_runs_select ON report_runs
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND (
      haven.app_role () IN ('owner', 'org_admin')
      OR (
        run_scope_json ? 'facility_id'
        AND (run_scope_json ->> 'facility_id')::uuid IN (SELECT haven.accessible_facility_ids ())
      )
      OR generated_by_user_id = auth.uid ()
    )
  );

CREATE POLICY report_runs_insert ON report_runs
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
  );

CREATE POLICY report_exports_select ON report_exports
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
  );

CREATE POLICY report_exports_insert ON report_exports
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
  );

-- Packs
CREATE POLICY report_packs_select ON report_packs
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
  );

CREATE POLICY report_packs_write ON report_packs
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
  )
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
  );

CREATE POLICY report_pack_items_select ON report_pack_items
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
  );

CREATE POLICY report_pack_items_write ON report_pack_items
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
  )
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
  );

-- Governance
CREATE POLICY report_permissions_select ON report_permissions
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
  );

CREATE POLICY report_permissions_write ON report_permissions
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
  )
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
  );

CREATE POLICY report_benchmarks_select ON report_benchmarks
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
  );

CREATE POLICY report_benchmarks_write ON report_benchmarks
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
  )
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
  );

CREATE POLICY report_nlq_mappings_select ON report_nlq_mappings
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
  );

CREATE POLICY report_nlq_mappings_write ON report_nlq_mappings
  FOR ALL
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND haven.app_role () IN ('owner', 'org_admin')
  )
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin')
  );
