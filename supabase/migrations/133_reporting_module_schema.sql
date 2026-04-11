-- Module 26 - Reporting Module Operating System (Core schema)
-- Idempotent enum creation: remote may already have these types if schema was applied outside migration history.

DO $$ BEGIN
  CREATE TYPE report_owner_type AS ENUM (
    'system',
    'organization',
    'facility',
    'user'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE report_template_status AS ENUM (
    'draft',
    'active',
    'deprecated',
    'archived'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE report_sharing_scope AS ENUM (
    'private',
    'team',
    'facility',
    'organization'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE report_source_type AS ENUM (
    'template',
    'saved_view',
    'pack'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE report_run_status AS ENUM (
    'queued',
    'running',
    'completed',
    'failed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE report_schedule_status AS ENUM (
    'active',
    'paused',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE report_export_format AS ENUM (
    'csv',
    'pdf',
    'print',
    'xlsx'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS report_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid REFERENCES organizations (id),
  owner_type report_owner_type NOT NULL DEFAULT 'system',
  owner_user_id uuid REFERENCES auth.users (id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  slug text NOT NULL CHECK (length(trim(slug)) > 0),
  category text NOT NULL,
  short_description text NOT NULL DEFAULT '',
  long_description text,
  tags text[] NOT NULL DEFAULT '{}',
  intended_roles app_role[] NOT NULL DEFAULT '{}',
  default_pack_membership text[] NOT NULL DEFAULT '{}',
  use_cases text[] NOT NULL DEFAULT '{}',
  official_template boolean NOT NULL DEFAULT false,
  locked_definition boolean NOT NULL DEFAULT false,
  clonable boolean NOT NULL DEFAULT true,
  benchmark_capable boolean NOT NULL DEFAULT false,
  supports_schedule boolean NOT NULL DEFAULT true,
  supports_pack_membership boolean NOT NULL DEFAULT true,
  supports_nlq_mapping boolean NOT NULL DEFAULT true,
  status report_template_status NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_templates_slug_org ON report_templates (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), slug)
WHERE
  deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_report_templates_lookup ON report_templates (status, category)
WHERE
  deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS report_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  template_id uuid NOT NULL REFERENCES report_templates (id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  definition_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  change_summary text,
  status report_template_status NOT NULL DEFAULT 'active',
  published_at timestamptz NOT NULL DEFAULT now (),
  published_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz,
  CONSTRAINT report_template_versions_unique UNIQUE (template_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_report_template_versions_lookup ON report_template_versions (template_id, version_number DESC)
WHERE
  deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS report_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  template_id uuid NOT NULL REFERENCES report_templates (id),
  template_version_id uuid NOT NULL REFERENCES report_template_versions (id),
  owner_user_id uuid NOT NULL REFERENCES auth.users (id),
  facility_id uuid REFERENCES facilities (id),
  entity_id uuid REFERENCES entities (id),
  sharing_scope report_sharing_scope NOT NULL DEFAULT 'private',
  name text NOT NULL CHECK (length(trim(name)) > 0),
  custom_filters_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  custom_grouping_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  custom_sort_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  pinned_template_version boolean NOT NULL DEFAULT true,
  is_favorite boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_report_saved_views_org ON report_saved_views (organization_id, owner_user_id)
WHERE
  deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  source_type report_source_type NOT NULL,
  source_id uuid NOT NULL,
  facility_id uuid REFERENCES facilities (id),
  entity_id uuid REFERENCES entities (id),
  timezone text NOT NULL DEFAULT 'America/New_York',
  recurrence_rule text NOT NULL,
  output_format report_export_format NOT NULL DEFAULT 'pdf',
  title_pattern text NOT NULL DEFAULT '',
  status report_schedule_status NOT NULL DEFAULT 'active',
  last_run_at timestamptz,
  next_run_at timestamptz,
  last_error text,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_report_schedules_due ON report_schedules (organization_id, status, next_run_at)
WHERE
  deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS report_schedule_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  schedule_id uuid NOT NULL REFERENCES report_schedules (id) ON DELETE CASCADE,
  recipient_user_id uuid REFERENCES auth.users (id),
  recipient_email text,
  destination text NOT NULL DEFAULT 'in_app',
  created_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_report_schedule_recipients_schedule ON report_schedule_recipients (schedule_id)
WHERE
  deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  source_type report_source_type NOT NULL,
  source_id uuid NOT NULL,
  template_id uuid REFERENCES report_templates (id),
  template_version_id uuid REFERENCES report_template_versions (id),
  generated_by_user_id uuid REFERENCES auth.users (id),
  run_scope_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  filter_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status report_run_status NOT NULL DEFAULT 'queued',
  runtime_classification text,
  warnings_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_json jsonb,
  started_at timestamptz NOT NULL DEFAULT now (),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX IF NOT EXISTS idx_report_runs_org_created ON report_runs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_runs_source ON report_runs (source_type, source_id, created_at DESC);

CREATE TABLE IF NOT EXISTS report_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  report_run_id uuid NOT NULL REFERENCES report_runs (id) ON DELETE CASCADE,
  export_format report_export_format NOT NULL,
  storage_path text,
  file_name text,
  delivered_to_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX IF NOT EXISTS idx_report_exports_run ON report_exports (report_run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS report_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid REFERENCES facilities (id),
  entity_id uuid REFERENCES entities (id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  description text,
  category text NOT NULL DEFAULT 'operational',
  owner_scope report_sharing_scope NOT NULL DEFAULT 'organization',
  official_pack boolean NOT NULL DEFAULT false,
  locked_definition boolean NOT NULL DEFAULT false,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_report_packs_org ON report_packs (organization_id, active)
WHERE
  deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS report_pack_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  pack_id uuid NOT NULL REFERENCES report_packs (id) ON DELETE CASCADE,
  source_type report_source_type NOT NULL,
  source_id uuid NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  optional_title_override text,
  page_break_before boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_report_pack_items_pack ON report_pack_items (pack_id, display_order)
WHERE
  deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS report_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  template_id uuid NOT NULL REFERENCES report_templates (id) ON DELETE CASCADE,
  role app_role NOT NULL,
  can_view boolean NOT NULL DEFAULT true,
  can_run boolean NOT NULL DEFAULT true,
  can_edit boolean NOT NULL DEFAULT false,
  can_schedule boolean NOT NULL DEFAULT false,
  can_export boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz,
  CONSTRAINT report_permissions_unique UNIQUE (template_id, role)
);

CREATE INDEX IF NOT EXISTS idx_report_permissions_template ON report_permissions (template_id)
WHERE
  deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS report_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  metric_key text NOT NULL,
  benchmark_type text NOT NULL,
  scope_type exec_snapshot_scope NOT NULL,
  scope_id uuid,
  value_definition_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_report_benchmarks_metric ON report_benchmarks (organization_id, metric_key, benchmark_type)
WHERE
  deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS report_nlq_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  template_id uuid NOT NULL REFERENCES report_templates (id) ON DELETE CASCADE,
  prompt_pattern text NOT NULL,
  intent_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence_threshold numeric(4, 3) NOT NULL DEFAULT 0.700,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_report_nlq_mappings_template ON report_nlq_mappings (template_id)
WHERE
  deleted_at IS NULL;
