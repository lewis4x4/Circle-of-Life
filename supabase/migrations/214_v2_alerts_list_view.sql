-- UI-V2 S9: executive-alerts list view backing /admin/v2/executive/alerts.
-- security_invoker so RLS on public.exec_alerts cascades.

CREATE OR REPLACE VIEW haven.vw_v2_alerts_list
WITH (security_invoker = true) AS
SELECT
  a.id AS alert_id,
  a.organization_id,
  a.facility_id,
  f.name AS facility_name,
  a.title,
  a.category,
  a.severity,
  a.status,
  a.source_metric_code,
  a.first_triggered_at,
  a.acknowledged_at,
  a.resolved_at,
  a.last_evaluated_at,
  a.created_at
FROM public.exec_alerts a
LEFT JOIN public.facilities f ON f.id = a.facility_id
WHERE a.deleted_at IS NULL;

COMMENT ON VIEW haven.vw_v2_alerts_list IS
  'UI-V2 W2 list view: exec_alerts joined with facility name. UI-V2 S9.';

GRANT SELECT ON haven.vw_v2_alerts_list TO authenticated, service_role;
