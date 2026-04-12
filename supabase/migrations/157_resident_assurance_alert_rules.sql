-- Migration 157: Resident Assurance alert rules for exec intelligence
-- Seeds exec_alert_rules with observation compliance thresholds.

INSERT INTO public.exec_alert_rules (
  organization_id, metric_domain, severity, condition_op, condition_value,
  alert_title_template, alert_body_template, source_module, deep_link_template,
  severity_weight, impact_weight, category, why_it_matters
)
SELECT
  o.id,
  r.metric_domain,
  r.severity::public.exec_alert_severity,
  r.condition_op::public.alert_condition_operator,
  r.condition_value,
  r.alert_title_template,
  r.alert_body_template,
  r.source_module,
  r.deep_link_template,
  r.severity_weight,
  r.impact_weight,
  r.category,
  r.why_it_matters
FROM public.organizations o
CROSS JOIN (VALUES
  -- Rule: Overdue observation tasks > 5
  ('residentAssurance.overdueTasksCount', 'warning', 'gt', 5,
   'Elevated overdue observations — {facility_name}',
   '{value} observation task(s) overdue. Staff may need support or reassignment.',
   'resident_assurance', '/admin/rounding/live?facility={facility_id}',
   1.5, 1.5, 'clinical',
   'Overdue observations mean residents are not being checked on schedule. This is a direct safety risk and a survey deficiency if documented.'),

  -- Rule: Missed observation rate > 10%
  ('residentAssurance.missedRate', 'critical', 'gt', 0.10,
   'Observation miss rate exceeds 10% — {facility_name}',
   'Miss rate at {value}. Review staffing levels and observation plan feasibility.',
   'resident_assurance', '/admin/rounding/reports',
   2.0, 2.0, 'clinical',
   'A miss rate above 10% indicates systemic gaps in resident monitoring. This correlates with increased fall and incident risk.'),

  -- Rule: Active watch protocols > 3
  ('residentAssurance.activeWatchCount', 'info', 'gt', 3,
   'Multiple active watch protocols — {facility_name}',
   '{value} active watch protocol(s). Verify staffing can sustain enhanced monitoring.',
   'resident_assurance', '/admin/rounding/live',
   1.0, 1.0, 'clinical',
   'Multiple concurrent watch protocols strain staffing capacity. Consider whether all watches are still clinically necessary.')
) AS r(metric_domain, severity, condition_op, condition_value,
       alert_title_template, alert_body_template, source_module, deep_link_template,
       severity_weight, impact_weight, category, why_it_matters)
WHERE NOT EXISTS (
  SELECT 1 FROM public.exec_alert_rules
  WHERE organization_id = o.id
    AND metric_domain LIKE 'residentAssurance.%'
);
