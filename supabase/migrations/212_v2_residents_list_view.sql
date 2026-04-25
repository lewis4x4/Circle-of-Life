-- UI-V2 S9: residents list view backing /admin/v2/residents.
-- security_invoker so RLS on public.residents and public.facilities cascades.
-- (Plan numbering 215 → renumbered 212 since 211 was the combined facility
-- rollup, not four per-dashboard views.)

CREATE OR REPLACE VIEW haven.vw_v2_residents_list
WITH (security_invoker = true) AS
SELECT
  r.id AS resident_id,
  r.organization_id,
  r.facility_id,
  f.name AS facility_name,
  TRIM(BOTH ' ' FROM CONCAT(r.first_name, ' ', r.last_name)) AS resident_name,
  r.first_name,
  r.last_name,
  r.status::text AS resident_status,
  r.primary_diagnosis,
  r.discharge_date,
  r.created_at,
  r.updated_at
FROM public.residents r
LEFT JOIN public.facilities f ON f.id = r.facility_id
WHERE r.deleted_at IS NULL;

COMMENT ON VIEW haven.vw_v2_residents_list IS
  'UI-V2 W2 list view: residents joined with facility name. UI-V2 S9.';

GRANT SELECT ON haven.vw_v2_residents_list TO authenticated, service_role;
