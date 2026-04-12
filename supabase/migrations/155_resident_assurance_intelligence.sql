-- Migration 155: Resident Assurance Intelligence Layer
-- Adds safety scoring and AI insights tables for Module 25 Phase B.

-- ── Risk tier enum ──
DO $$ BEGIN
  CREATE TYPE public.resident_risk_tier AS ENUM ('low', 'moderate', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Insight type enum ──
DO $$ BEGIN
  CREATE TYPE public.resident_insight_type AS ENUM (
    'pattern_detected', 'risk_escalation', 'intervention_needed',
    'decline_observed', 'positive_trend'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Insight status enum ──
DO $$ BEGIN
  CREATE TYPE public.resident_insight_status AS ENUM ('new', 'acknowledged', 'acted_on', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════
-- ── RESIDENT SAFETY SCORES ──
-- Composite 0-100 score per resident computed daily by Edge Function.
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.resident_safety_scores (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id),
  entity_id        uuid REFERENCES public.entities(id),
  facility_id      uuid NOT NULL REFERENCES public.facilities(id),
  resident_id      uuid NOT NULL REFERENCES public.residents(id),

  -- Score
  score            integer NOT NULL CHECK (score >= 0 AND score <= 100),
  risk_tier        public.resident_risk_tier NOT NULL,

  -- Component breakdown (jsonb for flexibility)
  component_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Example: { "observation_compliance": 85, "exception_severity": 92,
  --            "incident_recency": 60, "assessment_risk": 78, "medication_adherence": 95 }

  -- Delta tracking
  previous_score   integer,
  score_delta      integer,

  -- Computation metadata
  computed_at      timestamptz NOT NULL DEFAULT now(),
  computed_by      text NOT NULL DEFAULT 'edge:resident-safety-scorer',

  -- Standard audit
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_safety_scores_resident_latest
  ON public.resident_safety_scores (resident_id, computed_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_safety_scores_facility_tier
  ON public.resident_safety_scores (facility_id, risk_tier, computed_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_safety_scores_org
  ON public.resident_safety_scores (organization_id, computed_at DESC)
  WHERE deleted_at IS NULL;

-- ══════════════════════════════════════════════════════════
-- ── RESIDENT SAFETY INSIGHTS ──
-- AI-generated clinical findings stored per resident.
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.resident_safety_insights (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id),
  entity_id        uuid REFERENCES public.entities(id),
  facility_id      uuid NOT NULL REFERENCES public.facilities(id),
  resident_id      uuid NOT NULL REFERENCES public.residents(id),

  -- Insight content
  insight_type     public.resident_insight_type NOT NULL,
  severity         public.resident_observation_severity NOT NULL DEFAULT 'medium',
  title            text NOT NULL,
  body             text,
  clinical_domains text[] NOT NULL DEFAULT '{}',
  -- e.g. {'fall_risk', 'medication', 'behavioral', 'cognitive'}

  -- AI provenance
  source_data_json jsonb,
  ai_model         text,
  ai_invocation_id uuid REFERENCES public.ai_invocations(id),

  -- Action tracking
  status           public.resident_insight_status NOT NULL DEFAULT 'new',
  acknowledged_by  uuid REFERENCES auth.users(id),
  acknowledged_at  timestamptz,
  acted_on_at      timestamptz,
  dismissed_reason text,

  -- Standard audit
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES auth.users(id),
  deleted_at       timestamptz
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_safety_insights_facility_status
  ON public.resident_safety_insights (facility_id, status, severity)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_safety_insights_resident
  ON public.resident_safety_insights (resident_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- ══════════════════════════════════════════════════════════
-- ── RLS ──
-- ══════════════════════════════════════════════════════════

ALTER TABLE public.resident_safety_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resident_safety_insights ENABLE ROW LEVEL SECURITY;

-- Safety scores: read by org members with facility access
CREATE POLICY "Org members read safety scores"
  ON public.resident_safety_scores FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

-- Safety scores: insert by service role (Edge Function) or managers
CREATE POLICY "Managers insert safety scores"
  ON public.resident_safety_scores FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin')
  );

-- Insights: read by org members with facility access
CREATE POLICY "Org members read safety insights"
  ON public.resident_safety_insights FOR SELECT
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );

-- Insights: insert by managers
CREATE POLICY "Managers insert safety insights"
  ON public.resident_safety_insights FOR INSERT
  WITH CHECK (
    organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

-- Insights: update (acknowledge, act, dismiss) by managers
CREATE POLICY "Managers update safety insights"
  ON public.resident_safety_insights FOR UPDATE
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

-- ══════════════════════════════════════════════════════════
-- ── AUDIT TRIGGERS ──
-- ══════════════════════════════════════════════════════════

CREATE TRIGGER set_updated_at_safety_scores
  BEFORE UPDATE ON public.resident_safety_scores
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();

CREATE TRIGGER capture_audit_safety_scores
  AFTER INSERT OR UPDATE OR DELETE ON public.resident_safety_scores
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

CREATE TRIGGER set_updated_at_safety_insights
  BEFORE UPDATE ON public.resident_safety_insights
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();

CREATE TRIGGER capture_audit_safety_insights
  AFTER INSERT OR UPDATE OR DELETE ON public.resident_safety_insights
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
