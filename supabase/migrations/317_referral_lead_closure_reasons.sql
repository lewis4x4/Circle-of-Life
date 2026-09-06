-- COL referral outcomes: schema only. Jessica's approved vocabulary is a separate seed.
BEGIN;

CREATE TABLE public.referral_closure_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  code text NOT NULL CHECK (btrim(code) <> ''),
  label text NOT NULL CHECK (btrim(label) <> ''),
  closed_by_party text NOT NULL CHECK (closed_by_party IN ('prospect', 'facility')),
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz,
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id, closed_by_party)
);

ALTER TABLE public.referral_closure_reasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Referral operators see closure reasons in their organization"
  ON public.referral_closure_reasons FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT haven.organization_id())
    AND deleted_at IS NULL
    AND (SELECT haven.app_role()) IN ('owner', 'org_admin', 'facility_admin', 'nurse')
  );

CREATE POLICY "Organization administrators create closure reasons"
  ON public.referral_closure_reasons FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = (SELECT haven.organization_id())
    AND (SELECT haven.app_role()) IN ('owner', 'org_admin')
  );

CREATE POLICY "Organization administrators update closure reasons"
  ON public.referral_closure_reasons FOR UPDATE TO authenticated
  USING (
    organization_id = (SELECT haven.organization_id())
    AND deleted_at IS NULL
    AND (SELECT haven.app_role()) IN ('owner', 'org_admin')
  )
  WITH CHECK (
    organization_id = (SELECT haven.organization_id())
    AND (SELECT haven.app_role()) IN ('owner', 'org_admin')
  );

REVOKE ALL ON public.referral_closure_reasons FROM anon;
REVOKE DELETE, TRUNCATE ON public.referral_closure_reasons FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.referral_closure_reasons TO authenticated;
GRANT ALL ON public.referral_closure_reasons TO service_role;

CREATE TRIGGER tr_referral_closure_reasons_set_updated_at
  BEFORE UPDATE ON public.referral_closure_reasons
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();

CREATE TRIGGER tr_referral_closure_reasons_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.referral_closure_reasons
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

ALTER TABLE public.referral_leads
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN closed_by_party text CHECK (closed_by_party IN ('prospect', 'facility')),
  ADD COLUMN closure_reason_id uuid,
  ADD COLUMN closure_note text,
  ADD COLUMN competitor_chosen text,
  ADD CONSTRAINT referral_leads_closure_reason_scope_fkey
    FOREIGN KEY (organization_id, closure_reason_id, closed_by_party)
    REFERENCES public.referral_closure_reasons(organization_id, id, closed_by_party),
  ADD CONSTRAINT referral_leads_closure_complete_check CHECK (
    (closed_at IS NULL AND closed_by_party IS NULL AND closure_reason_id IS NULL
      AND closure_note IS NULL AND competitor_chosen IS NULL)
    OR
    (status = 'lost' AND closed_at IS NOT NULL AND closed_by_party IS NOT NULL
      AND closure_reason_id IS NOT NULL
      AND (competitor_chosen IS NULL OR closed_by_party = 'prospect'))
  );

CREATE INDEX idx_referral_leads_closure
  ON public.referral_leads (organization_id, closed_by_party, closure_reason_id)
  WHERE status = 'lost' AND deleted_at IS NULL;

-- Full FK index also supports integrity checks on historical / soft-deleted leads.
CREATE INDEX idx_referral_leads_closure_reason_id
  ON public.referral_leads (closure_reason_id)
  WHERE closure_reason_id IS NOT NULL;

COMMENT ON TABLE public.referral_closure_reasons IS
  'Organization-owned referral outcome vocabulary. Seed only from approved operator input; no inferred reasons.';
COMMENT ON COLUMN public.referral_leads.closed_by_party IS
  'prospect declined COL or facility declined the prospect; must match the reason catalog party.';
COMMENT ON CONSTRAINT referral_leads_closure_complete_check ON public.referral_leads IS
  'Legacy lost leads may remain unclassified. New closure metadata is all-or-none; clear it explicitly when reopening a lead.';

COMMIT;
