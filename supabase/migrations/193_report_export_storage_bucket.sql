INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'report-exports',
  'report-exports',
  false,
  26214400,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS report_exports_storage_read ON storage.objects;
CREATE POLICY report_exports_storage_read ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'report-exports'
    AND split_part(name, '/', 1) = haven.organization_id()::text
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

DROP POLICY IF EXISTS report_exports_storage_write ON storage.objects;
CREATE POLICY report_exports_storage_write ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'report-exports'
    AND split_part(name, '/', 1) = haven.organization_id()::text
    AND haven.app_role() IN ('owner', 'org_admin')
  );

DROP POLICY IF EXISTS report_exports_storage_update ON storage.objects;
CREATE POLICY report_exports_storage_update ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'report-exports'
    AND split_part(name, '/', 1) = haven.organization_id()::text
    AND haven.app_role() IN ('owner', 'org_admin')
  )
  WITH CHECK (
    bucket_id = 'report-exports'
    AND split_part(name, '/', 1) = haven.organization_id()::text
    AND haven.app_role() IN ('owner', 'org_admin')
  );

DROP POLICY IF EXISTS report_exports_storage_delete ON storage.objects;
CREATE POLICY report_exports_storage_delete ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'report-exports'
    AND split_part(name, '/', 1) = haven.organization_id()::text
    AND haven.app_role() IN ('owner', 'org_admin')
  );
