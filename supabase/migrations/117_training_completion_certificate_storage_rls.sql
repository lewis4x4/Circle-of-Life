-- Module 12 (Track D D40): allow staff to read training-completion PDFs in competency-certificates bucket.
-- Object path: {organization_id}/{facility_id}/tc/{completion_id}/{filename}.pdf
-- (Admins/nurses already match the role branch; this adds staff-self read for tc/* paths.)

DROP POLICY IF EXISTS competency_certificates_read ON storage.objects;

CREATE POLICY competency_certificates_read ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'competency-certificates'
    AND split_part(name, '/', 1) = haven.organization_id()::text
    AND haven.has_facility_access(split_part(name, '/', 2)::uuid)
    AND (
      haven.app_role () IN ('owner', 'org_admin', 'facility_admin', 'nurse')
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
          AND s.user_id = auth.uid ()
      )
      OR (
        split_part(name, '/', 3) = 'tc'
        AND EXISTS (
          SELECT
            1
          FROM
            staff_training_completions stc
            INNER JOIN staff s ON s.id = stc.staff_id
              AND s.deleted_at IS NULL
          WHERE
            stc.id = split_part(name, '/', 4)::uuid
            AND stc.deleted_at IS NULL
            AND stc.organization_id = haven.organization_id ()
            AND stc.facility_id = split_part(name, '/', 2)::uuid
            AND s.user_id = auth.uid ()
        )
      )
    )
  );
