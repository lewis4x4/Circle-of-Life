CREATE INDEX IF NOT EXISTS idx_survey_deficiencies_facility_tag_survey_date_id_active
ON public.survey_deficiencies (facility_id, tag_number, survey_date, id)
WHERE deleted_at IS NULL;
