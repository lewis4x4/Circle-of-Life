-- COL v2 Slice 7 support: provider webhook/send event capture for resident contracts.
-- Edge Functions own the external BoldSign calls; this table stores immutable provider event provenance.

CREATE TABLE IF NOT EXISTS public.resident_contract_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id),
  facility_id uuid REFERENCES public.facilities(id),
  contract_id uuid REFERENCES public.resident_contracts(id) ON DELETE SET NULL,
  resident_id uuid REFERENCES public.residents(id),
  provider text NOT NULL DEFAULT 'boldsign' CHECK (provider IN ('boldsign', 'docusign', 'manual')),
  provider_document_id text,
  provider_event_id text,
  event_type text NOT NULL,
  event_status text,
  signer_email text,
  signer_name text,
  signature_verified boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_resident_contract_events_contract
  ON public.resident_contract_events(contract_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_resident_contract_events_provider_doc
  ON public.resident_contract_events(provider, provider_document_id, received_at DESC)
  WHERE provider_document_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_resident_contract_events_provider_event_unique
  ON public.resident_contract_events(provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

ALTER TABLE public.resident_contract_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS resident_contract_events_select ON public.resident_contract_events;
CREATE POLICY resident_contract_events_select ON public.resident_contract_events
  FOR SELECT TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'nurse')
  );

-- Inserts are performed by Edge Functions with the service role after webhook signature verification.
DROP POLICY IF EXISTS resident_contract_events_insert_blocked ON public.resident_contract_events;
CREATE POLICY resident_contract_events_insert_blocked ON public.resident_contract_events
  FOR INSERT TO authenticated
  WITH CHECK (false);

INSERT INTO public.role_permissions (app_role, feature, permission_level, description)
VALUES
  ('owner', 'resident_contract_events', 'admin', 'Full resident contract event visibility'),
  ('org_admin', 'resident_contract_events', 'admin', 'Org-level resident contract event visibility'),
  ('facility_admin', 'resident_contract_events', 'view', 'Facility resident contract event visibility'),
  ('manager', 'resident_contract_events', 'view', 'Facility manager resident contract event visibility'),
  ('nurse', 'resident_contract_events', 'view', 'Clinical resident contract event visibility')
ON CONFLICT (app_role, feature, permission_level) DO UPDATE SET
  description = EXCLUDED.description,
  updated_at = now();

COMMENT ON TABLE public.resident_contract_events IS 'Immutable provider event ledger for resident contract e-signature send/webhook events.';
