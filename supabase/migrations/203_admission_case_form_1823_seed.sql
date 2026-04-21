-- S4: Admission case Form 1823 checklist seeding and case linkage

ALTER TABLE form_1823_records
  ADD COLUMN IF NOT EXISTS admission_case_id uuid REFERENCES admission_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_form_1823_case
  ON form_1823_records (admission_case_id, updated_at DESC)
  WHERE deleted_at IS NULL
    AND admission_case_id IS NOT NULL;

INSERT INTO admission_document_checklist_items (
  organization_id,
  facility_id,
  admission_case_id,
  document_type,
  required,
  created_by,
  updated_by
)
SELECT
  ac.organization_id,
  ac.facility_id,
  ac.id,
  'form_1823'::admission_document_type,
  true,
  ac.created_by,
  ac.updated_by
FROM admission_cases ac
WHERE ac.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM admission_document_checklist_items items
    WHERE items.admission_case_id = ac.id
      AND items.document_type = 'form_1823'
      AND items.deleted_at IS NULL
  );

CREATE OR REPLACE FUNCTION public.seed_admission_case_form_1823()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO admission_document_checklist_items (
    organization_id,
    facility_id,
    admission_case_id,
    document_type,
    required,
    created_by,
    updated_by
  )
  VALUES (
    NEW.organization_id,
    NEW.facility_id,
    NEW.id,
    'form_1823',
    true,
    NEW.created_by,
    NEW.updated_by
  )
  ON CONFLICT (admission_case_id, document_type) WHERE deleted_at IS NULL DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_admission_cases_seed_form_1823 ON admission_cases;
CREATE TRIGGER tr_admission_cases_seed_form_1823
  AFTER INSERT ON admission_cases
  FOR EACH ROW
  EXECUTE PROCEDURE public.seed_admission_case_form_1823();
