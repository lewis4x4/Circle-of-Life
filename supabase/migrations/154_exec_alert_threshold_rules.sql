-- Migration 154: Dynamic alert threshold rules for executive intelligence
-- Replaces hardcoded alert conditions in exec-alert-evaluator Edge Function
-- with configurable, per-organization rules that can be managed via admin UI.

-- ── Alert rule condition operators ──
DO $$ BEGIN
  CREATE TYPE public.alert_condition_operator AS ENUM (
    'gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'between'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Alert threshold rules table ──
CREATE TABLE IF NOT EXISTS public.exec_alert_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),

  -- Which KPI metric triggers this rule
  metric_domain   text NOT NULL,  -- e.g. 'clinical.openIncidents', 'financial.totalBalanceDueCents', 'infection.activeOutbreaks'

  -- Rule definition
  severity        public.exec_alert_severity NOT NULL DEFAULT 'warning',
  condition_op    public.alert_condition_operator NOT NULL DEFAULT 'gt',
  condition_value numeric NOT NULL,  -- threshold value (e.g. 0 for "any incidents", 2500000 for "$25k AR")
  condition_value_upper numeric,     -- for 'between' operator only

  -- Alert template
  alert_title_template   text NOT NULL,   -- e.g. 'Open incidents at {facility_name}'
  alert_body_template    text,            -- e.g. '{value} open incident(s). Review triage queue.'
  source_module          text NOT NULL DEFAULT 'system',
  deep_link_template     text,            -- e.g. '/admin/executive/alerts?facility={facility_id}'

  -- Scoring weights for dynamic prioritization
  severity_weight   numeric NOT NULL DEFAULT 1.0,
  impact_weight     numeric NOT NULL DEFAULT 1.0,

  -- Category for grouping
  category          text NOT NULL DEFAULT 'operations',

  -- Why this alert matters (shown to executives)
  why_it_matters    text,

  -- Active toggle
  is_active         boolean NOT NULL DEFAULT true,

  -- Standard audit columns
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id),
  deleted_at      timestamptz
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_exec_alert_rules_org_active
  ON public.exec_alert_rules (organization_id, is_active)
  WHERE deleted_at IS NULL;

-- ── RLS ──
ALTER TABLE public.exec_alert_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner/org_admin manage alert rules"
  ON public.exec_alert_rules FOR ALL
  USING (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin')
  );

CREATE POLICY "facility_admin read alert rules"
  ON public.exec_alert_rules FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND haven.app_role() = 'facility_admin'
    AND deleted_at IS NULL
  );

-- ── Audit trigger ──
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.exec_alert_rules
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();

CREATE TRIGGER capture_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.exec_alert_rules
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ══════════════════════════════════════════════════════════
-- ── SEED DEFAULT RULES (COL) ──
-- These replicate the 3 hardcoded rules from the current
-- exec-alert-evaluator Edge Function, plus 4 new ones.
-- ══════════════════════════════════════════════════════════

-- Note: organization_id must be set per-deployment. Using a subquery
-- to find the first organization (COL has one org).
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
  -- Rule 1: Open incidents (existing)
  ('clinical.openIncidents', 'warning', 'gt', 0,
   'Open incidents at {facility_name}',
   '{value} open incident(s). Review triage queue.',
   'incidents', '/admin/incidents?facility={facility_id}',
   1.0, 1.0, 'clinical',
   'Open incidents require documentation and may indicate care quality concerns.'),

  -- Rule 2: High AR balance (existing)
  ('financial.totalBalanceDueCents', 'warning', 'gt', 2500000,
   'High AR balance — {facility_name}',
   'Outstanding balance due approximately ${formatted_value}.',
   'billing', '/admin/billing/ar-aging',
   1.0, 1.5, 'financial',
   'AR over $25K impacts cash flow and may indicate collection process issues.'),

  -- Rule 3: Active outbreaks (existing)
  ('infection.activeOutbreaks', 'critical', 'gt', 0,
   'Active infection outbreak — {facility_name}',
   '{value} active outbreak(s) recorded. Immediate containment review required.',
   'infection', '/admin/infection-control',
   2.0, 2.0, 'clinical',
   'Active outbreaks require immediate containment protocols and may trigger regulatory reporting.'),

  -- Rule 4: Low occupancy (NEW)
  ('census.occupancyPct', 'critical', 'lt', 85,
   'Occupancy below 85% — {facility_name}',
   'Current occupancy at {value}%. Cash flow break-even typically requires >88%.',
   'system', '/admin/executive/facility/{facility_id}',
   2.0, 2.0, 'growth',
   'Occupancy below 85% threatens revenue sustainability. Marketing and admissions acceleration needed.'),

  -- Rule 5: Medication errors elevated (NEW)
  ('clinical.medicationErrorsMtd', 'warning', 'gt', 2,
   'Elevated medication errors — {facility_name}',
   '{value} medication error(s) this month. Root cause analysis recommended.',
   'medications', '/admin/medications/errors',
   1.5, 1.5, 'clinical',
   'Multiple medication errors may indicate training gaps or workflow issues requiring intervention.'),

  -- Rule 6: Survey deficiencies open (NEW)
  ('compliance.openSurveyDeficiencies', 'warning', 'gt', 0,
   'Open survey deficiencies — {facility_name}',
   '{value} open deficiency(ies). Ensure Plans of Correction are on track.',
   'compliance', '/admin/compliance/deficiencies',
   1.5, 1.0, 'compliance',
   'Unresolved deficiencies risk follow-up surveys and potential sanctions.'),

  -- Rule 7: Certifications expiring (NEW)
  ('workforce.certificationsExpiring30d', 'warning', 'gt', 3,
   'Staff certifications expiring — {facility_name}',
   '{value} certification(s) expiring within 30 days. Schedule renewals.',
   'staff', '/admin/certifications',
   1.0, 1.0, 'workforce',
   'Expired certifications can result in non-compliant staffing ratios.')
) AS r(metric_domain, severity, condition_op, condition_value,
       alert_title_template, alert_body_template, source_module, deep_link_template,
       severity_weight, impact_weight, category, why_it_matters)
WHERE NOT EXISTS (SELECT 1 FROM public.exec_alert_rules WHERE organization_id = o.id)
LIMIT 7;
