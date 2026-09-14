-- Move the Weekly Stand Up transport off an operator workstation.
-- The hidden worker state contains no provider secrets; Edge Function secrets
-- and Vault remain the only credential stores.
BEGIN;

CREATE TABLE haven.stand_up_connector_actors (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  actor_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (display_name = 'Hosted Stand Up connector'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE haven.stand_up_connector_config (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  facility_map jsonb NOT NULL CHECK (jsonb_typeof(facility_map)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE haven.stand_up_publisher_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  dataset text NOT NULL CHECK (dataset = 'haven_weekly_standup'),
  enabled boolean NOT NULL DEFAULT false,
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  sequence bigint NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  last_fingerprint text CHECK (last_fingerprint IS NULL OR last_fingerprint ~ '^[0-9a-f]{64}$'),
  last_admitted_at timestamptz,
  pending_body text,
  pending_fingerprint text,
  pending_sequence bigint,
  pending_first_sent_at timestamptz,
  last_receipt_id text,
  last_replayed boolean,
  last_http_status integer,
  rejection jsonb,
  lease_run_id uuid,
  lease_token uuid,
  lease_until timestamptz,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_outcome text,
  last_error_code text,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((pending_body IS NULL) = (pending_fingerprint IS NULL)),
  CHECK ((pending_body IS NULL) = (pending_sequence IS NULL)),
  CHECK ((pending_body IS NULL) = (pending_first_sent_at IS NULL)),
  CHECK (pending_fingerprint IS NULL OR pending_fingerprint ~ '^[0-9a-f]{64}$'),
  CHECK (pending_sequence IS NULL OR pending_sequence > sequence),
  CHECK ((lease_run_id IS NULL) = (lease_token IS NULL)),
  CHECK ((lease_run_id IS NULL) = (lease_until IS NULL))
);

CREATE TABLE haven.stand_up_google_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  workbook_id text,
  enabled boolean NOT NULL DEFAULT false,
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  credential_fingerprint text CHECK (credential_fingerprint IS NULL OR credential_fingerprint ~ '^[0-9a-f]{64}$'),
  connection_state text NOT NULL DEFAULT 'unconfigured',
  last_connected_at timestamptz,
  last_snapshot_sha256 text CHECK (last_snapshot_sha256 IS NULL OR last_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  last_drive_metadata jsonb,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_outcome text,
  last_error_code text,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (workbook_id IS NULL OR (length(workbook_id) BETWEEN 10 AND 256 AND workbook_id !~ '[[:space:]]'))
);

CREATE TABLE haven.stand_up_google_baselines (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  week_start date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  baseline_revision_id uuid REFERENCES public.stand_up_revisions(id),
  file_values jsonb NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id,facility_id,week_start)
);

CREATE TABLE haven.stand_up_google_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  workbook_id text NOT NULL,
  week_start date NOT NULL,
  state text NOT NULL CHECK (state IN ('synchronized','review_required','failed')),
  source_sha256 text,
  drive_metadata jsonb,
  review jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_code text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE haven.stand_up_history_publisher_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  dataset text NOT NULL CHECK (dataset='standup_weekly_history'),
  enabled boolean NOT NULL DEFAULT false,
  generation bigint NOT NULL DEFAULT 1 CHECK (generation>0),
  sequence bigint NOT NULL DEFAULT 0 CHECK (sequence>=0),
  last_source_as_of timestamptz,
  last_receipt_id text,
  last_http_status integer,
  rejection jsonb,
  lease_run_id uuid,
  lease_token uuid,
  lease_until timestamptz,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_outcome text,
  last_error_code text,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures>=0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((lease_run_id IS NULL)=(lease_token IS NULL)),
  CHECK ((lease_run_id IS NULL)=(lease_until IS NULL))
);

CREATE TABLE haven.stand_up_history_fingerprints (
  identity text PRIMARY KEY CHECK (length(identity) BETWEEN 3 AND 128),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  published_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE haven.stand_up_history_pending (
  sequence bigint PRIMARY KEY CHECK (sequence>0),
  identity text NOT NULL UNIQUE CHECK (length(identity) BETWEEN 3 AND 128),
  body text NOT NULL CHECK (length(convert_to(body,'UTF8')) BETWEEN 2 AND 1048576),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  source_as_of timestamptz NOT NULL,
  first_sent_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE haven.stand_up_connector_actors ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.stand_up_connector_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.stand_up_publisher_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.stand_up_google_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.stand_up_google_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.stand_up_google_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.stand_up_history_publisher_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.stand_up_history_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.stand_up_history_pending ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE haven.stand_up_connector_actors,haven.stand_up_connector_config,
  haven.stand_up_publisher_state,haven.stand_up_google_state,haven.stand_up_google_baselines,
  haven.stand_up_google_runs,haven.stand_up_history_publisher_state,haven.stand_up_history_fingerprints,
  haven.stand_up_history_pending FROM PUBLIC,anon,authenticated,service_role;

INSERT INTO haven.stand_up_connector_actors(organization_id,display_name)
SELECT id,'Hosted Stand Up connector' FROM public.organizations
WHERE id='00000000-0000-0000-0000-000000000001'::uuid
ON CONFLICT (organization_id) DO NOTHING;
INSERT INTO haven.stand_up_connector_config(organization_id,facility_map) VALUES(
  '00000000-0000-0000-0000-000000000001'::uuid,
  '{"Homewood":"00000000-0000-0000-0002-000000000003","Oakridge":"00000000-0000-0000-0002-000000000001","Rising Oaks":"00000000-0000-0000-0002-000000000002","Plantation":"00000000-0000-0000-0002-000000000004","Grande Cypress":"00000000-0000-0000-0002-000000000005"}'::jsonb
);
INSERT INTO haven.stand_up_publisher_state(organization_id,dataset)
SELECT id,'haven_weekly_standup' FROM public.organizations
WHERE id='00000000-0000-0000-0000-000000000001'::uuid;
INSERT INTO haven.stand_up_google_state(organization_id)
SELECT id FROM public.organizations
WHERE id='00000000-0000-0000-0000-000000000001'::uuid;
INSERT INTO haven.stand_up_history_publisher_state(organization_id,dataset)
SELECT id,'standup_weekly_history' FROM public.organizations
WHERE id='00000000-0000-0000-0000-000000000001'::uuid;

CREATE FUNCTION haven.stand_up_worker_generation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.enabled IS DISTINCT FROM OLD.enabled THEN
    NEW.generation:=OLD.generation+1;
    NEW.lease_run_id:=NULL;
    NEW.lease_token:=NULL;
    NEW.lease_until:=NULL;
    NEW.updated_at:=clock_timestamp();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stand_up_publisher_generation_guard BEFORE UPDATE OF enabled ON haven.stand_up_publisher_state
FOR EACH ROW EXECUTE FUNCTION haven.stand_up_worker_generation_guard();
CREATE TRIGGER stand_up_history_generation_guard BEFORE UPDATE OF enabled ON haven.stand_up_history_publisher_state
FOR EACH ROW EXECUTE FUNCTION haven.stand_up_worker_generation_guard();

CREATE FUNCTION haven.stand_up_worker_lease_assert(
  p_run_id uuid,p_lease_token uuid,p_generation bigint,p_enabled boolean,p_stored_generation bigint,
  p_lease_run_id uuid,p_stored_token uuid,p_lease_until timestamptz
) RETURNS void LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
BEGIN
  IF NOT p_enabled OR p_generation IS DISTINCT FROM p_stored_generation
     OR p_run_id IS NULL OR p_lease_token IS NULL OR p_lease_run_id IS DISTINCT FROM p_run_id
     OR p_stored_token IS DISTINCT FROM p_lease_token OR p_lease_until <= clock_timestamp() THEN
    RAISE EXCEPTION 'Stand Up worker lease is not current' USING ERRCODE='55000';
  END IF;
END $$;

CREATE FUNCTION public.stand_up_publisher_acquire(p_run_id uuid,p_lease_seconds integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s haven.stand_up_publisher_state%ROWTYPE; token uuid;
BEGIN
  IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' OR p_run_id IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 120 THEN
    RAISE EXCEPTION 'Stand Up publisher access denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT s FROM haven.stand_up_publisher_state WHERE singleton FOR UPDATE;
  IF NOT s.enabled THEN
    RETURN jsonb_build_object('acquired',false,'reason','disabled','generation',s.generation);
  END IF;
  IF s.lease_until > clock_timestamp() AND s.lease_run_id IS DISTINCT FROM p_run_id THEN
    RETURN jsonb_build_object('acquired',false,'reason','busy','generation',s.generation,'lease_until',s.lease_until);
  END IF;
  token:=CASE WHEN s.lease_run_id=p_run_id AND s.lease_until>clock_timestamp() THEN s.lease_token ELSE gen_random_uuid() END;
  UPDATE haven.stand_up_publisher_state SET lease_run_id=p_run_id,lease_token=token,
    lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),last_started_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE singleton RETURNING * INTO s;
  RETURN jsonb_build_object('acquired',true,'lease_token',token,'lease_until',s.lease_until,'generation',s.generation,
    'sequence',s.sequence,'last_fingerprint',s.last_fingerprint,'last_admitted_at',s.last_admitted_at,
    'facility_map',haven.stand_up_exact_facility_map(s.organization_id),
    'pending',CASE WHEN s.pending_body IS NULL THEN NULL ELSE jsonb_build_object('body',s.pending_body,'fingerprint',s.pending_fingerprint,
      'sequence',s.pending_sequence,'first_sent_at',s.pending_first_sent_at) END);
END $$;

CREATE FUNCTION public.stand_up_publisher_store_pending(
  p_run_id uuid,p_lease_token uuid,p_generation bigint,p_body text,p_fingerprint text,p_sequence bigint,p_first_sent_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s haven.stand_up_publisher_state%ROWTYPE;
BEGIN
  IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Stand Up publisher access denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT s FROM haven.stand_up_publisher_state WHERE singleton FOR UPDATE;
  PERFORM haven.stand_up_worker_lease_assert(p_run_id,p_lease_token,p_generation,s.enabled,s.generation,s.lease_run_id,s.lease_token,s.lease_until);
  IF length(convert_to(p_body,'UTF8')) NOT BETWEEN 2 AND 1048576 OR (p_body::jsonb->>'sequence')::bigint IS DISTINCT FROM p_sequence
     OR jsonb_typeof(p_body::jsonb) IS DISTINCT FROM 'object' OR p_fingerprint !~ '^[0-9a-f]{64}$'
     OR p_sequence IS DISTINCT FROM s.sequence+1 OR p_first_sent_at IS NULL
     THEN
    RAISE EXCEPTION 'Invalid Stand Up publisher pending batch';
  END IF;
  IF s.pending_body IS NOT NULL THEN
    IF s.pending_body IS DISTINCT FROM p_body OR s.pending_fingerprint IS DISTINCT FROM p_fingerprint
       OR s.pending_sequence IS DISTINCT FROM p_sequence OR s.pending_first_sent_at IS DISTINCT FROM p_first_sent_at THEN
      RAISE EXCEPTION 'Stand Up publisher pending batch differs' USING ERRCODE='23505';
    END IF;
  ELSE
    UPDATE haven.stand_up_publisher_state SET pending_body=p_body,pending_fingerprint=p_fingerprint,
      pending_sequence=p_sequence,pending_first_sent_at=p_first_sent_at,updated_at=clock_timestamp() WHERE singleton;
  END IF;
  RETURN jsonb_build_object('stored',true,'sequence',p_sequence);
END $$;

CREATE FUNCTION public.stand_up_publisher_complete(
  p_run_id uuid,p_lease_token uuid,p_generation bigint,p_receipt_id text,p_replayed boolean,p_admitted_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s haven.stand_up_publisher_state%ROWTYPE; completed_sequence bigint;
BEGIN
  IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Stand Up publisher access denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT s FROM haven.stand_up_publisher_state WHERE singleton FOR UPDATE;
  PERFORM haven.stand_up_worker_lease_assert(p_run_id,p_lease_token,p_generation,s.enabled,s.generation,s.lease_run_id,s.lease_token,s.lease_until);
  IF s.pending_body IS NULL OR nullif(btrim(p_receipt_id),'') IS NULL OR p_admitted_at IS NULL THEN
    RAISE EXCEPTION 'Stand Up publisher completion has no admitted pending batch';
  END IF;
  completed_sequence:=s.pending_sequence;
  UPDATE haven.stand_up_publisher_state SET sequence=s.pending_sequence,last_fingerprint=s.pending_fingerprint,
    last_admitted_at=p_admitted_at,last_receipt_id=p_receipt_id,last_replayed=coalesce(p_replayed,false),last_http_status=200,
    rejection=NULL,pending_body=NULL,pending_fingerprint=NULL,pending_sequence=NULL,pending_first_sent_at=NULL,
    last_completed_at=clock_timestamp(),last_outcome='accepted',last_error_code=NULL,consecutive_failures=0,updated_at=clock_timestamp()
  WHERE singleton;
  RETURN jsonb_build_object('completed',true,'sequence',completed_sequence,'receipt_id',p_receipt_id);
END $$;

CREATE FUNCTION public.stand_up_publisher_reject(
  p_run_id uuid,p_lease_token uuid,p_generation bigint,p_http_status integer,p_definite boolean
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s haven.stand_up_publisher_state%ROWTYPE;
BEGIN
  IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' OR p_http_status NOT BETWEEN 400 AND 599 THEN
    RAISE EXCEPTION 'Stand Up publisher access denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT s FROM haven.stand_up_publisher_state WHERE singleton FOR UPDATE;
  PERFORM haven.stand_up_worker_lease_assert(p_run_id,p_lease_token,p_generation,s.enabled,s.generation,s.lease_run_id,s.lease_token,s.lease_until);
  IF s.pending_body IS NULL THEN RAISE EXCEPTION 'Stand Up publisher has no pending batch'; END IF;
  UPDATE haven.stand_up_publisher_state SET last_http_status=p_http_status,
    rejection=jsonb_build_object('http_status',p_http_status,'definite',p_definite,'at',clock_timestamp()),
    pending_body=CASE WHEN p_definite THEN NULL ELSE pending_body END,
    pending_fingerprint=CASE WHEN p_definite THEN NULL ELSE pending_fingerprint END,
    pending_sequence=CASE WHEN p_definite THEN NULL ELSE pending_sequence END,
    pending_first_sent_at=CASE WHEN p_definite THEN NULL ELSE pending_first_sent_at END,
    last_outcome=CASE WHEN p_definite THEN 'rejected' ELSE 'outcome_unknown' END,
    last_error_code='front_office_http_'||p_http_status::text,consecutive_failures=consecutive_failures+1,updated_at=clock_timestamp()
  WHERE singleton;
  RETURN jsonb_build_object('rejected',p_definite,'pending_retained',NOT p_definite,'http_status',p_http_status);
END $$;

CREATE FUNCTION public.stand_up_publisher_release(
  p_run_id uuid,p_lease_token uuid,p_generation bigint,p_outcome text,p_error_code text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s haven.stand_up_publisher_state%ROWTYPE;
BEGIN
  IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' OR p_outcome NOT IN ('accepted','unchanged','rejected','outcome_unknown','failed')
     OR length(coalesce(p_error_code,''))>128 THEN RAISE EXCEPTION 'Stand Up publisher access denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT s FROM haven.stand_up_publisher_state WHERE singleton FOR UPDATE;
  PERFORM haven.stand_up_worker_lease_assert(p_run_id,p_lease_token,p_generation,s.enabled,s.generation,s.lease_run_id,s.lease_token,s.lease_until);
  UPDATE haven.stand_up_publisher_state SET lease_run_id=NULL,lease_token=NULL,lease_until=NULL,last_completed_at=clock_timestamp(),
    last_outcome=CASE WHEN s.last_outcome='accepted' AND s.pending_body IS NULL AND s.last_completed_at>=s.last_started_at THEN 'accepted' ELSE p_outcome END,
    last_error_code=CASE WHEN s.last_outcome='accepted' AND s.pending_body IS NULL AND s.last_completed_at>=s.last_started_at THEN NULL ELSE p_error_code END,
    consecutive_failures=CASE WHEN s.last_outcome='accepted' AND s.pending_body IS NULL AND s.last_completed_at>=s.last_started_at THEN 0
      WHEN p_outcome IN ('accepted','unchanged') THEN 0 WHEN p_outcome='failed' THEN consecutive_failures+1 ELSE consecutive_failures END,
    updated_at=clock_timestamp() WHERE singleton;
  RETURN jsonb_build_object('released',true,'outcome',p_outcome);
END $$;

CREATE FUNCTION public.stand_up_history_publisher_acquire(p_run_id uuid,p_lease_seconds integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s haven.stand_up_history_publisher_state%ROWTYPE; token uuid;
BEGIN
  IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' OR p_run_id IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 120 THEN
    RAISE EXCEPTION 'Stand Up history publisher access denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT s FROM haven.stand_up_history_publisher_state WHERE singleton FOR UPDATE;
  IF NOT s.enabled THEN RETURN jsonb_build_object('acquired',false,'reason','disabled','generation',s.generation); END IF;
  IF s.lease_until>clock_timestamp() AND s.lease_run_id IS DISTINCT FROM p_run_id THEN
    RETURN jsonb_build_object('acquired',false,'reason','busy','generation',s.generation,'lease_until',s.lease_until);
  END IF;
  token:=CASE WHEN s.lease_run_id=p_run_id AND s.lease_until>clock_timestamp() THEN s.lease_token ELSE gen_random_uuid() END;
  UPDATE haven.stand_up_history_publisher_state SET lease_run_id=p_run_id,lease_token=token,
    lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),last_started_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE singleton RETURNING * INTO s;
  RETURN jsonb_build_object('acquired',true,'lease_token',token,'lease_until',s.lease_until,'generation',s.generation,
    'sequence',s.sequence,'last_source_as_of',s.last_source_as_of,'facility_map',haven.stand_up_exact_facility_map(s.organization_id),
    'fingerprints',coalesce((SELECT jsonb_object_agg(identity,jsonb_build_object('fingerprint',fingerprint,'published_at',published_at))
      FROM haven.stand_up_history_fingerprints),'{}'::jsonb),
    'pending',coalesce((SELECT jsonb_agg(jsonb_build_object('identity',identity,'body',body,'fingerprint',fingerprint,
      'sequence',sequence,'source_as_of',source_as_of,'first_sent_at',first_sent_at) ORDER BY sequence)
      FROM haven.stand_up_history_pending),'[]'::jsonb));
END $$;

CREATE FUNCTION public.stand_up_history_publisher_store_queue(
  p_run_id uuid,p_lease_token uuid,p_generation bigint,p_items jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s haven.stand_up_history_publisher_state%ROWTYPE; item jsonb; ordinal bigint; expected bigint;
BEGIN
  IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 156 THEN
    RAISE EXCEPTION 'Stand Up history publisher access denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT s FROM haven.stand_up_history_publisher_state WHERE singleton FOR UPDATE;
  PERFORM haven.stand_up_worker_lease_assert(p_run_id,p_lease_token,p_generation,s.enabled,s.generation,s.lease_run_id,s.lease_token,s.lease_until);
  IF EXISTS(SELECT 1 FROM haven.stand_up_history_pending) THEN RAISE EXCEPTION 'Stand Up history queue is not empty' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) i GROUP BY i->>'identity' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Stand Up history queue has duplicate identities';
  END IF;
  expected:=s.sequence;
  FOR item,ordinal IN SELECT value,ord FROM jsonb_array_elements(p_items) WITH ORDINALITY x(value,ord) ORDER BY ord LOOP
    expected:=expected+1;
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR (item->>'sequence')::bigint IS DISTINCT FROM expected
       OR length(coalesce(item->>'identity','')) NOT BETWEEN 3 AND 128 OR item->>'fingerprint' !~ '^[0-9a-f]{64}$'
       OR length(convert_to(coalesce(item->>'body',''),'UTF8')) NOT BETWEEN 2 AND 1048576
       OR jsonb_typeof((item->>'body')::jsonb) IS DISTINCT FROM 'object'
       OR ((item->>'body')::jsonb->>'sequence')::bigint IS DISTINCT FROM expected
       OR ((item->>'body')::jsonb->>'dataset') IS DISTINCT FROM 'standup_weekly_history'
       OR item->>'source_as_of' IS NULL OR item->>'first_sent_at' IS NULL THEN
      RAISE EXCEPTION 'Invalid Stand Up history queue item';
    END IF;
    INSERT INTO haven.stand_up_history_pending(sequence,identity,body,fingerprint,source_as_of,first_sent_at)
    VALUES(expected,item->>'identity',item->>'body',item->>'fingerprint',(item->>'source_as_of')::timestamptz,(item->>'first_sent_at')::timestamptz);
  END LOOP;
  RETURN jsonb_build_object('stored',true,'count',jsonb_array_length(p_items),'first_sequence',s.sequence+1,'last_sequence',expected);
END $$;

CREATE FUNCTION public.stand_up_history_publisher_complete_head(
  p_run_id uuid,p_lease_token uuid,p_generation bigint,p_identity text,p_sequence bigint,p_fingerprint text,p_receipt_id text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s haven.stand_up_history_publisher_state%ROWTYPE; head haven.stand_up_history_pending%ROWTYPE;
BEGIN
  IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Stand Up history publisher access denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT s FROM haven.stand_up_history_publisher_state WHERE singleton FOR UPDATE;
  PERFORM haven.stand_up_worker_lease_assert(p_run_id,p_lease_token,p_generation,s.enabled,s.generation,s.lease_run_id,s.lease_token,s.lease_until);
  SELECT * INTO head FROM haven.stand_up_history_pending ORDER BY sequence LIMIT 1 FOR UPDATE;
  IF head.sequence IS NULL OR head.sequence IS DISTINCT FROM p_sequence OR head.sequence IS DISTINCT FROM s.sequence+1
     OR head.identity IS DISTINCT FROM p_identity OR head.fingerprint IS DISTINCT FROM p_fingerprint
     OR nullif(btrim(p_receipt_id),'') IS NULL THEN RAISE EXCEPTION 'Stand Up history head differs' USING ERRCODE='23505'; END IF;
  INSERT INTO haven.stand_up_history_fingerprints(identity,fingerprint,published_at)
  VALUES(head.identity,head.fingerprint,head.source_as_of)
  ON CONFLICT(identity) DO UPDATE SET fingerprint=excluded.fingerprint,published_at=excluded.published_at,updated_at=clock_timestamp();
  DELETE FROM haven.stand_up_history_pending WHERE sequence=head.sequence;
  UPDATE haven.stand_up_history_publisher_state SET sequence=head.sequence,last_source_as_of=head.source_as_of,
    last_receipt_id=p_receipt_id,last_http_status=200,rejection=NULL,last_completed_at=clock_timestamp(),last_outcome='accepted',
    last_error_code=NULL,consecutive_failures=0,updated_at=clock_timestamp() WHERE singleton;
  RETURN jsonb_build_object('completed',true,'sequence',head.sequence,'identity',head.identity,'receipt_id',p_receipt_id);
END $$;

CREATE FUNCTION public.stand_up_history_publisher_reject_head(
  p_run_id uuid,p_lease_token uuid,p_generation bigint,p_identity text,p_sequence bigint,p_fingerprint text,p_http_status integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s haven.stand_up_history_publisher_state%ROWTYPE; head haven.stand_up_history_pending%ROWTYPE;
BEGIN
  IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' OR p_http_status NOT BETWEEN 400 AND 599 THEN
    RAISE EXCEPTION 'Stand Up history publisher access denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT s FROM haven.stand_up_history_publisher_state WHERE singleton FOR UPDATE;
  PERFORM haven.stand_up_worker_lease_assert(p_run_id,p_lease_token,p_generation,s.enabled,s.generation,s.lease_run_id,s.lease_token,s.lease_until);
  SELECT * INTO head FROM haven.stand_up_history_pending ORDER BY sequence LIMIT 1 FOR UPDATE;
  IF head.sequence IS NULL OR head.sequence IS DISTINCT FROM p_sequence OR head.identity IS DISTINCT FROM p_identity
     OR head.fingerprint IS DISTINCT FROM p_fingerprint THEN RAISE EXCEPTION 'Stand Up history head differs' USING ERRCODE='23505'; END IF;
  UPDATE haven.stand_up_history_publisher_state SET last_http_status=p_http_status,
    rejection=jsonb_build_object('identity',p_identity,'sequence',p_sequence,'fingerprint',p_fingerprint,'http_status',p_http_status,'at',clock_timestamp()),
    last_outcome='rejected',last_error_code='front_office_http_'||p_http_status::text,
    consecutive_failures=consecutive_failures+1,updated_at=clock_timestamp() WHERE singleton;
  RETURN jsonb_build_object('rejected',true,'pending_retained',true,'http_status',p_http_status);
END $$;

CREATE FUNCTION public.stand_up_history_publisher_release(
  p_run_id uuid,p_lease_token uuid,p_generation bigint,p_outcome text,p_error_code text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s haven.stand_up_history_publisher_state%ROWTYPE;
BEGIN
  IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' OR p_outcome NOT IN ('accepted','unchanged','busy','rejected','outcome_unknown','failed')
     OR length(coalesce(p_error_code,''))>128 THEN RAISE EXCEPTION 'Stand Up history publisher access denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT s FROM haven.stand_up_history_publisher_state WHERE singleton FOR UPDATE;
  PERFORM haven.stand_up_worker_lease_assert(p_run_id,p_lease_token,p_generation,s.enabled,s.generation,s.lease_run_id,s.lease_token,s.lease_until);
  UPDATE haven.stand_up_history_publisher_state SET lease_run_id=NULL,lease_token=NULL,lease_until=NULL,last_completed_at=clock_timestamp(),
    last_outcome=p_outcome,last_error_code=p_error_code,
    consecutive_failures=CASE WHEN p_outcome IN('accepted','unchanged') THEN 0 WHEN p_outcome='failed' THEN consecutive_failures+1 ELSE consecutive_failures END,
    updated_at=clock_timestamp() WHERE singleton;
  RETURN jsonb_build_object('released',true,'outcome',p_outcome);
END $$;

CREATE FUNCTION haven.stand_up_connector_actor(p_organization_id uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT actor_id FROM haven.stand_up_connector_actors WHERE organization_id=p_organization_id
$$;

CREATE FUNCTION haven.stand_up_connector_save(
  p_organization_id uuid,p_facility_id uuid,p_week_start date,p_expected_version integer,p_values jsonb,
  p_source_as_of timestamptz,p_reason text,p_provenance jsonb
) RETURNS public.stand_up_reports LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.stand_up_reports%ROWTYPE; revision uuid; actor uuid;
BEGIN
  IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' OR p_organization_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
     OR p_week_start IS DISTINCT FROM haven.stand_up_week() OR p_expected_version IS NULL
     OR nullif(btrim(p_reason),'') IS NULL OR jsonb_typeof(p_provenance) IS DISTINCT FROM 'object'
     OR p_source_as_of IS NULL OR p_source_as_of>clock_timestamp()+interval '5 minutes'
     OR NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.id=p_facility_id AND f.organization_id=p_organization_id AND f.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Stand Up connector write denied' USING ERRCODE='42501';
  END IF;
  PERFORM haven.stand_up_validate(p_values);
  actor:=haven.stand_up_connector_actor(p_organization_id);
  IF actor IS NULL THEN RAISE EXCEPTION 'Stand Up connector actor is not configured'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('stand_up_org:'||p_organization_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text||p_week_start::text,0));
  SELECT * INTO r FROM public.stand_up_reports WHERE facility_id=p_facility_id AND week_start=p_week_start FOR UPDATE;
  IF coalesce(r.version,0) IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Stale report version' USING ERRCODE='P0409'; END IF;
  IF r.id IS NULL THEN
    INSERT INTO public.stand_up_reports(organization_id,facility_id,week_start,values,status)
    VALUES(p_organization_id,p_facility_id,p_week_start,p_values,'draft') RETURNING * INTO r;
  END IF;
  INSERT INTO public.stand_up_revisions(report_id,version,values,status,actor_id,reason,provenance,source_as_of)
  VALUES(r.id,r.version+1,p_values,'draft',actor,p_reason,p_provenance,p_source_as_of) RETURNING id INTO revision;
  UPDATE public.stand_up_reports SET version=r.version+1,revision_id=revision,values=p_values,status='draft',
    source_as_of=p_source_as_of,updated_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;
  RETURN r;
END $$;

CREATE FUNCTION haven.stand_up_exact_facility_map(p_organization_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  SELECT facility_map INTO result FROM haven.stand_up_connector_config WHERE organization_id=p_organization_id;
  IF (SELECT count(*) FROM jsonb_object_keys(coalesce(result,'{}'::jsonb)))<>5
     OR NOT result ?& ARRAY['Homewood','Oakridge','Rising Oaks','Plantation','Grande Cypress']
     OR (SELECT count(DISTINCT value#>>'{}') FROM jsonb_each(result))<>5
     OR EXISTS(SELECT 1 FROM jsonb_each(result) m WHERE NOT EXISTS(
       SELECT 1 FROM public.facilities f WHERE f.id=(m.value#>>'{}')::uuid AND f.organization_id=p_organization_id AND f.deleted_at IS NULL
     )) THEN RAISE EXCEPTION 'Stand Up five-facility map is incomplete'; END IF;
  RETURN result;
END $$;

CREATE FUNCTION public.stand_up_google_bridge(p_action text,p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s haven.stand_up_google_state%ROWTYPE; org uuid; week date; workbook text; mapping jsonb; run_id uuid;
  observed timestamptz; source_hash text; drive jsonb; records jsonb; locations jsonb; row jsonb; facility uuid;
  incoming jsonb; baseline haven.stand_up_google_baselines%ROWTYPE; report public.stand_up_reports%ROWTYPE;
  saved public.stand_up_reports%ROWTYPE; review jsonb:='[]'::jsonb; next_baselines jsonb:='{}'::jsonb; state text:='synchronized';
  allowed_errors text[]:=ARRAY['google_auth_reconnect_required','google_snapshot_unstable','workbook_mapping_required','bridge_error'];
BEGIN
  IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Stand Up Google bridge access denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT s FROM haven.stand_up_google_state WHERE singleton FOR UPDATE;
  org:=s.organization_id; workbook:=p_payload->>'workbook_id'; week:=(p_payload->>'week_start')::date;
  IF NOT s.enabled THEN RETURN jsonb_build_object('state','disabled','generation',s.generation); END IF;
  IF workbook IS NULL OR workbook IS DISTINCT FROM s.workbook_id OR week IS DISTINCT FROM haven.stand_up_week() THEN
    RAISE EXCEPTION 'Stand Up Google scope denied' USING ERRCODE='42501';
  END IF;
  mapping:=haven.stand_up_exact_facility_map(org);

  IF p_action='load_context' THEN
    RETURN jsonb_build_object('facility_map',mapping,'baselines',coalesce((SELECT jsonb_object_agg(b.facility_id::text||':'||b.week_start::text,
      jsonb_build_object('baseline_id',b.baseline_revision_id,'file_values',b.file_values)) FROM haven.stand_up_google_baselines b
      WHERE b.organization_id=org AND b.week_start=week),'{}'::jsonb),
      'google_connection',jsonb_build_object('state',s.connection_state,'credential_fingerprint',s.credential_fingerprint,'last_connected_at',s.last_connected_at));
  ELSIF p_action='record_failure' THEN
    IF NOT (p_payload->>'error_code'=ANY(allowed_errors)) OR (p_payload->>'observed_at') IS NULL
       OR length(coalesce((p_payload->'detail')::text,''))>4096 THEN RAISE EXCEPTION 'Invalid Stand Up Google failure receipt'; END IF;
    observed:=(p_payload->>'observed_at')::timestamptz;
    INSERT INTO haven.stand_up_google_runs(organization_id,workbook_id,week_start,state,error_code,detail,observed_at)
    VALUES(org,workbook,week,'failed',p_payload->>'error_code',coalesce(p_payload->'detail','{}'::jsonb),observed) RETURNING id INTO run_id;
    UPDATE haven.stand_up_google_state SET connection_state=CASE WHEN p_payload->>'error_code'='google_auth_reconnect_required' THEN 'reconnect_required' ELSE connection_state END,
      credential_fingerprint=coalesce(p_payload->'detail'->>'credential_fingerprint',credential_fingerprint),last_completed_at=clock_timestamp(),
      last_outcome='failed',last_error_code=p_payload->>'error_code',consecutive_failures=consecutive_failures+1,updated_at=clock_timestamp() WHERE singleton;
    RETURN jsonb_build_object('state','failed','run_id',run_id);
  ELSIF p_action<>'apply_snapshot' THEN
    RAISE EXCEPTION 'Unsupported Stand Up Google bridge action';
  END IF;

  source_hash:=p_payload->>'source_sha256'; drive:=p_payload->'drive'; records:=p_payload->'records'; locations:=p_payload->'locations';
  observed:=(p_payload->>'observed_at')::timestamptz;
  IF p_payload->>'schema_version' IS DISTINCT FROM 'standup-2026-v1' OR source_hash !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(drive) IS DISTINCT FROM 'object' OR jsonb_typeof(records) IS DISTINCT FROM 'array'
     OR jsonb_typeof(locations) IS DISTINCT FROM 'object' OR observed IS NULL OR observed>clock_timestamp()+interval '5 minutes'
     OR p_payload->>'credential_fingerprint' !~ '^[0-9a-f]{64}$'
     OR drive->>'etag' !~ '^\"[^\"]+\"$' OR drive->>'version' !~ '^[0-9]+$'
     OR drive->>'md5_checksum' !~ '^[0-9a-f]{32}$' OR (drive->>'file_size')::bigint NOT BETWEEN 1 AND 20971520 THEN
    RAISE EXCEPTION 'Invalid Stand Up Google snapshot';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(records) x WHERE (x->>'facility_id')::uuid NOT IN
    (SELECT (value#>>'{}')::uuid FROM jsonb_each(mapping)) OR x->>'week_start' IS DISTINCT FROM week::text
    OR x->>'schema_version' IS NOT NULL) THEN RAISE EXCEPTION 'Stand Up Google snapshot exceeds configured scope'; END IF;
  IF (SELECT count(DISTINCT x->>'facility_id') FROM jsonb_array_elements(records) x)<>(SELECT count(*) FROM jsonb_array_elements(records))
     OR (SELECT count(*) FROM jsonb_object_keys(locations))<>5
     OR EXISTS(SELECT 1 FROM jsonb_each(mapping) m WHERE NOT locations ? ((m.value#>>'{}')||':'||week::text))
     THEN RAISE EXCEPTION 'Stand Up Google snapshot mapping is incomplete'; END IF;

  UPDATE haven.stand_up_google_state SET last_started_at=clock_timestamp(),updated_at=clock_timestamp() WHERE singleton;
  FOR facility IN SELECT (value#>>'{}')::uuid FROM jsonb_each(mapping) LOOP
    SELECT value INTO row FROM jsonb_array_elements(records) x(value) WHERE (value->>'facility_id')::uuid=facility;
    incoming:=coalesce(row->'values',(SELECT jsonb_object_agg(k,'null'::jsonb) FROM unnest(haven.stand_up_keys()) k));
    SELECT * INTO baseline FROM haven.stand_up_google_baselines b WHERE b.organization_id=org AND b.facility_id=facility AND b.week_start=week FOR UPDATE;
    SELECT * INTO report FROM public.stand_up_reports r WHERE r.organization_id=org AND r.facility_id=facility AND r.week_start=week FOR UPDATE;
    IF baseline.facility_id IS NULL THEN
      IF report.id IS NULL AND NOT EXISTS(SELECT 1 FROM jsonb_each(incoming) i WHERE i.value<>'null'::jsonb) THEN
        saved:=haven.stand_up_connector_save(org,facility,week,0,incoming,observed,
          'Empty weekly fallback initialization',jsonb_build_object('source','edge:stand-up-google-sync','workbook_id',workbook,'source_sha256',source_hash,'drive',drive));
        INSERT INTO haven.stand_up_google_baselines(organization_id,facility_id,week_start,baseline_revision_id,file_values,source_sha256)
        VALUES(org,facility,week,saved.revision_id,incoming,source_hash);
      ELSIF report.id IS NULL OR report.values IS DISTINCT FROM incoming THEN
        state:='review_required';
        review:=review||jsonb_build_array(jsonb_build_object('facility_id',facility,'week_start',week,'code','initial_adoption_required',
          'current_revision_id',report.revision_id));
      ELSE
        -- Equality is a no-write adoption path. It deliberately does not
        -- revalidate immutable legacy evidence such as held HH.MM overtime.
        INSERT INTO haven.stand_up_google_baselines(organization_id,facility_id,week_start,baseline_revision_id,file_values,source_sha256)
        VALUES(org,facility,week,report.revision_id,incoming,source_hash);
      END IF;
    ELSIF incoming IS DISTINCT FROM baseline.file_values THEN
      IF report.id IS NOT NULL AND report.revision_id IS DISTINCT FROM baseline.baseline_revision_id AND report.values IS DISTINCT FROM incoming THEN
        state:='review_required';
        review:=review||jsonb_build_array(jsonb_build_object('facility_id',facility,'week_start',week,'code','concurrent_change','baseline_id',baseline.baseline_revision_id,'current_revision_id',report.revision_id));
      ELSIF EXISTS(SELECT 1 FROM jsonb_each(incoming) i JOIN jsonb_each(baseline.file_values) b USING(key) WHERE i.value='null'::jsonb AND b.value<>'null'::jsonb) THEN
        state:='review_required';
        review:=review||jsonb_build_array(jsonb_build_object('facility_id',facility,'week_start',week,'code','clear_requires_review'));
      ELSE
        PERFORM haven.stand_up_validate(incoming);
        saved:=haven.stand_up_connector_save(org,facility,week,coalesce(report.version,0),incoming,observed,
          'Google workbook synchronization',jsonb_build_object('source','edge:stand-up-google-sync','workbook_id',workbook,'source_sha256',source_hash,'drive',drive,'record',coalesce(row->'provenance','{}'::jsonb)));
        UPDATE haven.stand_up_google_baselines SET baseline_revision_id=saved.revision_id,file_values=incoming,source_sha256=source_hash,updated_at=clock_timestamp()
        WHERE organization_id=org AND facility_id=facility AND week_start=week;
      END IF;
    ELSIF report.id IS NOT NULL AND report.revision_id IS DISTINCT FROM baseline.baseline_revision_id THEN
      state:='review_required';
      review:=review||jsonb_build_array(jsonb_build_object('facility_id',facility,'week_start',week,'code','haven_change_not_exported','baseline_id',baseline.baseline_revision_id,'current_revision_id',report.revision_id));
    END IF;
    SELECT jsonb_set(next_baselines,ARRAY[facility::text||':'||week::text],jsonb_build_object('baseline_id',b.baseline_revision_id,'file_values',b.file_values)) INTO row
    FROM haven.stand_up_google_baselines b WHERE b.organization_id=org AND b.facility_id=facility AND b.week_start=week;
    IF row IS NOT NULL THEN next_baselines:=row; END IF;
  END LOOP;
  INSERT INTO haven.stand_up_google_runs(organization_id,workbook_id,week_start,state,source_sha256,drive_metadata,review,observed_at)
  VALUES(org,workbook,week,state,source_hash,drive,review,observed) RETURNING id INTO run_id;
  UPDATE haven.stand_up_google_state SET credential_fingerprint=p_payload->>'credential_fingerprint',connection_state='connected',last_connected_at=clock_timestamp(),
    last_snapshot_sha256=source_hash,last_drive_metadata=drive,last_completed_at=clock_timestamp(),last_outcome=state,last_error_code=NULL,
    consecutive_failures=0,updated_at=clock_timestamp() WHERE singleton;
  RETURN jsonb_build_object('state',state,'run_id',run_id,'baselines',next_baselines,'review',review);
END $$;

-- Existing UI attribution remains truthful for machine-created revisions.
CREATE OR REPLACE FUNCTION haven.stand_up_revision_metadata(p_revision uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
  'overtime_minutes',v.overtime_minutes,'overtime_issue',v.overtime_issue,
  'entry_origin',CASE WHEN NOT EXISTS(SELECT 1 FROM jsonb_each(v.values) kv WHERE kv.value<>'null'::jsonb) THEN 'initialized'
    WHEN v.batch_id IS NOT NULL THEN 'imported'
    WHEN EXISTS(SELECT 1 FROM public.stand_up_recovery_decisions d WHERE d.result->>'revision_id'=v.id::text) THEN 'recovery'
    ELSE 'manual' END,
  'updated_by',v.actor_id,
  'updated_by_name',coalesce((SELECT p.full_name FROM public.user_profiles p WHERE p.id=v.actor_id AND p.organization_id=r.organization_id),
    (SELECT c.display_name FROM haven.stand_up_connector_actors c WHERE c.actor_id=v.actor_id AND c.organization_id=r.organization_id)),
  'first_submitted_at',(SELECT min(s.created_at) FROM public.stand_up_revisions s WHERE s.report_id=v.report_id AND s.version<=v.version AND s.status='ready'),
  'last_submitted_at',(SELECT s.created_at FROM public.stand_up_revisions s WHERE s.report_id=v.report_id AND s.version<=v.version AND s.status='ready' ORDER BY s.version DESC LIMIT 1),
  'last_submitted_revision_id',(SELECT s.id FROM public.stand_up_revisions s WHERE s.report_id=v.report_id AND s.version<=v.version AND s.status='ready' ORDER BY s.version DESC LIMIT 1),
  'field_dispositions',haven.stand_up_field_dispositions(v.id)
 ) - CASE WHEN EXISTS(SELECT 1 FROM haven.stand_up_connector_actors c WHERE c.actor_id=v.actor_id AND c.organization_id=r.organization_id)
     THEN 'entry_origin' ELSE '__retain_entry_origin__' END
 FROM public.stand_up_revisions v JOIN public.stand_up_reports r ON r.id=v.report_id WHERE v.id=p_revision
$$;

REVOKE ALL ON FUNCTION haven.stand_up_worker_generation_guard(),
  haven.stand_up_worker_lease_assert(uuid,uuid,bigint,boolean,bigint,uuid,uuid,timestamptz),
  haven.stand_up_connector_actor(uuid),haven.stand_up_connector_save(uuid,uuid,date,integer,jsonb,timestamptz,text,jsonb),
  haven.stand_up_exact_facility_map(uuid),public.stand_up_publisher_acquire(uuid,integer),
  public.stand_up_publisher_store_pending(uuid,uuid,bigint,text,text,bigint,timestamptz),
  public.stand_up_publisher_complete(uuid,uuid,bigint,text,boolean,timestamptz),
  public.stand_up_publisher_reject(uuid,uuid,bigint,integer,boolean),public.stand_up_publisher_release(uuid,uuid,bigint,text,text),
  public.stand_up_history_publisher_acquire(uuid,integer),public.stand_up_history_publisher_store_queue(uuid,uuid,bigint,jsonb),
  public.stand_up_history_publisher_complete_head(uuid,uuid,bigint,text,bigint,text,text),
  public.stand_up_history_publisher_reject_head(uuid,uuid,bigint,text,bigint,text,integer),
  public.stand_up_history_publisher_release(uuid,uuid,bigint,text,text),
  public.stand_up_google_bridge(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.stand_up_publisher_acquire(uuid,integer),
  public.stand_up_publisher_store_pending(uuid,uuid,bigint,text,text,bigint,timestamptz),
  public.stand_up_publisher_complete(uuid,uuid,bigint,text,boolean,timestamptz),
  public.stand_up_publisher_reject(uuid,uuid,bigint,integer,boolean),public.stand_up_publisher_release(uuid,uuid,bigint,text,text),
  public.stand_up_history_publisher_acquire(uuid,integer),public.stand_up_history_publisher_store_queue(uuid,uuid,bigint,jsonb),
  public.stand_up_history_publisher_complete_head(uuid,uuid,bigint,text,bigint,text,text),
  public.stand_up_history_publisher_reject_head(uuid,uuid,bigint,text,bigint,text,integer),
  public.stand_up_history_publisher_release(uuid,uuid,bigint,text,text),
  public.stand_up_google_bridge(text,jsonb) TO service_role;

COMMENT ON TABLE haven.stand_up_publisher_state IS 'Private durable state and fenced lease for the hosted Haven to Front Office publisher; contains no secrets.';
COMMENT ON TABLE haven.stand_up_google_state IS 'Private hosted Google connector health/configuration; OAuth credentials remain outside this table.';
COMMENT ON FUNCTION public.stand_up_google_bridge(text,jsonb) IS 'Service-only, fixed-organization current-week import bridge. Machine revisions use a generated connector actor, never a human proxy.';

COMMIT;

-- Rollback: disable both state rows first and wait for leases/in-flight Edge calls.
-- Then drop the public worker RPCs, hidden state/audit tables, connector helpers,
-- and restore the migration 338 stand_up_revision_metadata definition.
