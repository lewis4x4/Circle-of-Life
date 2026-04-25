-- UI-V2 S9: incidents list view backing /admin/v2/incidents.
-- security_invoker so RLS on public.incidents and public.facilities cascades.

CREATE OR REPLACE VIEW haven.vw_v2_incidents_list
WITH (security_invoker = true) AS
SELECT
  i.id AS incident_id,
  i.organization_id,
  i.facility_id,
  f.name AS facility_name,
  i.incident_number,
  i.category::text AS category,
  i.severity::text AS severity,
  i.status::text AS incident_status,
  i.occurred_at,
  i.discovered_at,
  i.location_description,
  i.injury_occurred,
  i.injury_severity,
  i.ahca_reportable,
  i.ahca_reported,
  i.resolved_at,
  i.created_at
FROM public.incidents i
LEFT JOIN public.facilities f ON f.id = i.facility_id
WHERE i.deleted_at IS NULL;

COMMENT ON VIEW haven.vw_v2_incidents_list IS
  'UI-V2 W2 list view: incidents joined with facility name + reportable flags. UI-V2 S9.';

GRANT SELECT ON haven.vw_v2_incidents_list TO authenticated, service_role;
