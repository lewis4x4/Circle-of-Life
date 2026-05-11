-- COL v2 Slice 6: resident contract and e-signature provenance schema.
-- This intentionally does not reuse vendor contracts and does not send BoldSign envelopes yet; send/webhook logic is Slice 7.

CREATE TABLE IF NOT EXISTS public.resident_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  resident_id uuid NOT NULL REFERENCES public.residents(id),
  admission_case_id uuid REFERENCES public.admission_cases(id),
  resident_document_id uuid REFERENCES public.resident_documents(id),
  contract_type text NOT NULL CHECK (contract_type IN (
    'admission_agreement',
    'financial_agreement',
    'arbitration_agreement',
    'resident_rights_acknowledgment',
    'hipaa_privacy_consent',
    'service_plan_acknowledgment',
    'medicaid_assignment',
    'photo_release',
    'other'
  )),
  title text NOT NULL,
  provider text NOT NULL DEFAULT 'boldsign' CHECK (provider IN ('boldsign', 'docusign', 'manual')),
  provider_template_id text,
  provider_document_id text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',
    'ready_to_send',
    'sent',
    'viewed',
    'partially_signed',
    'completed',
    'declined',
    'voided',
    'expired'
  )),
  source_type text NOT NULL DEFAULT 'template' CHECK (source_type IN ('template', 'uploaded_pdf', 'manual_scan')),
  effective_date date,
  expiration_date date,
  sent_at timestamptz,
  completed_at timestamptz,
  voided_at timestamptz,
  declined_at timestamptz,
  signed_pdf_storage_path text,
  audit_trail_storage_path text,
  source_pdf_storage_path text,
  legal_basis_citation text NOT NULL DEFAULT 'FL Stat. § 668.50',
  counsel_approval_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.user_profiles(id) DEFAULT auth.uid(),
  updated_by uuid REFERENCES public.user_profiles(id),
  deleted_at timestamptz,
  CHECK (expiration_date IS NULL OR effective_date IS NULL OR expiration_date >= effective_date),
  CHECK (completed_at IS NULL OR sent_at IS NULL OR completed_at >= sent_at),
  CHECK (voided_at IS NULL OR status = 'voided'),
  CHECK (declined_at IS NULL OR status = 'declined')
);

CREATE INDEX IF NOT EXISTS idx_resident_contracts_resident
  ON public.resident_contracts(resident_id, contract_type, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_resident_contracts_facility_status
  ON public.resident_contracts(facility_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_resident_contracts_provider_document_unique
  ON public.resident_contracts(provider, provider_document_id)
  WHERE deleted_at IS NULL AND provider_document_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_resident_contracts_active_unique
  ON public.resident_contracts(resident_id, COALESCE(admission_case_id, '00000000-0000-0000-0000-000000000000'::uuid), contract_type)
  WHERE deleted_at IS NULL AND status NOT IN ('voided', 'declined', 'expired');

CREATE TABLE IF NOT EXISTS public.resident_contract_signers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  contract_id uuid NOT NULL REFERENCES public.resident_contracts(id) ON DELETE CASCADE,
  resident_id uuid NOT NULL REFERENCES public.residents(id),
  signer_role text NOT NULL CHECK (signer_role IN ('resident', 'responsible_party', 'poa', 'guardian', 'facility_representative', 'witness', 'other')),
  signer_name text NOT NULL,
  signer_email text,
  signer_phone text,
  relationship_to_resident text,
  provider_recipient_id text,
  routing_order integer NOT NULL DEFAULT 1 CHECK (routing_order > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'viewed', 'signed', 'declined', 'voided', 'expired')),
  sent_at timestamptz,
  viewed_at timestamptz,
  signed_at timestamptz,
  declined_at timestamptz,
  signer_ip inet,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.user_profiles(id) DEFAULT auth.uid(),
  updated_by uuid REFERENCES public.user_profiles(id),
  deleted_at timestamptz,
  CHECK (signed_at IS NULL OR status = 'signed'),
  CHECK (declined_at IS NULL OR status = 'declined')
);

CREATE INDEX IF NOT EXISTS idx_resident_contract_signers_contract
  ON public.resident_contract_signers(contract_id, routing_order)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_resident_contract_signers_resident
  ON public.resident_contract_signers(resident_id, signer_role)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_resident_contract_signers_provider_unique
  ON public.resident_contract_signers(contract_id, provider_recipient_id)
  WHERE deleted_at IS NULL AND provider_recipient_id IS NOT NULL;

ALTER TABLE public.resident_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resident_contract_signers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS resident_contracts_select ON public.resident_contracts;
CREATE POLICY resident_contracts_select ON public.resident_contracts
  FOR SELECT TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() NOT IN ('dietary', 'maintenance_role')
  );

DROP POLICY IF EXISTS resident_contracts_insert ON public.resident_contracts;
CREATE POLICY resident_contracts_insert ON public.resident_contracts
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'nurse')
  );

DROP POLICY IF EXISTS resident_contracts_update ON public.resident_contracts;
CREATE POLICY resident_contracts_update ON public.resident_contracts
  FOR UPDATE TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'nurse')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'nurse')
  );

DROP POLICY IF EXISTS resident_contract_signers_select ON public.resident_contract_signers;
CREATE POLICY resident_contract_signers_select ON public.resident_contract_signers
  FOR SELECT TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() NOT IN ('dietary', 'maintenance_role')
  );

DROP POLICY IF EXISTS resident_contract_signers_insert ON public.resident_contract_signers;
CREATE POLICY resident_contract_signers_insert ON public.resident_contract_signers
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'nurse')
    AND EXISTS (
      SELECT 1
      FROM public.resident_contracts rc
      WHERE rc.id = resident_contract_signers.contract_id
        AND rc.organization_id = resident_contract_signers.organization_id
        AND rc.facility_id = resident_contract_signers.facility_id
        AND rc.resident_id = resident_contract_signers.resident_id
        AND rc.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS resident_contract_signers_update ON public.resident_contract_signers;
CREATE POLICY resident_contract_signers_update ON public.resident_contract_signers
  FOR UPDATE TO authenticated
  USING (
    organization_id = haven.organization_id()
    AND deleted_at IS NULL
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'nurse')
  )
  WITH CHECK (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner', 'org_admin', 'facility_admin', 'manager', 'nurse')
  );

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['resident_contracts','resident_contract_signers'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%s_set_updated_at ON public.%I', v_table, v_table);
    EXECUTE format('CREATE TRIGGER tr_%s_set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at()', v_table, v_table);
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%s_audit ON public.%I', v_table, v_table);
    EXECUTE format('CREATE TRIGGER tr_%s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log()', v_table, v_table);
  END LOOP;
END $$;

INSERT INTO public.role_permissions (app_role, feature, permission_level, description)
VALUES
  ('owner', 'resident_contracts', 'admin', 'Full resident contract and e-signature administration'),
  ('org_admin', 'resident_contracts', 'admin', 'Org-level resident contract administration'),
  ('facility_admin', 'resident_contracts', 'edit', 'Facility resident contract management'),
  ('manager', 'resident_contracts', 'edit', 'Facility manager resident contract management'),
  ('nurse', 'resident_contracts', 'view', 'View resident contract completion status'),
  ('caregiver', 'resident_contracts', 'view', 'View resident contract completion status')
ON CONFLICT (app_role, feature, permission_level) DO UPDATE SET
  description = EXCLUDED.description,
  updated_at = now();

COMMENT ON TABLE public.resident_contracts IS 'Resident legal/e-signature contract lifecycle and storage provenance. Separate from vendor contracts and resident_documents.';
COMMENT ON TABLE public.resident_contract_signers IS 'Signer roster and signer-level status/provenance for resident contracts.';
