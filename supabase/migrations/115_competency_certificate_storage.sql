-- D11 / Module 12: private Storage bucket for competency demonstration certificate PDFs.
-- Object path (within bucket): {organization_id}/{facility_id}/{demonstration_id}/{filename}.pdf
-- Matches competency_demonstrations.attachments jsonb: [{ "storage_path": "<full path>", "label": "..." }]

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'competency-certificates',
  'competency-certificates',
  false,
  15728640,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- RLS on storage.objects is already enabled on Supabase hosted; omit ALTER (migration role is not owner).

DROP POLICY IF EXISTS competency_certificates_read ON storage.objects;

CREATE POLICY competency_certificates_read ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'competency-certificates'
    AND split_part(name, '/', 1) = haven.organization_id()::text
    AND haven.has_facility_access(split_part(name, '/', 2)::uuid)
    AND (
      haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
      OR EXISTS (
        SELECT
          1
        FROM
          competency_demonstrations cd
          INNER JOIN staff s ON s.id = cd.staff_id
            AND s.deleted_at IS NULL
        WHERE
          cd.id = split_part(name, '/', 3)::uuid
          AND cd.deleted_at IS NULL
          AND s.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS competency_certificates_write ON storage.objects;

CREATE POLICY competency_certificates_write ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'competency-certificates'
    AND split_part(name, '/', 1) = haven.organization_id()::text
    AND haven.has_facility_access(split_part(name, '/', 2)::uuid)
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

DROP POLICY IF EXISTS competency_certificates_update ON storage.objects;

CREATE POLICY competency_certificates_update ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'competency-certificates'
    AND split_part(name, '/', 1) = haven.organization_id()::text
    AND haven.has_facility_access(split_part(name, '/', 2)::uuid)
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  )
  WITH CHECK (
    bucket_id = 'competency-certificates'
    AND split_part(name, '/', 1) = haven.organization_id()::text
    AND haven.has_facility_access(split_part(name, '/', 2)::uuid)
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

DROP POLICY IF EXISTS competency_certificates_delete ON storage.objects;

CREATE POLICY competency_certificates_delete ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'competency-certificates'
    AND split_part(name, '/', 1) = haven.organization_id()::text
    AND haven.has_facility_access(split_part(name, '/', 2)::uuid)
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );
