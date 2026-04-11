-- Track E — E11: Remaining FL statute seeds + module linkage for tooltips

INSERT INTO fl_statutes (organization_id, statute_code, statute_title, chapter, agency, description, category, created_by)
SELECT
  '00000000-0000-0000-0000-000000000001',
  '435.04',
  'Level 2 Employee Screening',
  '435',
  'DCF',
  'Fingerprinting and screening requirements for personnel in specified employment categories.',
  'staffing',
  '00000000-0000-0000-0000-000000000001'
WHERE
  NOT EXISTS (
    SELECT
      1
    FROM
      fl_statutes
    WHERE
      organization_id = '00000000-0000-0000-0000-000000000001'
      AND statute_code = '435.04'
      AND deleted_at IS NULL);

INSERT INTO fl_statutes (organization_id, statute_code, statute_title, chapter, agency, description, category, created_by)
SELECT
  '00000000-0000-0000-0000-000000000001',
  '408.809',
  'Background Screening — Agency Requirements',
  '408',
  'AHCA',
  'Agency-level screening obligations for licensed providers and direct care staff.',
  'staffing',
  '00000000-0000-0000-0000-000000000001'
WHERE
  NOT EXISTS (
    SELECT
      1
    FROM
      fl_statutes
    WHERE
      organization_id = '00000000-0000-0000-0000-000000000001'
      AND statute_code = '408.809'
      AND deleted_at IS NULL);

CREATE TABLE fl_statute_module_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  statute_id uuid NOT NULL REFERENCES fl_statutes (id) ON DELETE CASCADE,
  module_code text NOT NULL CHECK (module_code ~ '^[0-9]{2}$'),
  created_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX idx_fl_statute_module_links_active ON fl_statute_module_links (statute_id, module_code)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_fl_statute_module_links_statute ON fl_statute_module_links (statute_id)
WHERE
  deleted_at IS NULL;

COMMENT ON TABLE fl_statute_module_links IS 'Maps fl_statutes rows to Haven module numbers (00–26) for UI tooltips.';

ALTER TABLE fl_statute_module_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY fl_statute_module_links_select ON fl_statute_module_links
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL);

CREATE POLICY fl_statute_module_links_insert ON fl_statute_module_links
  FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id ()
    AND haven.app_role () IN ('owner', 'org_admin'));

CREATE POLICY fl_statute_module_links_update ON fl_statute_module_links
  FOR UPDATE
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL)
  WITH CHECK (
    organization_id = haven.organization_id ());

INSERT INTO fl_statute_module_links (organization_id, statute_id, module_code)
SELECT
  s.organization_id,
  s.id,
  '07'
FROM
  fl_statutes s
WHERE
  s.organization_id = '00000000-0000-0000-0000-000000000001'
  AND s.statute_code = '59A-36.018'
  AND s.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT
      1
    FROM
      fl_statute_module_links l
    WHERE
      l.statute_id = s.id
      AND l.module_code = '07'
      AND l.deleted_at IS NULL);

INSERT INTO fl_statute_module_links (organization_id, statute_id, module_code)
SELECT
  s.organization_id,
  s.id,
  '11'
FROM
  fl_statutes s
WHERE
  s.organization_id = '00000000-0000-0000-0000-000000000001'
  AND s.statute_code = '435.04'
  AND s.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT
      1
    FROM
      fl_statute_module_links l
    WHERE
      l.statute_id = s.id
      AND l.module_code = '11'
      AND l.deleted_at IS NULL);
