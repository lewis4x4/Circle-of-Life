-- COL-721: a source-owned, roster-only publisher. Disabled until reviewed activation.
-- Native staff/account/payroll behavior and the aggregate Stand Up publisher are unchanged.
BEGIN;

CREATE TABLE haven.workforce_publisher_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  organization_id uuid REFERENCES public.organizations(id),
  enabled boolean NOT NULL DEFAULT false,
  key_id text CHECK (key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  destination_url text NOT NULL DEFAULT 'https://wecsjfiituxlityaacba.supabase.co/functions/v1/workforce-ingest'
    CHECK (destination_url='https://wecsjfiituxlityaacba.supabase.co/functions/v1/workforce-ingest'),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation>0),
  sequence bigint NOT NULL DEFAULT 0 CHECK (sequence BETWEEN 0 AND 9007199254740990),
  pending_body text CHECK (pending_body IS NULL OR octet_length(pending_body) BETWEEN 2 AND 2097152),
  pending_body_sha256 text CHECK (pending_body_sha256 IS NULL OR pending_body_sha256 ~ '^[0-9a-f]{64}$'),
  pending_batch_id uuid,
  pending_sequence bigint,
  pending_source_as_of timestamptz,
  lease_run_id uuid, lease_token uuid, lease_until timestamptz,
  last_started_at timestamptz, last_completed_at timestamptz,
  last_outcome text, last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (NOT enabled OR (organization_id IS NOT NULL AND key_id IS NOT NULL)),
  CHECK ((pending_body IS NULL)=(pending_body_sha256 IS NULL)),
  CHECK ((pending_body IS NULL)=(pending_batch_id IS NULL)),
  CHECK ((pending_body IS NULL)=(pending_sequence IS NULL)),
  CHECK ((pending_body IS NULL)=(pending_source_as_of IS NULL)),
  CHECK (pending_sequence IS NULL OR pending_sequence=sequence+1),
  CHECK ((lease_run_id IS NULL)=(lease_token IS NULL)),
  CHECK ((lease_run_id IS NULL)=(lease_until IS NULL))
);
CREATE TABLE haven.workforce_publisher_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  batch_id uuid NOT NULL UNIQUE,
  sequence bigint NOT NULL UNIQUE,
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  receipt_id uuid NOT NULL,
  source_as_of timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  replayed boolean NOT NULL,
  counts jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE haven.workforce_publisher_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.workforce_publisher_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON haven.workforce_publisher_state,haven.workforce_publisher_receipts FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO haven.workforce_publisher_state(singleton) VALUES(true);

CREATE FUNCTION haven.workforce_time(p_time timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT to_char(p_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
CREATE FUNCTION haven.workforce_generation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.organization_id IS DISTINCT FROM OLD.organization_id AND (OLD.sequence>0 OR OLD.pending_body IS NOT NULL) THEN
  RAISE EXCEPTION 'workforce_scope_immutable' USING ERRCODE='55000';
 END IF;
 IF NEW.enabled IS DISTINCT FROM OLD.enabled OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.key_id IS DISTINCT FROM OLD.key_id OR NEW.destination_url IS DISTINCT FROM OLD.destination_url THEN
  NEW.generation:=OLD.generation+1; NEW.lease_run_id:=NULL; NEW.lease_token:=NULL; NEW.lease_until:=NULL;
 END IF;
 NEW.updated_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER workforce_generation_guard BEFORE UPDATE OF enabled,organization_id,key_id,destination_url
ON haven.workforce_publisher_state FOR EACH ROW EXECUTE FUNCTION haven.workforce_generation_guard();

CREATE FUNCTION haven.workforce_lease(p_run_id uuid,p_lease_token uuid,p_generation bigint)
RETURNS haven.workforce_publisher_state LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s haven.workforce_publisher_state%ROWTYPE;
BEGIN
 IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'workforce_access_denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT s FROM haven.workforce_publisher_state WHERE singleton FOR UPDATE;
 IF NOT s.enabled OR p_generation IS DISTINCT FROM s.generation OR p_run_id IS NULL OR p_lease_token IS NULL
   OR p_run_id IS DISTINCT FROM s.lease_run_id OR p_lease_token IS DISTINCT FROM s.lease_token
   OR s.lease_until IS NULL OR s.lease_until<=clock_timestamp() THEN
  RAISE EXCEPTION 'workforce_lease_expired' USING ERRCODE='55000';
 END IF;
 RETURN s;
END $$;
CREATE FUNCTION haven.workforce_pending(s haven.workforce_publisher_state) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN s.pending_body IS NULL THEN NULL ELSE jsonb_build_object('body',s.pending_body,'body_sha256',s.pending_body_sha256,
   'batch_id',s.pending_batch_id,'sequence',s.pending_sequence,'source_as_of',haven.workforce_time(s.pending_source_as_of)) END
$$;
CREATE FUNCTION public.workforce_publisher_acquire(p_run_id uuid,p_lease_seconds integer DEFAULT 120)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s haven.workforce_publisher_state%ROWTYPE; token uuid;
BEGIN
 IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role' OR p_run_id IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 120 THEN
  RAISE EXCEPTION 'workforce_access_denied' USING ERRCODE='42501';
 END IF;
 SELECT * INTO STRICT s FROM haven.workforce_publisher_state WHERE singleton FOR UPDATE;
 IF s.organization_id IS NULL OR s.key_id IS NULL THEN RETURN jsonb_build_object('acquired',false,'reason','unconfigured'); END IF;
 IF NOT s.enabled THEN RETURN jsonb_build_object('acquired',false,'reason','disabled'); END IF;
 IF s.lease_until>clock_timestamp() AND s.lease_run_id IS DISTINCT FROM p_run_id THEN RETURN jsonb_build_object('acquired',false,'reason','busy'); END IF;
 token:=CASE WHEN s.lease_run_id=p_run_id AND s.lease_until>clock_timestamp() THEN s.lease_token ELSE gen_random_uuid() END;
 UPDATE haven.workforce_publisher_state SET lease_run_id=p_run_id,lease_token=token,lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),
 last_started_at=clock_timestamp(),updated_at=clock_timestamp() WHERE singleton RETURNING * INTO s;
 RETURN jsonb_build_object('acquired',true,'organization_id',s.organization_id,'key_id',s.key_id,'destination_url',s.destination_url,
 'generation',s.generation,'lease_token',token,'sequence',s.sequence,'pending',haven.workforce_pending(s));
END $$;

CREATE FUNCTION public.workforce_publisher_export(p_run_id uuid,p_lease_token uuid,p_generation bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s haven.workforce_publisher_state%ROWTYPE; records jsonb; people_count bigint; units_count bigint; assignments_count bigint; roles_count bigint; observed timestamptz;
BEGIN
 s:=haven.workforce_lease(p_run_id,p_lease_token,p_generation);
 -- Check native tenant references before export; never silently drop a broken link.
 IF EXISTS(SELECT 1 FROM public.facilities f WHERE f.organization_id=s.organization_id AND NOT EXISTS(SELECT 1 FROM public.entities e WHERE e.id=f.entity_id AND e.organization_id=s.organization_id))
 OR EXISTS(SELECT 1 FROM public.staff p WHERE p.organization_id=s.organization_id AND NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.id=p.facility_id AND f.organization_id=s.organization_id))
 OR EXISTS(SELECT 1 FROM public.staff_facility_assignments a WHERE (a.organization_id=s.organization_id OR EXISTS(SELECT 1 FROM public.staff p WHERE p.id=a.staff_id AND p.organization_id=s.organization_id)) AND
   (a.organization_id<>s.organization_id OR NOT EXISTS(SELECT 1 FROM public.staff p WHERE p.id=a.staff_id AND p.organization_id=s.organization_id) OR NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.id=a.facility_id AND f.organization_id=s.organization_id)))
 OR EXISTS(SELECT 1 FROM public.facility_executives r WHERE r.organization_id=s.organization_id AND NOT EXISTS(SELECT 1 FROM public.facilities f WHERE f.id=r.facility_id AND f.organization_id=s.organization_id)) THEN
  RAISE EXCEPTION 'workforce_source_reference_invalid' USING ERRCODE='22023';
 END IF;
 SELECT count(*) INTO people_count FROM public.staff WHERE organization_id=s.organization_id;
 SELECT 1+(SELECT count(*) FROM public.entities WHERE organization_id=s.organization_id)+(SELECT count(*) FROM public.facilities WHERE organization_id=s.organization_id) INTO units_count;
 SELECT people_count+count(*) INTO assignments_count FROM public.staff_facility_assignments WHERE organization_id=s.organization_id;
 SELECT count(*) INTO roles_count FROM public.facility_executives WHERE organization_id=s.organization_id;
 IF people_count>5000 OR units_count>500 OR people_count+units_count+assignments_count+roles_count>20000 THEN
  RAISE EXCEPTION 'workforce_export_oversized' USING ERRCODE='22023';
 END IF;
 -- One source SELECT gives all collections one MVCC statement snapshot. Soft-deleted
 -- native records are explicit tombstones; no omission is interpreted as termination.
 observed:=clock_timestamp();
 SELECT jsonb_build_object(
 'units',coalesce((SELECT jsonb_agg(u.value ORDER BY u.kind,u.id) FROM (
  SELECT 0 kind,o.id,jsonb_build_object('source_record_id',o.id,'record_type','organization','display_name',btrim(o.name),'unit_kind','business_group','source_kind',NULL,
    'source_status',o.status,'parent_ref',NULL,'parent_relation',NULL,'record_state',CASE WHEN o.deleted_at IS NULL THEN 'present' ELSE 'deleted' END,
    'source_updated_at',haven.workforce_time(o.updated_at),'record_retired_at',NULL,'record_deleted_at',haven.workforce_time(o.deleted_at)) value FROM public.organizations o WHERE o.id=s.organization_id
  UNION ALL
  SELECT 1,e.id,jsonb_build_object('source_record_id',e.id,'record_type','entity','display_name',btrim(e.name),'unit_kind','legal_entity',
    'source_kind',CASE WHEN lower(btrim(e.entity_type)) IN ('llc','corporation','partnership','sole_proprietor','nonprofit','trust','other') THEN lower(btrim(e.entity_type)) ELSE NULL END,
    'source_status',e.status,'parent_ref',jsonb_build_object('record_type','organization','source_record_id',e.organization_id),'parent_relation','source_scope',
    'record_state',CASE WHEN e.deleted_at IS NULL THEN 'present' ELSE 'deleted' END,'source_updated_at',haven.workforce_time(e.updated_at),'record_retired_at',NULL,'record_deleted_at',haven.workforce_time(e.deleted_at)) FROM public.entities e WHERE e.organization_id=s.organization_id
  UNION ALL
  SELECT 2,f.id,jsonb_build_object('source_record_id',f.id,'record_type','facility','display_name',btrim(f.name),'unit_kind','facility','source_kind',NULL,'source_status',f.status,
    'parent_ref',jsonb_build_object('record_type','entity','source_record_id',f.entity_id),'parent_relation','source_facility_entity',
    'record_state',CASE WHEN f.deleted_at IS NULL THEN 'present' ELSE 'deleted' END,'source_updated_at',haven.workforce_time(f.updated_at),'record_retired_at',NULL,'record_deleted_at',haven.workforce_time(f.deleted_at)) FROM public.facilities f WHERE f.organization_id=s.organization_id
 )u),'[]'::jsonb),
 'people',coalesce((SELECT jsonb_agg(jsonb_build_object('source_record_id',p.id,'record_type','staff','display_name',btrim(p.first_name||' '||p.last_name),
   'person_kind','staff','staff_role',p.staff_role,'job_title',NULL,'employment_status',p.employment_status,'employer_ref',NULL,
   'source_hire_date',p.hire_date,'source_termination_date',p.termination_date,'last_day_worked',NULL,'effective_employment_end',NULL,'source_processed_at',NULL,
   'pay_basis',NULL,'pay_basis_effective_from',NULL,'pay_basis_evidence',NULL,'record_state',CASE WHEN p.deleted_at IS NULL THEN 'present' ELSE 'deleted' END,
   'source_updated_at',haven.workforce_time(p.updated_at),'record_retired_at',NULL,'record_deleted_at',haven.workforce_time(p.deleted_at)) ORDER BY p.id)
   FROM public.staff p WHERE p.organization_id=s.organization_id),'[]'::jsonb),
 'assignments',coalesce((SELECT jsonb_agg(a.value ORDER BY a.kind,a.id) FROM (
  SELECT 0 kind,p.id,jsonb_build_object('source_record_id',p.id,'record_type','staff_home','person_ref',jsonb_build_object('record_type','staff','source_record_id',p.id),
    'unit_ref',jsonb_build_object('record_type','facility','source_record_id',p.facility_id),'assignment_kind','home','role_code',p.staff_role,'source_is_primary',NULL,
    'source_start_date',NULL,'source_end_date',NULL,'source_end_inclusive',NULL,'record_state',CASE WHEN p.deleted_at IS NULL THEN 'present' ELSE 'deleted' END,
    'source_updated_at',haven.workforce_time(p.updated_at),'record_retired_at',NULL,'record_deleted_at',haven.workforce_time(p.deleted_at)) value FROM public.staff p WHERE p.organization_id=s.organization_id
  UNION ALL
  SELECT 1,a.id,jsonb_build_object('source_record_id',a.id,'record_type','staff_facility_assignment','person_ref',jsonb_build_object('record_type','staff','source_record_id',a.staff_id),
    'unit_ref',jsonb_build_object('record_type','facility','source_record_id',a.facility_id),'assignment_kind','additional','role_code',a.role_at_facility,'source_is_primary',a.is_primary,
    'source_start_date',a.start_date,'source_end_date',a.end_date,'source_end_inclusive',CASE WHEN a.end_date IS NOT NULL THEN true ELSE NULL END,
    'record_state',CASE WHEN a.deleted_at IS NULL THEN 'present' ELSE 'deleted' END,'source_updated_at',haven.workforce_time(a.updated_at),'record_retired_at',NULL,'record_deleted_at',haven.workforce_time(a.deleted_at)) FROM public.staff_facility_assignments a WHERE a.organization_id=s.organization_id
 )a),'[]'::jsonb),
 'roles',coalesce((SELECT jsonb_agg(jsonb_build_object('source_record_id',r.id,'record_type','facility_executive','unit_ref',jsonb_build_object('record_type','facility','source_record_id',r.facility_id),
   'role_code','facility_executive','title',NULL,'holder_ref',CASE WHEN link.n=1 THEN jsonb_build_object('record_type','staff','source_record_id',link.person_id)
     ELSE jsonb_build_object('record_type','user','source_record_id',r.user_id) END,'holder_resolution',CASE WHEN link.n=1 THEN 'resolved' ELSE 'unresolved' END,
   'source_start_date',r.effective_from,'source_end_date',NULL,'source_end_inclusive',NULL,'date_kind','effective','record_state','present',
   'source_updated_at',haven.workforce_time(r.updated_at),'record_retired_at',NULL,'record_deleted_at',NULL) ORDER BY r.id)
   FROM public.facility_executives r CROSS JOIN LATERAL (SELECT count(*) n,min(p.id::text)::uuid person_id FROM public.staff p WHERE p.organization_id=s.organization_id AND p.user_id=r.user_id AND p.deleted_at IS NULL) link
   WHERE r.organization_id=s.organization_id),'[]'::jsonb),
 'reporting','[]'::jsonb) INTO records;
 IF octet_length(records::text)>2097152 THEN RAISE EXCEPTION 'workforce_export_oversized' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('source_as_of',haven.workforce_time(observed),'records',records);
END $$;

CREATE FUNCTION public.workforce_publisher_store_pending(p_run_id uuid,p_lease_token uuid,p_generation bigint,p_body text,p_body_sha256 text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s haven.workforce_publisher_state%ROWTYPE; body jsonb; observed timestamptz; previous_observed timestamptz;
BEGIN
 s:=haven.workforce_lease(p_run_id,p_lease_token,p_generation);
 IF p_body IS NULL OR octet_length(p_body) NOT BETWEEN 2 AND 2097152 OR p_body_sha256 IS NULL
   OR p_body_sha256 IS DISTINCT FROM encode(extensions.digest(convert_to(p_body,'UTF8'),'sha256'),'hex') THEN
  RAISE EXCEPTION 'workforce_pending_invalid' USING ERRCODE='22023';
 END IF;
 body:=p_body::jsonb;
 observed:=(body->>'source_as_of')::timestamptz;
 SELECT source_as_of INTO previous_observed FROM haven.workforce_publisher_receipts WHERE organization_id=s.organization_id ORDER BY sequence DESC LIMIT 1;
 IF observed IS NULL OR NOT isfinite(observed) OR observed>clock_timestamp()+interval '5 minutes' OR observed<previous_observed THEN
  RAISE EXCEPTION 'workforce_observation_invalid' USING ERRCODE='22023';
 END IF;
 IF body->>'source_system' IS DISTINCT FROM 'haven' OR body->>'source_tenant_id' IS DISTINCT FROM s.organization_id::text
 OR body->>'dataset' IS DISTINCT FROM 'workforce_roster' OR body->>'contract_version' IS DISTINCT FROM '1'
 OR body->>'mode' IS DISTINCT FROM 'full' OR body->>'complete' IS DISTINCT FROM 'true'
 OR (body->>'sequence')::bigint IS DISTINCT FROM s.sequence+1 OR (body->>'source_as_of')::timestamptz IS NULL
 OR (body->>'batch_id')::uuid IS NULL THEN RAISE EXCEPTION 'workforce_pending_scope_invalid' USING ERRCODE='22023'; END IF;
 IF s.pending_body IS NOT NULL AND (s.pending_body IS DISTINCT FROM p_body OR s.pending_body_sha256 IS DISTINCT FROM p_body_sha256) THEN
  RAISE EXCEPTION 'workforce_pending_conflict' USING ERRCODE='23505';
 END IF;
 IF s.pending_body IS NULL THEN
  UPDATE haven.workforce_publisher_state SET pending_body=p_body,pending_body_sha256=p_body_sha256,pending_batch_id=(body->>'batch_id')::uuid,
    pending_sequence=(body->>'sequence')::bigint,pending_source_as_of=(body->>'source_as_of')::timestamptz,updated_at=clock_timestamp()
    WHERE singleton RETURNING * INTO s;
 END IF;
 RETURN haven.workforce_pending(s);
END $$;
CREATE FUNCTION public.workforce_publisher_complete(p_run_id uuid,p_lease_token uuid,p_generation bigint,p_receipt_id uuid,p_received_at timestamptz,p_replayed boolean,p_body_sha256 text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s haven.workforce_publisher_state%ROWTYPE;
BEGIN
 s:=haven.workforce_lease(p_run_id,p_lease_token,p_generation);
 IF s.pending_body IS NULL OR p_body_sha256 IS DISTINCT FROM s.pending_body_sha256 OR p_receipt_id IS NULL OR p_received_at IS NULL OR NOT isfinite(p_received_at) OR p_replayed IS NULL THEN
  RAISE EXCEPTION 'workforce_receipt_invalid' USING ERRCODE='22023';
 END IF;
 INSERT INTO haven.workforce_publisher_receipts(organization_id,batch_id,sequence,body_sha256,receipt_id,source_as_of,received_at,replayed,counts)
 VALUES(s.organization_id,s.pending_batch_id,s.pending_sequence,s.pending_body_sha256,p_receipt_id,s.pending_source_as_of,p_received_at,p_replayed,jsonb_build_object('units',jsonb_array_length(s.pending_body::jsonb#>'{records,units}'),'people',jsonb_array_length(s.pending_body::jsonb#>'{records,people}'),'assignments',jsonb_array_length(s.pending_body::jsonb#>'{records,assignments}'),'roles',jsonb_array_length(s.pending_body::jsonb#>'{records,roles}'),'reporting',jsonb_array_length(s.pending_body::jsonb#>'{records,reporting}')));
 UPDATE haven.workforce_publisher_state SET sequence=s.pending_sequence,pending_body=NULL,pending_body_sha256=NULL,pending_batch_id=NULL,pending_sequence=NULL,pending_source_as_of=NULL,
   last_outcome='accepted',last_error_code=NULL,last_completed_at=clock_timestamp(),lease_run_id=NULL,lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE singleton;
 RETURN jsonb_build_object('completed',true,'sequence',s.pending_sequence,'receipt_id',p_receipt_id);
END $$;
CREATE FUNCTION public.workforce_publisher_release(p_run_id uuid,p_lease_token uuid,p_generation bigint,p_outcome text,p_error_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE s haven.workforce_publisher_state%ROWTYPE;
BEGIN
 s:=haven.workforce_lease(p_run_id,p_lease_token,p_generation);
 IF p_outcome NOT IN ('accepted','failed','outcome_unknown','rejected') OR p_error_code IS NOT NULL AND p_error_code !~ '^[a-z_]{1,64}$' THEN
  RAISE EXCEPTION 'workforce_result_invalid' USING ERRCODE='22023';
 END IF;
 UPDATE haven.workforce_publisher_state SET lease_run_id=NULL,lease_token=NULL,lease_until=NULL,last_completed_at=clock_timestamp(),
   last_outcome=CASE WHEN s.last_outcome='accepted' AND s.pending_body IS NULL AND s.last_completed_at>=s.last_started_at THEN 'accepted' ELSE p_outcome END,
   last_error_code=CASE WHEN s.last_outcome='accepted' AND s.pending_body IS NULL AND s.last_completed_at>=s.last_started_at THEN NULL ELSE p_error_code END,
   updated_at=clock_timestamp() WHERE singleton;
 RETURN jsonb_build_object('released',true);
END $$;

-- Cron is a disabled scaffold, and the tick independently checks enabled config.
-- Dedicated Vault secret authorizes only this source publisher endpoint.
CREATE FUNCTION haven.workforce_publisher_tick() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE secret text; request_id bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM haven.workforce_publisher_state WHERE singleton AND enabled) THEN RETURN NULL; END IF;
 IF to_regnamespace('vault') IS NULL OR to_regnamespace('net') IS NULL THEN RAISE EXCEPTION 'workforce_scheduler_unconfigured'; END IF;
 EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=$1' INTO secret USING 'workforce_publisher_cron_secret';
 IF secret IS NULL OR length(secret)<32 THEN RAISE EXCEPTION 'workforce_scheduler_unconfigured'; END IF;
 EXECUTE 'SELECT net.http_post(url:=$1,headers:=$2,body:=$3,timeout_milliseconds:=30000)' INTO request_id
 USING 'https://manfqmasfqppukpobpld.supabase.co/functions/v1/workforce-publisher',jsonb_build_object('content-type','application/json','x-cron-secret',secret),'{}'::jsonb;
 RETURN request_id;
END $$;
DO $$ DECLARE job bigint; BEGIN
 IF to_regnamespace('cron') IS NOT NULL THEN
  EXECUTE 'SELECT cron.schedule($1,$2,$3)' INTO job USING 'workforce-publisher-daily','0 10 * * *','SELECT haven.workforce_publisher_tick()';
  EXECUTE 'UPDATE cron.job SET active=false WHERE jobid=$1' USING job;
 END IF;
END $$;
REVOKE ALL ON FUNCTION haven.workforce_time(timestamptz),haven.workforce_generation_guard(),haven.workforce_lease(uuid,uuid,bigint),
 haven.workforce_pending(haven.workforce_publisher_state),haven.workforce_publisher_tick(),public.workforce_publisher_acquire(uuid,integer),
 public.workforce_publisher_export(uuid,uuid,bigint),public.workforce_publisher_store_pending(uuid,uuid,bigint,text,text),
 public.workforce_publisher_complete(uuid,uuid,bigint,uuid,timestamptz,boolean,text),public.workforce_publisher_release(uuid,uuid,bigint,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.workforce_publisher_acquire(uuid,integer),public.workforce_publisher_export(uuid,uuid,bigint),
 public.workforce_publisher_store_pending(uuid,uuid,bigint,text,text),public.workforce_publisher_complete(uuid,uuid,bigint,uuid,timestamptz,boolean,text),
 public.workforce_publisher_release(uuid,uuid,bigint,text,text) TO service_role;
COMMIT;
