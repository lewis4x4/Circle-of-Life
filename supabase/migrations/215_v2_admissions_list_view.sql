-- UI-V2 S9: admissions list view backing /admin/v2/admissions.
-- security_invoker so RLS on public.admission_cases / residents / facilities cascades.

CREATE OR REPLACE VIEW haven.vw_v2_admissions_list
WITH (security_invoker = true) AS
SELECT
  ac.id AS admission_case_id,
  ac.organization_id,
  ac.facility_id,
  f.name AS facility_name,
  ac.resident_id,
  TRIM(BOTH ' ' FROM CONCAT(r.first_name, ' ', r.last_name)) AS resident_name,
  ac.status::text AS admission_status,
  ac.target_move_in_date,
  ac.financial_clearance_at,
  ac.physician_orders_received_at,
  ac.bed_id,
  ac.referral_lead_id,
  ac.created_at,
  ac.updated_at
FROM public.admission_cases ac
LEFT JOIN public.facilities f ON f.id = ac.facility_id
LEFT JOIN public.residents r ON r.id = ac.resident_id
WHERE ac.deleted_at IS NULL;

COMMENT ON VIEW haven.vw_v2_admissions_list IS
  'UI-V2 W2 list view: admission_cases joined with facility + resident name. UI-V2 S9.';

GRANT SELECT ON haven.vw_v2_admissions_list TO authenticated, service_role;
