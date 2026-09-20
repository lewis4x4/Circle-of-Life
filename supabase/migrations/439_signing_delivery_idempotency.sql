-- COL-294 / SYS-006: durable BoldSign send attempts and atomic webhooks.
-- Provider I/O is never inferred away. Every generation freezes the exact
-- provider-affecting payload under contract/signer locks, and every verified
-- webhook is deduplicated with its canonical JSON content in one transaction.

BEGIN;

ALTER TABLE public.resident_contracts
  ADD COLUMN IF NOT EXISTS provider_status_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_environment text;
ALTER TABLE public.resident_contracts
  DROP CONSTRAINT IF EXISTS resident_contracts_provider_environment_check;
ALTER TABLE public.resident_contracts
  ADD CONSTRAINT resident_contracts_provider_environment_check
  CHECK (provider_environment IS NULL OR provider_environment ~ '^[a-z0-9][a-z0-9._-]{0,99}$');
ALTER TABLE public.resident_contract_signers
  ADD COLUMN IF NOT EXISTS provider_status_created_at timestamptz;

CREATE OR REPLACE FUNCTION haven.guard_boldsign_contract_projection_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF current_user NOT IN ('postgres','service_role') AND (
    NEW.provider='boldsign' OR (TG_OP='UPDATE' AND OLD.provider='boldsign')
  ) THEN
    IF TG_OP='INSERT' THEN
      IF NEW.provider_document_id IS NOT NULL
         OR NEW.status NOT IN ('draft','ready_to_send')
         OR NEW.sent_at IS NOT NULL OR NEW.completed_at IS NOT NULL
         OR NEW.declined_at IS NOT NULL OR NEW.voided_at IS NOT NULL
         OR NEW.provider_status_created_at IS NOT NULL
         OR NEW.provider_environment IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='boldsign_projection_fields_are_service_only';
      END IF;
    ELSIF NEW.provider IS DISTINCT FROM OLD.provider
       OR NEW.provider_document_id IS DISTINCT FROM OLD.provider_document_id
       OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
       OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
       OR NEW.declined_at IS DISTINCT FROM OLD.declined_at
       OR NEW.voided_at IS DISTINCT FROM OLD.voided_at
       OR NEW.provider_status_created_at IS DISTINCT FROM OLD.provider_status_created_at
       OR NEW.provider_environment IS DISTINCT FROM OLD.provider_environment
       OR (
         NEW.status IS DISTINCT FROM OLD.status AND (
           OLD.provider_document_id IS NOT NULL
           OR OLD.status NOT IN ('draft','ready_to_send')
           OR NEW.status NOT IN ('draft','ready_to_send')
         )
       ) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='boldsign_projection_fields_are_service_only';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION haven.guard_boldsign_signer_projection_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE old_provider text; new_provider text;
BEGIN
  SELECT provider INTO new_provider FROM public.resident_contracts WHERE id=NEW.contract_id;
  IF TG_OP='UPDATE' THEN
    SELECT provider INTO old_provider FROM public.resident_contracts WHERE id=OLD.contract_id;
  END IF;
  IF current_user NOT IN ('postgres','service_role') AND (
    new_provider='boldsign' OR old_provider='boldsign'
  ) THEN
    IF TG_OP='INSERT' THEN
      IF NEW.provider_recipient_id IS NOT NULL OR NEW.status<>'pending'
         OR NEW.sent_at IS NOT NULL OR NEW.viewed_at IS NOT NULL
         OR NEW.signed_at IS NOT NULL OR NEW.declined_at IS NOT NULL
         OR NEW.provider_status_created_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='boldsign_projection_fields_are_service_only';
      END IF;
    ELSIF NEW.contract_id IS DISTINCT FROM OLD.contract_id
       OR NEW.provider_recipient_id IS DISTINCT FROM OLD.provider_recipient_id
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
       OR NEW.viewed_at IS DISTINCT FROM OLD.viewed_at
       OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
       OR NEW.declined_at IS DISTINCT FROM OLD.declined_at
       OR NEW.provider_status_created_at IS DISTINCT FROM OLD.provider_status_created_at THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='boldsign_projection_fields_are_service_only';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_boldsign_contract_projection_fields()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION haven.guard_boldsign_signer_projection_fields()
  FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS resident_contracts_boldsign_projection_guard ON public.resident_contracts;
CREATE TRIGGER resident_contracts_boldsign_projection_guard
BEFORE INSERT OR UPDATE ON public.resident_contracts FOR EACH ROW
EXECUTE FUNCTION haven.guard_boldsign_contract_projection_fields();
DROP TRIGGER IF EXISTS resident_contract_signers_boldsign_projection_guard ON public.resident_contract_signers;
CREATE TRIGGER resident_contract_signers_boldsign_projection_guard
BEFORE INSERT OR UPDATE ON public.resident_contract_signers FOR EACH ROW
EXECUTE FUNCTION haven.guard_boldsign_signer_projection_fields();
ALTER TABLE public.resident_contract_events
  ADD COLUMN IF NOT EXISTS provider_event_sha256 text,
  ADD COLUMN IF NOT EXISTS provider_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_label text,
  ADD COLUMN IF NOT EXISTS provider_recipient_id text,
  ADD COLUMN IF NOT EXISTS provider_environment text;
UPDATE public.resident_contract_events
SET provider_environment=lower(coalesce(
  nullif(raw_payload->'event'->>'environment',''),
  nullif(raw_payload->'Event'->>'environment',''),
  'live'
))
WHERE provider_environment IS NULL;
ALTER TABLE public.resident_contract_events
  ALTER COLUMN provider_environment SET DEFAULT 'live',
  ALTER COLUMN provider_environment SET NOT NULL;

ALTER TABLE public.resident_contract_events
  DROP CONSTRAINT IF EXISTS resident_contract_events_provider_event_sha256_check;
ALTER TABLE public.resident_contract_events
  ADD CONSTRAINT resident_contract_events_provider_event_sha256_check
  CHECK (provider_event_sha256 IS NULL OR provider_event_sha256 ~ '^[0-9a-f]{64}$');

UPDATE public.resident_contract_events
SET provider_event_sha256 = encode(sha256(convert_to(raw_payload::text, 'UTF8')), 'hex')
WHERE provider_event_id IS NOT NULL AND provider_event_sha256 IS NULL;

DROP INDEX IF EXISTS public.idx_resident_contract_events_provider_event_unique;
CREATE UNIQUE INDEX idx_resident_contract_events_provider_event_unique
  ON public.resident_contract_events(provider, provider_environment, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION haven.reject_resident_contract_event_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='resident_contract_events_are_immutable';
END $$;

CREATE TABLE IF NOT EXISTS public.resident_contract_send_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.resident_contracts(id) ON DELETE RESTRICT,
  generation integer NOT NULL CHECK (generation > 0),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  resident_id uuid NOT NULL REFERENCES public.residents(id),
  actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
  request_id uuid NOT NULL UNIQUE,
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  signer_binding_sha256 text NOT NULL CHECK (signer_binding_sha256 ~ '^[0-9a-f]{64}$'),
  template_id text NOT NULL CHECK (btrim(template_id) <> ''),
  disable_emails boolean NOT NULL,
  provider_environment text NOT NULL CHECK (provider_environment ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  provider_payload jsonb NOT NULL CHECK (jsonb_typeof(provider_payload)='object'),
  link_signers jsonb NOT NULL CHECK (jsonb_typeof(link_signers)='array'),
  recovery_label text NOT NULL UNIQUE CHECK (recovery_label ~ '^haven-[0-9a-f]{32}$'),
  state text NOT NULL CHECK (state IN (
    'prepared','provider_outcome_unknown','rejected_definitively',
    'reconciliation_required','committed'
  )),
  provider_document_id text,
  provider_response jsonb,
  last_failure_code text,
  prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  provider_io_started_at timestamptz,
  outcome_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(contract_id,generation),
  CHECK ((state IN ('committed','reconciliation_required')) = (provider_document_id IS NOT NULL)),
  CHECK (state <> 'provider_outcome_unknown' OR provider_io_started_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS resident_contract_send_claims_one_active
  ON public.resident_contract_send_claims(contract_id)
  WHERE state IN ('prepared','provider_outcome_unknown','committed');
CREATE INDEX IF NOT EXISTS resident_contract_send_claims_scope
  ON public.resident_contract_send_claims(organization_id,facility_id,state);
CREATE INDEX IF NOT EXISTS resident_contract_send_claims_provider_document
  ON public.resident_contract_send_claims(provider_environment,provider_document_id)
  WHERE provider_document_id IS NOT NULL;
ALTER TABLE public.resident_contract_send_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.resident_contract_send_claims
  FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE public.resident_contract_send_claims IS
  'Private immutable-generation send ownership. A definitive rejection ends one generation; a new request creates a new snapshot/token. Unknown, committed, or reconciliation-required outcomes prevent another send.';
COMMENT ON COLUMN public.resident_contract_send_claims.link_signers IS
  'Locked local signer snapshot [{id,email}] used for link retrieval and exact committed replay; not part of the provider payload.';

CREATE OR REPLACE FUNCTION haven.boldsign_send_snapshot(
  p_contract_id uuid,p_template_id text,p_disable_emails boolean,
  p_recovery_label text,p_provider_environment text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  c public.resident_contracts%ROWTYPE;
  roles jsonb; links jsonb; bindings jsonb; payload jsonb; signer_count integer;
BEGIN
  SELECT * INTO c FROM public.resident_contracts WHERE id=p_contract_id AND deleted_at IS NULL;
  IF NOT FOUND OR c.provider<>'boldsign' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='contract_provider_not_boldsign';
  END IF;
  IF EXISTS (SELECT 1 FROM public.resident_contract_signers
    WHERE contract_id=p_contract_id AND deleted_at IS NULL
      AND (signer_email IS NULL OR btrim(signer_email)='')) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='signer_email_required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.resident_contract_signers
    WHERE contract_id=p_contract_id AND deleted_at IS NULL
    GROUP BY lower(btrim(signer_email)) HAVING count(*)>1) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ambiguous_duplicate_signer_email';
  END IF;
  SELECT count(*),
    jsonb_agg(jsonb_build_object('roleIndex',rn,'signerName',signer_name,
      'signerEmail',signer_email,'signerOrder',routing_order,'signerType','Signer',
      'signerRole',signer_role,'locale','EN') ORDER BY rn),
    jsonb_agg(jsonb_build_object('id',id,'email',signer_email) ORDER BY rn),
    jsonb_agg(jsonb_build_object('id',id,'email',lower(btrim(signer_email)),
      'providerRecipientId',provider_recipient_id,'routingOrder',routing_order,
      'name',signer_name,'role',signer_role) ORDER BY rn)
  INTO signer_count,roles,links,bindings FROM (
    SELECT id,signer_name,signer_email,signer_role,routing_order,provider_recipient_id,
      row_number() OVER(ORDER BY routing_order,id)::integer rn
    FROM public.resident_contract_signers
    WHERE contract_id=p_contract_id AND deleted_at IS NULL) s;
  IF signer_count=0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='signer_required'; END IF;
  payload:=jsonb_build_object('title',c.title,
    'message','Please review and sign this Circle of Life resident agreement.',
    'roles',roles,'enableSigningOrder',signer_count>1,'disableEmails',p_disable_emails,
    'labels',jsonb_build_array(p_recovery_label));
  RETURN jsonb_build_object('provider_payload',payload,'link_signers',links,
    'request_sha256',encode(sha256(convert_to(jsonb_build_object('environment',p_provider_environment,
      'templateId',p_template_id,'payload',payload)::text,'UTF8')),'hex'),
    'signer_binding_sha256',encode(sha256(convert_to(bindings::text,'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION haven.boldsign_send_snapshot(uuid,text,boolean,text,text)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.apply_boldsign_webhook_event(
  p_provider_environment text,
  p_provider_event_id text,
  p_event_type text,
  p_provider_document_id text,
  p_provider_created_at timestamptz,
  p_raw_payload jsonb,
  p_recovery_label text DEFAULT NULL,
  p_provider_recipient_id text DEFAULT NULL,
  p_signer_email text DEFAULT NULL,
  p_signer_name text DEFAULT NULL,
  p_signature_verified boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  prior record;
  c public.resident_contracts%ROWTYPE;
  a record;
  s public.resident_contract_signers%ROWTYPE;
  snap jsonb;
  event_hash text;
  contract_status text;
  signer_status text;
  current_rank integer;
  incoming_rank integer;
  signer_current_rank integer;
  signer_incoming_rank integer;
  signer_count integer;
  signer_id uuid;
  can_project boolean:=false;
  projected boolean:=false;
  force_reconcile boolean:=false;
BEGIN
  IF p_signature_verified IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='webhook_signature_not_verified';
  END IF;
  IF p_provider_environment IS NULL OR p_provider_environment !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
     OR p_provider_event_id IS NULL OR btrim(p_provider_event_id)='' OR length(p_provider_event_id)>500
     OR p_event_type IS NULL OR btrim(p_event_type)='' OR length(p_event_type)>200
     OR (p_provider_document_id IS NOT NULL AND
       (btrim(p_provider_document_id)='' OR length(p_provider_document_id)>500))
     OR p_provider_created_at IS NULL OR p_raw_payload IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_boldsign_webhook_event';
  END IF;
  IF p_recovery_label IS NOT NULL AND p_recovery_label !~ '^haven-[0-9a-f]{32}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_boldsign_recovery_label';
  END IF;
  event_hash:=encode(sha256(convert_to(p_raw_payload::text,'UTF8')),'hex');
  -- Concurrent deliveries of one provider event serialize before the first
  -- dedupe read, so the waiter observes the committed receipt and returns the
  -- exact duplicate/conflict result without projecting twice.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'boldsign:'||p_provider_environment||':'||p_provider_event_id,0));
  SELECT id,provider_event_sha256,raw_payload,event_status,contract_id,provider_document_id
  INTO prior
  FROM public.resident_contract_events
  WHERE provider='boldsign' AND provider_environment=p_provider_environment
    AND provider_event_id=p_provider_event_id
  FOR UPDATE;
  IF FOUND THEN
    IF coalesce(prior.provider_event_sha256,
      encode(sha256(convert_to(prior.raw_payload::text,'UTF8')),'hex'))<>event_hash THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='provider_event_content_conflict';
    END IF;
    RETURN jsonb_build_object('action','duplicate','state',coalesce(prior.event_status,'recorded'),
      'matched_contract',prior.contract_id IS NOT NULL,'provider_document_id',prior.provider_document_id,
      'event_sha256',event_hash);
  END IF;

  contract_status:=CASE lower(p_event_type)
    WHEN 'sent' THEN 'sent' WHEN 'viewed' THEN 'viewed'
    WHEN 'signed' THEN 'partially_signed' WHEN 'completed' THEN 'completed'
    WHEN 'declined' THEN 'declined' WHEN 'revoked' THEN 'voided'
    WHEN 'expired' THEN 'expired' ELSE NULL END;

  IF p_recovery_label IS NULL AND p_provider_document_id IS NOT NULL THEN
    SELECT * INTO c FROM public.resident_contracts
    WHERE provider='boldsign' AND provider_document_id=p_provider_document_id
      AND (provider_environment=p_provider_environment OR provider_environment IS NULL)
      AND deleted_at IS NULL
    FOR UPDATE;
    IF FOUND THEN
      IF c.provider_environment IS NULL THEN
        UPDATE public.resident_contracts
        SET provider_environment=p_provider_environment
        WHERE id=c.id AND provider_environment IS NULL
        RETURNING * INTO c;
      END IF;
      can_project:=c.provider_environment=p_provider_environment;
    END IF;
  END IF;

  IF p_recovery_label IS NOT NULL THEN
    -- Discover the claim without locking, then follow the same lock order used
    -- by prepare/commit: contract, signers, claim. This avoids a webhook/send
    -- response deadlock while the locked re-read below preserves correctness.
    SELECT * INTO a FROM public.resident_contract_send_claims
    WHERE provider_environment=p_provider_environment AND recovery_label=p_recovery_label;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='recovery_label_unknown';
    END IF;
    SELECT * INTO c FROM public.resident_contracts
    WHERE id=a.contract_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='contract_not_found'; END IF;
    PERFORM id FROM public.resident_contract_signers
    WHERE contract_id=a.contract_id AND deleted_at IS NULL
    ORDER BY routing_order,id FOR UPDATE;
    SELECT * INTO a FROM public.resident_contract_send_claims
    WHERE id=a.id FOR UPDATE;
    IF c.organization_id<>a.organization_id OR c.facility_id<>a.facility_id
       OR c.resident_id<>a.resident_id THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='contract_scope_mismatch';
    END IF;

    IF p_provider_document_id IS NULL THEN
      IF lower(p_event_type) IN ('sendfailed','deliveryfailed','templatesendfailed')
         AND a.state IN ('prepared','provider_outcome_unknown') THEN
        UPDATE public.resident_contract_send_claims
        SET state='rejected_definitively',last_failure_code=lower(p_event_type),
          outcome_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE id=a.id RETURNING * INTO a;
      END IF;
      can_project:=false;
    ELSE
      IF a.provider_document_id IS NOT NULL AND a.provider_document_id<>p_provider_document_id THEN
        RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='provider_document_conflict';
      END IF;
      IF EXISTS(
        SELECT 1 FROM public.resident_contracts
        WHERE provider='boldsign' AND provider_document_id=p_provider_document_id
          AND id<>a.contract_id AND deleted_at IS NULL
      ) THEN
        RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='recovery_label_contract_conflict';
      END IF;
      IF contract_status IS NULL THEN
        can_project:=false;
      ELSE
        snap:=haven.boldsign_send_snapshot(a.contract_id,a.template_id,a.disable_emails,
          a.recovery_label,a.provider_environment);
        force_reconcile:=a.state='reconciliation_required'
          OR snap->>'request_sha256'<>a.request_sha256
          OR snap->>'signer_binding_sha256'<>a.signer_binding_sha256
          OR (c.provider_document_id IS NOT NULL AND c.provider_document_id<>p_provider_document_id)
          OR EXISTS(
            SELECT 1 FROM public.resident_contract_send_claims x
            WHERE x.contract_id=a.contract_id AND x.id<>a.id
              AND x.state IN ('prepared','provider_outcome_unknown','committed'));
        IF force_reconcile THEN
          UPDATE public.resident_contract_send_claims
          SET state='reconciliation_required',provider_document_id=p_provider_document_id,
            outcome_at=clock_timestamp(),updated_at=clock_timestamp()
          WHERE id=a.id RETURNING * INTO a;
          can_project:=false;
        ELSIF a.state='committed' THEN
          can_project:=c.provider_document_id=p_provider_document_id
            AND c.provider_environment=a.provider_environment;
        ELSE
          UPDATE public.resident_contracts
          SET provider_template_id=coalesce(provider_template_id,a.template_id),
            provider_document_id=p_provider_document_id,
            provider_environment=a.provider_environment,
            sent_at=coalesce(sent_at,p_provider_created_at),
            metadata=metadata||jsonb_build_object('send_request_id',a.request_id,
              'send_recovery_label',a.recovery_label,'send_generation',a.generation,
              'disable_emails',a.disable_emails)
          WHERE id=a.contract_id RETURNING * INTO c;
          UPDATE public.resident_contract_signers
          SET status='sent',sent_at=coalesce(sent_at,p_provider_created_at)
          WHERE contract_id=a.contract_id AND deleted_at IS NULL AND status='pending';
          UPDATE public.resident_contract_send_claims
          SET state='committed',provider_document_id=p_provider_document_id,
            last_failure_code=NULL,outcome_at=clock_timestamp(),updated_at=clock_timestamp()
          WHERE id=a.id RETURNING * INTO a;
          can_project:=true;
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.resident_contract_events(
    organization_id,facility_id,contract_id,resident_id,provider,provider_environment,
    provider_document_id,provider_event_id,provider_event_sha256,event_type,event_status,
    signer_email,signer_name,provider_recipient_id,signature_verified,provider_created_at,
    raw_payload,metadata,recovery_label
  ) VALUES (
    c.organization_id,c.facility_id,c.id,c.resident_id,'boldsign',p_provider_environment,
    p_provider_document_id,p_provider_event_id,event_hash,p_event_type,contract_status,
    p_signer_email,p_signer_name,p_provider_recipient_id,true,p_provider_created_at,
    p_raw_payload,jsonb_build_object('projection_version',1,
      'reconciliation_required',force_reconcile),p_recovery_label
  );

  IF c.id IS NOT NULL AND can_project AND contract_status IS NOT NULL THEN
    current_rank:=CASE c.status WHEN 'draft' THEN 0 WHEN 'ready_to_send' THEN 1
      WHEN 'sent' THEN 2 WHEN 'viewed' THEN 3 WHEN 'partially_signed' THEN 4
      WHEN 'completed' THEN 5 WHEN 'declined' THEN 5 WHEN 'voided' THEN 5 WHEN 'expired' THEN 5 ELSE -1 END;
    incoming_rank:=CASE contract_status WHEN 'sent' THEN 2 WHEN 'viewed' THEN 3
      WHEN 'partially_signed' THEN 4 WHEN 'completed' THEN 5 WHEN 'declined' THEN 5
      WHEN 'voided' THEN 5 WHEN 'expired' THEN 5 ELSE -1 END;
    -- Terminal projections never change. Newer events may repeat or advance;
    -- equal-time events may only advance to a strictly higher rank. Older,
    -- equal-rank, or competing terminal events remain history-only.
    IF c.status NOT IN ('completed','declined','voided','expired') AND (
      (c.provider_status_created_at IS NULL AND incoming_rank>=current_rank)
      OR (p_provider_created_at>c.provider_status_created_at AND incoming_rank>=current_rank)
      OR (p_provider_created_at=c.provider_status_created_at AND incoming_rank>current_rank)
    ) THEN
      UPDATE public.resident_contracts SET status=contract_status,
        sent_at=CASE WHEN incoming_rank>=2
          THEN least(coalesce(sent_at,p_provider_created_at),p_provider_created_at)
          ELSE sent_at END,
        completed_at=CASE WHEN contract_status='completed' THEN coalesce(completed_at,p_provider_created_at) ELSE completed_at END,
        declined_at=CASE WHEN contract_status='declined' THEN coalesce(declined_at,p_provider_created_at) ELSE declined_at END,
        voided_at=CASE WHEN contract_status='voided' THEN coalesce(voided_at,p_provider_created_at) ELSE voided_at END,
        provider_status_created_at=p_provider_created_at
      WHERE id=c.id;
      projected:=true;
    END IF;
  END IF;

  signer_status:=CASE lower(p_event_type) WHEN 'viewed' THEN 'viewed'
    WHEN 'signed' THEN 'signed' WHEN 'declined' THEN 'declined'
    WHEN 'revoked' THEN 'voided' WHEN 'expired' THEN 'expired' ELSE NULL END;
  IF c.id IS NOT NULL AND can_project AND signer_status IS NOT NULL THEN
    IF p_provider_recipient_id IS NOT NULL AND btrim(p_provider_recipient_id)<>'' THEN
      SELECT * INTO s FROM public.resident_contract_signers
      WHERE contract_id=c.id AND provider_recipient_id=p_provider_recipient_id AND deleted_at IS NULL
      FOR UPDATE;
    END IF;
    IF s.id IS NULL AND p_signer_email IS NOT NULL AND btrim(p_signer_email)<>'' THEN
      SELECT count(*),(array_agg(id ORDER BY id))[1] INTO signer_count,signer_id
      FROM public.resident_contract_signers
      WHERE contract_id=c.id AND lower(btrim(signer_email))=lower(btrim(p_signer_email))
        AND deleted_at IS NULL;
      IF signer_count=1 THEN
        SELECT * INTO s FROM public.resident_contract_signers WHERE id=signer_id FOR UPDATE;
        IF p_provider_recipient_id IS NOT NULL AND btrim(p_provider_recipient_id)<>'' THEN
          IF s.provider_recipient_id IS NOT NULL AND s.provider_recipient_id<>p_provider_recipient_id THEN
            RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='provider_recipient_conflict';
          END IF;
          UPDATE public.resident_contract_signers SET provider_recipient_id=p_provider_recipient_id
          WHERE id=s.id RETURNING * INTO s;
        END IF;
      END IF;
    END IF;
    IF s.id IS NOT NULL THEN
      signer_current_rank:=CASE s.status WHEN 'pending' THEN 0 WHEN 'sent' THEN 1
        WHEN 'viewed' THEN 2 WHEN 'signed' THEN 3 WHEN 'declined' THEN 3
        WHEN 'voided' THEN 3 WHEN 'expired' THEN 3 ELSE -1 END;
      signer_incoming_rank:=CASE signer_status WHEN 'viewed' THEN 2 WHEN 'signed' THEN 3
        WHEN 'declined' THEN 3 WHEN 'voided' THEN 3 WHEN 'expired' THEN 3 ELSE -1 END;
      IF s.status NOT IN ('signed','declined','voided','expired') AND (
        (s.provider_status_created_at IS NULL AND signer_incoming_rank>=signer_current_rank)
        OR (p_provider_created_at>s.provider_status_created_at AND signer_incoming_rank>=signer_current_rank)
        OR (p_provider_created_at=s.provider_status_created_at AND signer_incoming_rank>signer_current_rank)
      ) THEN
        UPDATE public.resident_contract_signers SET status=signer_status,
          sent_at=least(coalesce(sent_at,p_provider_created_at),p_provider_created_at),
          viewed_at=CASE WHEN signer_status='viewed' THEN coalesce(viewed_at,p_provider_created_at) ELSE viewed_at END,
          signed_at=CASE WHEN signer_status='signed' THEN coalesce(signed_at,p_provider_created_at) ELSE signed_at END,
          declined_at=CASE WHEN signer_status='declined' THEN coalesce(declined_at,p_provider_created_at) ELSE declined_at END,
          provider_status_created_at=p_provider_created_at
        WHERE id=s.id;
        projected:=true;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('action',CASE WHEN force_reconcile THEN 'reconcile'
      WHEN projected THEN 'applied' ELSE 'recorded' END,
    'state',coalesce(contract_status,'recorded'),'matched_contract',c.id IS NOT NULL,
    'provider_document_id',p_provider_document_id,'event_sha256',event_hash);
END $$;

CREATE OR REPLACE FUNCTION public.commit_boldsign_contract_send(
  p_contract_id uuid,
  p_request_id uuid,
  p_request_sha256 text,
  p_generation integer,
  p_provider_document_id text,
  p_provider_response jsonb,
  p_provider_sent_at timestamptz DEFAULT clock_timestamp()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  a record;
  c public.resident_contracts%ROWTYPE;
  snap jsonb;
  claims jsonb;
  reconcile boolean:=false;
BEGIN
  IF p_contract_id IS NULL OR p_request_id IS NULL OR p_generation IS NULL OR p_generation<1
     OR p_request_sha256 IS NULL OR p_request_sha256 !~ '^[0-9a-f]{64}$'
     OR p_provider_document_id IS NULL OR btrim(p_provider_document_id)=''
     OR p_provider_sent_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_signing_send_commit';
  END IF;
  SELECT * INTO c FROM public.resident_contracts
  WHERE id=p_contract_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='contract_not_found'; END IF;
  PERFORM id FROM public.resident_contract_signers
  WHERE contract_id=p_contract_id AND deleted_at IS NULL
  ORDER BY routing_order,id FOR UPDATE;
  SELECT * INTO a FROM public.resident_contract_send_claims
  WHERE contract_id=p_contract_id AND request_id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='send_claim_not_found'; END IF;
  IF a.request_sha256<>p_request_sha256 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='idempotency_key_reused';
  END IF;
  IF a.generation<>p_generation THEN
    RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='stale_send_generation';
  END IF;
  IF a.state IN ('committed','reconciliation_required') THEN
    IF a.provider_document_id<>p_provider_document_id THEN
      RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='provider_document_conflict';
    END IF;
    RETURN jsonb_build_object(
      'action',CASE WHEN a.state='committed' THEN 'replay' ELSE 'reconcile' END,
      'state',a.state,'generation',a.generation,'request_sha256',a.request_sha256,
      'provider_document_id',a.provider_document_id,'recovery_label',a.recovery_label,
      'provider_payload',a.provider_payload,'link_signers',a.link_signers
    );
  END IF;

  snap:=haven.boldsign_send_snapshot(p_contract_id,a.template_id,a.disable_emails,
    a.recovery_label,a.provider_environment);
  reconcile:=snap->>'request_sha256'<>a.request_sha256
    OR snap->>'signer_binding_sha256'<>a.signer_binding_sha256
    OR (c.provider_document_id IS NOT NULL AND c.provider_document_id<>p_provider_document_id)
    OR EXISTS(
      SELECT 1 FROM public.resident_contracts
      WHERE provider='boldsign' AND provider_document_id=p_provider_document_id
        AND id<>p_contract_id AND deleted_at IS NULL
    )
    OR EXISTS(
      SELECT 1 FROM public.resident_contract_send_claims x
      WHERE x.contract_id=p_contract_id AND x.id<>a.id
        AND x.state IN ('prepared','provider_outcome_unknown','committed')
    );

  IF reconcile THEN
    UPDATE public.resident_contract_send_claims
    SET state='reconciliation_required',provider_document_id=p_provider_document_id,
      provider_response=coalesce(p_provider_response,'{}'),outcome_at=clock_timestamp(),
      updated_at=clock_timestamp()
    WHERE id=a.id RETURNING * INTO a;
    INSERT INTO public.resident_contract_events(
      organization_id,facility_id,contract_id,resident_id,provider,provider_environment,
      provider_document_id,event_type,event_status,raw_payload,metadata,recovery_label
    ) VALUES (
      a.organization_id,a.facility_id,a.contract_id,a.resident_id,'boldsign',a.provider_environment,
      p_provider_document_id,'SendReconciliationRequired','reconciliation_required',
      coalesce(p_provider_response,'{}'),jsonb_build_object(
        'request_id',a.request_id,'request_sha256',a.request_sha256,'generation',a.generation,
        'current_request_sha256',snap->>'request_sha256',
        'current_signer_binding_sha256',snap->>'signer_binding_sha256'),a.recovery_label
    );
    RETURN jsonb_build_object(
      'action','reconcile','state',a.state,'generation',a.generation,
      'request_sha256',a.request_sha256,'provider_document_id',a.provider_document_id,
      'recovery_label',a.recovery_label,'provider_payload',a.provider_payload,'link_signers',a.link_signers
    );
  END IF;

  claims:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  claims:=jsonb_set(claims,'{role}',to_jsonb('service_role'::text),true);
  claims:=jsonb_set(claims,'{sub}',to_jsonb(a.actor_id::text),true);
  PERFORM set_config('request.jwt.claims',claims::text,true);
  UPDATE public.resident_contracts
  SET provider_template_id=a.template_id,provider_document_id=p_provider_document_id,
    provider_environment=a.provider_environment,
    status=CASE WHEN status IN ('draft','ready_to_send') THEN 'sent' ELSE status END,
    sent_at=coalesce(sent_at,p_provider_sent_at),
    metadata=metadata||jsonb_build_object(
      'boldsign_send_response',coalesce(p_provider_response,'{}'),
      'disable_emails',a.disable_emails,'send_request_id',a.request_id,
      'send_recovery_label',a.recovery_label,'send_generation',a.generation)
  WHERE id=p_contract_id;
  UPDATE public.resident_contract_signers
  SET status='sent',sent_at=coalesce(sent_at,p_provider_sent_at)
  WHERE contract_id=p_contract_id AND deleted_at IS NULL AND status='pending';
  INSERT INTO public.resident_contract_events(
    organization_id,facility_id,contract_id,resident_id,provider,provider_environment,
    provider_document_id,event_type,event_status,raw_payload,metadata,recovery_label
  ) VALUES (
    a.organization_id,a.facility_id,a.contract_id,a.resident_id,'boldsign',a.provider_environment,
    p_provider_document_id,'Sent','sent',coalesce(p_provider_response,'{}'),
    jsonb_build_object('request_id',a.request_id,'request_sha256',a.request_sha256,
      'generation',a.generation,'actor_id',a.actor_id,'template_id',a.template_id,
      'disable_emails',a.disable_emails),a.recovery_label
  );
  UPDATE public.resident_contract_send_claims
  SET state='committed',provider_document_id=p_provider_document_id,
    provider_response=coalesce(p_provider_response,'{}'),last_failure_code=NULL,
    outcome_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE id=a.id RETURNING * INTO a;
  RETURN jsonb_build_object(
    'action','committed','state',a.state,'generation',a.generation,
    'request_sha256',a.request_sha256,'provider_document_id',a.provider_document_id,
    'recovery_label',a.recovery_label,'provider_payload',a.provider_payload,'link_signers',a.link_signers
  );
END $$;

CREATE OR REPLACE FUNCTION public.fail_boldsign_contract_send(
  p_contract_id uuid,
  p_request_id uuid,
  p_request_sha256 text,
  p_generation integer,
  p_definite boolean,
  p_failure_code text,
  p_provider_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  a record;
  next_state text;
BEGIN
  IF p_contract_id IS NULL OR p_request_id IS NULL OR p_generation IS NULL OR p_generation<1
     OR p_request_sha256 IS NULL OR p_request_sha256 !~ '^[0-9a-f]{64}$'
     OR p_definite IS NULL OR p_failure_code IS NULL OR btrim(p_failure_code)=''
     OR length(p_failure_code)>200 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_signing_send_failure';
  END IF;
  SELECT * INTO a FROM public.resident_contract_send_claims
  WHERE contract_id=p_contract_id AND request_id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='send_claim_not_found'; END IF;
  IF a.request_sha256<>p_request_sha256 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='idempotency_key_reused';
  END IF;
  IF a.generation<>p_generation THEN
    RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='stale_send_generation';
  END IF;
  IF a.state IN ('committed','reconciliation_required') THEN
    RETURN jsonb_build_object('action',CASE WHEN a.state='committed' THEN 'replay' ELSE 'reconcile' END,
      'state',a.state,'generation',a.generation,'request_sha256',a.request_sha256,
      'provider_document_id',a.provider_document_id);
  END IF;
  next_state:=CASE WHEN p_definite THEN 'rejected_definitively' ELSE 'provider_outcome_unknown' END;
  IF a.state=next_state AND a.last_failure_code=p_failure_code THEN
    RETURN jsonb_build_object('action','replay','state',a.state,'generation',a.generation,
      'request_sha256',a.request_sha256,'provider_document_id',a.provider_document_id);
  END IF;
  IF a.state='rejected_definitively' AND NOT p_definite THEN
    RETURN jsonb_build_object('action','replay','state',a.state,'generation',a.generation,
      'request_sha256',a.request_sha256,'provider_document_id',NULL);
  END IF;
  UPDATE public.resident_contract_send_claims
  SET state=next_state,last_failure_code=p_failure_code,
    provider_response=coalesce(p_provider_payload,'{}'),outcome_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE id=a.id RETURNING * INTO a;
  INSERT INTO public.resident_contract_events(
    organization_id,facility_id,contract_id,resident_id,provider,provider_environment,
    event_type,event_status,raw_payload,metadata,recovery_label
  ) VALUES (
    a.organization_id,a.facility_id,a.contract_id,a.resident_id,'boldsign',a.provider_environment,
    CASE WHEN p_definite THEN 'SendFailed' ELSE 'SendUncertain' END,a.state,
    coalesce(p_provider_payload,'{}'),jsonb_build_object(
      'request_id',a.request_id,'request_sha256',a.request_sha256,'generation',a.generation,
      'failure_code',p_failure_code,'definite',p_definite,'actor_id',a.actor_id),a.recovery_label
  );
  RETURN jsonb_build_object('action','failed','state',a.state,'generation',a.generation,
    'request_sha256',a.request_sha256,'provider_document_id',NULL);
END $$;
REVOKE ALL ON FUNCTION haven.reject_resident_contract_event_mutation()
  FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS resident_contract_events_immutable ON public.resident_contract_events;
CREATE TRIGGER resident_contract_events_immutable
BEFORE UPDATE OR DELETE ON public.resident_contract_events
FOR EACH ROW EXECUTE FUNCTION haven.reject_resident_contract_event_mutation();

CREATE OR REPLACE FUNCTION public.prepare_boldsign_contract_send(
  p_contract_id uuid,
  p_request_id uuid,
  p_actor_id uuid,
  p_organization_id uuid,
  p_facility_id uuid,
  p_template_id text,
  p_disable_emails boolean,
  p_provider_environment text DEFAULT 'live'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  c public.resident_contracts%ROWTYPE;
  a public.resident_contract_send_claims%ROWTYPE;
  active public.resident_contract_send_claims%ROWTYPE;
  snap jsonb;
  recovery text;
  next_generation integer;
BEGIN
  IF p_contract_id IS NULL OR p_request_id IS NULL OR p_actor_id IS NULL
     OR p_organization_id IS NULL OR p_facility_id IS NULL
     OR p_template_id IS NULL OR btrim(p_template_id)=''
     OR p_disable_emails IS NULL OR p_provider_environment IS NULL
     OR p_provider_environment !~ '^[a-z0-9][a-z0-9._-]{0,99}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_signing_send_request';
  END IF;
  SELECT * INTO c FROM public.resident_contracts
  WHERE id=p_contract_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='contract_not_found'; END IF;
  IF c.organization_id<>p_organization_id OR c.facility_id<>p_facility_id THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='contract_scope_mismatch';
  END IF;
  IF c.provider<>'boldsign' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='contract_provider_not_boldsign';
  END IF;
  PERFORM id FROM public.resident_contract_signers
  WHERE contract_id=p_contract_id AND deleted_at IS NULL
  ORDER BY routing_order,id FOR UPDATE;

  SELECT * INTO a FROM public.resident_contract_send_claims
  WHERE request_id=p_request_id FOR UPDATE;
  IF FOUND THEN
    IF a.contract_id<>p_contract_id
       OR a.organization_id<>p_organization_id OR a.facility_id<>p_facility_id
       OR a.template_id<>p_template_id OR a.disable_emails<>p_disable_emails
       OR a.provider_environment<>p_provider_environment THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='idempotency_key_reused';
    END IF;
    snap:=haven.boldsign_send_snapshot(p_contract_id,p_template_id,p_disable_emails,
      a.recovery_label,p_provider_environment);
    IF snap->>'request_sha256'<>a.request_sha256
       OR snap->>'signer_binding_sha256'<>a.signer_binding_sha256 THEN
      RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='send_snapshot_changed';
    END IF;
    RETURN jsonb_build_object(
      'action',CASE a.state
        WHEN 'committed' THEN 'replay'
        WHEN 'rejected_definitively' THEN 'rejected'
        ELSE 'reconcile' END,
      'state',a.state,'generation',a.generation,
      'request_sha256',a.request_sha256,'recovery_label',a.recovery_label,
      'provider_payload',a.provider_payload,'link_signers',a.link_signers,
      'provider_document_id',a.provider_document_id
    );
  END IF;

  SELECT * INTO active FROM public.resident_contract_send_claims
  WHERE contract_id=p_contract_id
    AND state IN ('prepared','provider_outcome_unknown','committed','reconciliation_required')
  ORDER BY generation DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='contract_send_already_claimed';
  END IF;
  IF c.status NOT IN ('draft','ready_to_send') OR c.provider_document_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0409',MESSAGE='contract_not_sendable';
  END IF;

  recovery:='haven-'||replace(gen_random_uuid()::text,'-','');
  snap:=haven.boldsign_send_snapshot(p_contract_id,p_template_id,p_disable_emails,
    recovery,p_provider_environment);
  SELECT coalesce(max(generation),0)+1 INTO next_generation
  FROM public.resident_contract_send_claims WHERE contract_id=p_contract_id;

  INSERT INTO public.resident_contract_send_claims(
    contract_id,generation,organization_id,facility_id,resident_id,actor_id,
    request_id,request_sha256,signer_binding_sha256,template_id,disable_emails,
    provider_environment,provider_payload,link_signers,recovery_label,state
  ) VALUES (
    c.id,next_generation,c.organization_id,c.facility_id,c.resident_id,p_actor_id,
    p_request_id,snap->>'request_sha256',snap->>'signer_binding_sha256',p_template_id,p_disable_emails,
    p_provider_environment,snap->'provider_payload',snap->'link_signers',recovery,'prepared'
  ) RETURNING * INTO a;

  INSERT INTO public.resident_contract_events(
    organization_id,facility_id,contract_id,resident_id,provider,provider_environment,
    event_type,event_status,raw_payload,metadata,recovery_label
  ) VALUES (
    a.organization_id,a.facility_id,a.contract_id,a.resident_id,'boldsign',a.provider_environment,
    'SendPrepared','prepared','{}',jsonb_build_object(
      'request_id',a.request_id,'request_sha256',a.request_sha256,
      'generation',a.generation,'actor_id',a.actor_id),a.recovery_label
  );

  -- This is conservative by design: before the RPC returns action=send, the
  -- durable state already says a provider outcome may be unknown. A crash
  -- between this return and HTTP dispatch therefore reconciles instead of
  -- creating a second provider document.
  UPDATE public.resident_contract_send_claims
  SET state='provider_outcome_unknown',provider_io_started_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE id=a.id RETURNING * INTO a;

  RETURN jsonb_build_object(
    'action','send','state',a.state,'generation',a.generation,
    'request_sha256',a.request_sha256,'recovery_label',a.recovery_label,
    'provider_payload',a.provider_payload,'link_signers',a.link_signers,
    'provider_document_id',NULL
  );
END $$;

REVOKE ALL ON FUNCTION public.prepare_boldsign_contract_send(uuid,uuid,uuid,uuid,uuid,text,boolean,text)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.commit_boldsign_contract_send(uuid,uuid,text,integer,text,jsonb,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fail_boldsign_contract_send(uuid,uuid,text,integer,boolean,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.apply_boldsign_webhook_event(text,text,text,text,timestamptz,jsonb,text,text,text,text,boolean)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_boldsign_contract_send(uuid,uuid,uuid,uuid,uuid,text,boolean,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_boldsign_contract_send(uuid,uuid,text,integer,text,jsonb,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_boldsign_contract_send(uuid,uuid,text,integer,boolean,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_boldsign_webhook_event(text,text,text,text,timestamptz,jsonb,text,text,text,text,boolean) TO service_role;

COMMENT ON FUNCTION public.prepare_boldsign_contract_send(uuid,uuid,uuid,uuid,uuid,text,boolean,text) IS
  'Service-only locked send snapshot. Only action=send permits one provider call; persisted state is already provider_outcome_unknown before return.';
COMMENT ON FUNCTION public.commit_boldsign_contract_send(uuid,uuid,text,integer,text,jsonb,timestamptz) IS
  'Service-only atomic success commit. A changed contract/signer fingerprint stores the provider outcome as reconciliation_required without projecting ordinary state.';
COMMENT ON FUNCTION public.fail_boldsign_contract_send(uuid,uuid,text,integer,boolean,text,jsonb) IS
  'Service-only failure receipt. Definitive rejection ends an immutable generation; the next send requires a new request and fresh snapshot/token.';
COMMENT ON FUNCTION public.apply_boldsign_webhook_event(text,text,text,text,timestamptz,jsonb,text,text,text,text,boolean) IS
  'Service-only canonical JSON dedupe by provider environment/event identity, recovery-label binding, and monotonic provider-time projection.';

NOTIFY pgrst,'reload schema';
COMMIT;
