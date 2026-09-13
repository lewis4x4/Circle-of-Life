BEGIN;

-- COL-146 / HFO-17: recover interrupted saves safely on shared devices. A
-- draft is the exact arguments of one command (record, verify, correct,
-- reverse, report issue) stored server-side under the actor's own identity
-- with the request key the command will use, so a save whose answer was lost
-- can be reconciled against the database (the record exists under that key
-- for that actor or it does not) and, when unsaved, resumed under the actor's
-- current authority without re-sending edited content. The browser holds no
-- payload; at most the draft id in memory. Nothing in a draft grants
-- anything: reading it back requires the same current site and subject
-- authority as issuing the command, and resuming it runs the command's own
-- locks and checks; the underlying command's own refusal propagates unchanged
-- and leaves the draft pending. Drafts expire after 24 hours, are owned by
-- their actor only (another person on the same device never sees, resumes or
-- discards them), move forward only and are never deleted.
-- This migration drafts nothing, records no work, reports no issue, submits
-- nothing offline (Q25 open) and drafts no file bytes.

-- Stacked on COL-145 (344): the correction and reversal commands must exist.
DO $$ BEGIN
 IF to_regprocedure('haven.record_operation_work(uuid,text,jsonb)') IS NULL OR to_regprocedure('haven.verify_operation_work(uuid,text,jsonb)') IS NULL
  OR to_regprocedure('haven.correct_operation_work(uuid,text,uuid,text,jsonb)') IS NULL OR to_regprocedure('haven.reverse_operation_work(uuid,text,uuid,text,jsonb)') IS NULL
  OR to_regprocedure('haven.report_operation_issue(text,jsonb)') IS NULL OR to_regprocedure('haven.lock_operation_work_authority(uuid,public.app_role[])') IS NULL
  OR to_regprocedure('haven.lock_operation_recorder(uuid,uuid)') IS NULL THEN
  RAISE EXCEPTION 'COL-146: the COL-142, COL-144 and COL-145 commands are required before drafts; apply 341, 342 and 344 first';
 END IF;
 IF to_regclass('public.operation_command_drafts') IS NOT NULL THEN RAISE EXCEPTION 'COL-146: operation_command_drafts already exists; repair before applying'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The draft: one command's arguments under one request key for one actor.
-- ---------------------------------------------------------------------------
CREATE TABLE public.operation_command_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id),
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 actor_session_id uuid,
 command text NOT NULL CHECK(command IN('record_work','verify_work','correct_work','reverse_work','report_issue')),
 target_id uuid REFERENCES public.operation_task_instances(id),
 request_key text NOT NULL UNIQUE CHECK(request_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
 arguments jsonb NOT NULL CHECK(jsonb_typeof(arguments)='object'),
 arguments_hash text NOT NULL CHECK(arguments_hash ~ '^[0-9a-f]{64}$'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','reconciled','discarded','expired')),
 -- The statement clock, not the transaction clock, so the owner's list orders by creation.
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 reconciled_at timestamptz,
 reconciled_record jsonb CHECK(reconciled_record IS NULL OR jsonb_typeof(reconciled_record)='object'),
 discarded_at timestamptz,
 revision text NOT NULL CHECK(revision ~ '^[0-9a-f]{64}$'),
 CHECK(command='report_issue' OR target_id IS NOT NULL),
 CHECK(expires_at=created_at+interval '24 hours'),
 CHECK((state='reconciled')=(reconciled_at IS NOT NULL) AND (state='reconciled')=(reconciled_record IS NOT NULL)),
 CHECK((state='discarded')=(discarded_at IS NOT NULL))
);
CREATE INDEX idx_operation_command_drafts_actor_state_created ON public.operation_command_drafts(actor_id,state,created_at);
CREATE INDEX idx_operation_command_drafts_target ON public.operation_command_drafts(target_id) WHERE target_id IS NOT NULL;

ALTER TABLE public.operation_command_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operation_command_drafts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.operation_command_drafts TO authenticated;
-- The owner reads their own drafts under the same current authority the
-- command needs: the occurrence readable (COL-133 subject boundary) for a
-- targeted draft, the site held for a scoped issue report. No client DML, no
-- service DML: commands only, under the owner-secret token.
CREATE POLICY operation_command_drafts_read ON public.operation_command_drafts FOR SELECT TO authenticated USING(
 actor_id=auth.uid() AND organization_id=haven.organization_id()
 AND CASE WHEN target_id IS NOT NULL THEN haven.operation_task_readable(target_id) ELSE haven.operation_facility_access(facility_id) END);
CREATE TRIGGER operation_command_drafts_audit AFTER INSERT OR UPDATE OR DELETE ON public.operation_command_drafts
 FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
CREATE TRIGGER operation_command_drafts_no_truncate BEFORE TRUNCATE ON public.operation_command_drafts
 FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_catalog_truncate();
-- Draft arguments carry recorded values and notes; the generic audit payload
-- of this table is hidden from the generic audit read like the receipts.
CREATE POLICY operation_command_draft_audit_current ON public.audit_log AS RESTRICTIVE FOR SELECT TO authenticated USING(table_name<>'operation_command_drafts');

-- The content fingerprint is derived server-side from the actor, the command,
-- the target and the arguments; never trusted from the row.
CREATE FUNCTION haven.operation_command_draft_hash(p_actor uuid,p_command text,p_target uuid,p_arguments jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('actor',p_actor,'command',p_command,'target',p_target,'arguments',p_arguments)::text,'UTF8')),'hex')
$$;

-- Guard: no delete; no write without the token; on insert the state, expiry,
-- fingerprint and revision are server-owned; afterwards the identity columns
-- are immutable and the state moves forward once, from pending only.
CREATE FUNCTION haven.guard_operation_command_draft() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Drafts are immutable history' USING ERRCODE='23514'; END IF;
 IF NOT haven.operation_occurrence_approved() THEN RAISE EXCEPTION 'Use the draft commands' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  NEW.state:='pending'; NEW.reconciled_at:=NULL; NEW.reconciled_record:=NULL; NEW.discarded_at:=NULL;
  NEW.created_at:=coalesce(NEW.created_at,clock_timestamp()); NEW.updated_at:=NEW.created_at; NEW.expires_at:=NEW.created_at+interval '24 hours';
  NEW.arguments_hash:=haven.operation_command_draft_hash(NEW.actor_id,NEW.command,NEW.target_id,NEW.arguments);
  NEW.revision:=haven.operation_occurrence_revision();
  RETURN NEW;
 END IF;
 IF (NEW.id,NEW.organization_id,NEW.facility_id,NEW.actor_id,NEW.actor_session_id,NEW.command,NEW.target_id,NEW.request_key,NEW.arguments,NEW.arguments_hash,NEW.created_at,NEW.expires_at)
  IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.facility_id,OLD.actor_id,OLD.actor_session_id,OLD.command,OLD.target_id,OLD.request_key,OLD.arguments,OLD.arguments_hash,OLD.created_at,OLD.expires_at) THEN
  RAISE EXCEPTION 'Draft identity is immutable' USING ERRCODE='23514';
 END IF;
 IF NOT (OLD.state='pending' AND NEW.state IN('reconciled','discarded','expired')) THEN RAISE EXCEPTION 'Draft state moves forward only' USING ERRCODE='23514'; END IF;
 NEW.updated_at:=clock_timestamp();
 NEW.revision:=haven.operation_occurrence_revision();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.operation_command_draft_hash(uuid,text,uuid,jsonb),haven.guard_operation_command_draft() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER operation_command_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON public.operation_command_drafts
 FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_command_draft();

-- ---------------------------------------------------------------------------
-- Draft authority: the command's own lock. A targeted draft locks the
-- occurrence, its subject, the actor's grants and session and requires the
-- occurrence readable (haven.lock_operation_work_authority with no role
-- list); a scoped issue draft locks the actor and requires current site
-- authority (haven.lock_operation_recorder). Missing and unauthorised share
-- one wording except that an unknown draft id is reported as absent.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.lock_operation_command_draft_authority(d public.operation_command_drafts) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF d.target_id IS NOT NULL THEN PERFORM haven.lock_operation_work_authority(d.target_id,NULL);
 ELSE PERFORM haven.lock_operation_recorder(d.organization_id,d.facility_id); END IF;
 IF d.organization_id IS DISTINCT FROM haven.organization_id() OR d.actor_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
END $$;
-- Owner only: the draft row is locked (two resumes, or a resume and a
-- discard, serialise here) before the target's authority is locked, so every
-- draft command takes the draft before the occurrence.
CREATE FUNCTION haven.lock_operation_command_draft(p_draft uuid) RETURNS public.operation_command_drafts
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.operation_command_drafts;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.operation_command_drafts WHERE id=p_draft AND actor_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN
  IF p_draft IS NOT NULL AND EXISTS(SELECT 1 FROM public.operation_command_drafts WHERE id=p_draft) THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
  RAISE EXCEPTION 'Draft not found' USING ERRCODE='P0002';
 END IF;
 PERFORM haven.lock_operation_command_draft_authority(d);
 RETURN d;
END $$;
-- The record a draft's key produced for this actor on this draft's target,
-- if any: a receipt for the receipt commands, an issue for the issue report.
-- A key reused on another occurrence never reconciles the draft as saved.
CREATE FUNCTION haven.operation_command_draft_record(d public.operation_command_drafts) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN d.command='report_issue' THEN (SELECT to_jsonb(i) FROM public.operation_issues i WHERE i.request_key=d.request_key AND i.reported_by=d.actor_id AND i.task_instance_id IS NOT DISTINCT FROM d.target_id)
  ELSE (SELECT to_jsonb(r) FROM public.operation_execution_receipts r WHERE r.request_key=d.request_key AND r.recorder_id=d.actor_id AND r.task_instance_id IS NOT DISTINCT FROM d.target_id) END
$$;
CREATE FUNCTION haven.operation_command_draft_record_kind(d public.operation_command_drafts) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT CASE WHEN d.command='report_issue' THEN 'issue' ELSE 'receipt' END $$;
REVOKE ALL ON FUNCTION haven.lock_operation_command_draft_authority(public.operation_command_drafts),haven.lock_operation_command_draft(uuid),
 haven.operation_command_draft_record(public.operation_command_drafts),haven.operation_command_draft_record_kind(public.operation_command_drafts) FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Save (session): shape → the command's target rules → lock → replay by key
-- (same actor and content: the existing draft; same actor, other content:
-- conflict; another actor's key: unavailable, nothing disclosed) → insert
-- pending under the token → re-lock → reply { draft, replayed }.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.save_operation_command_draft(p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE k text; command text; target uuid; facility uuid; org uuid; args jsonb; payload jsonb; issue_task uuid; issue_facility uuid; t public.operation_task_instances;
 request_hash text; existing public.operation_command_drafts; d public.operation_command_drafts;
BEGIN
 IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'A request key is required' USING ERRCODE='22023'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Draft payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF k NOT IN('command','target_id','facility_id','arguments') THEN RAISE EXCEPTION 'Draft payload field % is invalid',k USING ERRCODE='22023'; END IF;
 END LOOP;
 command:=p_payload->>'command';
 IF command IS NULL OR command NOT IN('record_work','verify_work','correct_work','reverse_work','report_issue') THEN
  RAISE EXCEPTION 'Command must be record_work, verify_work, correct_work, reverse_work or report_issue' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'target_id' AND jsonb_typeof(p_payload->'target_id')<>'null' AND jsonb_typeof(p_payload->'target_id')<>'string' THEN RAISE EXCEPTION 'Target must be a uuid' USING ERRCODE='22023'; END IF;
 BEGIN target:=nullif(p_payload->>'target_id','')::uuid; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Target must be a uuid' USING ERRCODE='22023'; END;
 IF p_payload ? 'facility_id' AND jsonb_typeof(p_payload->'facility_id')<>'null' AND jsonb_typeof(p_payload->'facility_id')<>'string' THEN RAISE EXCEPTION 'Facility must be a uuid' USING ERRCODE='22023'; END IF;
 BEGIN facility:=nullif(p_payload->>'facility_id','')::uuid; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Facility must be a uuid' USING ERRCODE='22023'; END;
 args:=p_payload->'arguments';
 IF args IS NULL OR jsonb_typeof(args)<>'object' THEN RAISE EXCEPTION 'Arguments must be an object' USING ERRCODE='22023'; END IF;
 IF octet_length(args::text)>65536 THEN RAISE EXCEPTION 'Arguments must be at most 64 KiB' USING ERRCODE='22023'; END IF;
 payload:=args->'payload';
 IF payload IS NULL OR jsonb_typeof(payload)<>'object' THEN RAISE EXCEPTION 'Arguments payload must be an object' USING ERRCODE='22023'; END IF;
 IF command IN('correct_work','reverse_work') THEN
  IF (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(args) x) IS DISTINCT FROM ARRAY['expected_receipt_id','expected_receipt_revision','payload'] THEN
   RAISE EXCEPTION 'Arguments must carry expected_receipt_id, expected_receipt_revision and payload' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(args->'expected_receipt_id')<>'string' THEN RAISE EXCEPTION 'Arguments expected_receipt_id must be a uuid' USING ERRCODE='22023'; END IF;
  BEGIN PERFORM (args->>'expected_receipt_id')::uuid; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Arguments expected_receipt_id must be a uuid' USING ERRCODE='22023'; END;
  IF jsonb_typeof(args->'expected_receipt_revision')<>'string' OR (args->>'expected_receipt_revision') !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'Arguments expected_receipt_revision must be 64 hex characters' USING ERRCODE='22023'; END IF;
 ELSIF (SELECT array_agg(x) FROM jsonb_object_keys(args) x) IS DISTINCT FROM ARRAY['payload'] THEN
  RAISE EXCEPTION 'Arguments must carry payload only' USING ERRCODE='22023';
 END IF;
 -- Target rules: the receipt commands name a managed occurrence; an issue
 -- report names the occurrence of its payload or, scoped, the site of its
 -- payload. The draft's site is derived from the target when there is one.
 IF command='report_issue' THEN
  IF payload ? 'task_instance_id' AND jsonb_typeof(payload->'task_instance_id')<>'null' AND jsonb_typeof(payload->'task_instance_id')<>'string' THEN RAISE EXCEPTION 'Target must be the issue payload task_instance_id' USING ERRCODE='22023'; END IF;
  BEGIN issue_task:=nullif(payload->>'task_instance_id','')::uuid; issue_facility:=nullif(payload->>'facility_id','')::uuid;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Arguments payload identifiers must be uuids' USING ERRCODE='22023'; END;
  IF issue_task IS NOT NULL THEN
   IF target IS DISTINCT FROM issue_task THEN RAISE EXCEPTION 'Target must be the issue payload task_instance_id' USING ERRCODE='22023'; END IF;
   IF facility IS NOT NULL THEN RAISE EXCEPTION 'Facility must be omitted when a target is given' USING ERRCODE='22023'; END IF;
  ELSE
   IF target IS NOT NULL THEN RAISE EXCEPTION 'Target must be omitted for a scoped issue report' USING ERRCODE='22023'; END IF;
   IF facility IS NULL THEN RAISE EXCEPTION 'Facility is required for a scoped issue report' USING ERRCODE='22023'; END IF;
   IF facility IS DISTINCT FROM issue_facility THEN RAISE EXCEPTION 'Facility must be the issue payload facility_id' USING ERRCODE='22023'; END IF;
  END IF;
 ELSE
  IF target IS NULL THEN RAISE EXCEPTION 'Target is required' USING ERRCODE='22023'; END IF;
  IF facility IS NOT NULL THEN RAISE EXCEPTION 'Facility must be omitted when a target is given' USING ERRCODE='22023'; END IF;
 END IF;
 -- Current authority first; nothing about the target is disclosed before it.
 IF target IS NOT NULL THEN
  PERFORM haven.lock_operation_work_authority(target,NULL);
  SELECT * INTO t FROM public.operation_task_instances WHERE id=target;
  IF t.occurrence_kind IS NULL THEN RAISE EXCEPTION 'Target must be a managed occurrence' USING ERRCODE='22023'; END IF;
  org:=t.organization_id; facility:=t.facility_id;
 ELSE
  org:=haven.organization_id();
  PERFORM 1 FROM public.facilities WHERE id=facility AND organization_id=org AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
  PERFORM haven.lock_operation_recorder(org,facility);
 END IF;
 request_hash:=haven.operation_command_draft_hash(auth.uid(),command,target,args);
 SELECT * INTO existing FROM public.operation_command_drafts WHERE request_key=p_request_key;
 IF FOUND THEN
  IF existing.actor_id<>auth.uid() THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
  IF existing.arguments_hash<>request_hash THEN RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001'; END IF;
  RETURN jsonb_build_object('draft',to_jsonb(existing),'replayed',true);
 END IF;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 BEGIN
  INSERT INTO public.operation_command_drafts(organization_id,facility_id,actor_id,actor_session_id,command,target_id,request_key,arguments)
  VALUES(org,facility,auth.uid(),nullif(auth.jwt()->>'session_id','')::uuid,command,target,p_request_key,args) RETURNING * INTO d;
 EXCEPTION WHEN unique_violation THEN
  -- A concurrent save committed this key between our read and our insert: the same answer after the wait.
  PERFORM set_config('haven.operation_occurrence_command','',true);
  SELECT * INTO existing FROM public.operation_command_drafts WHERE request_key=p_request_key;
  IF NOT FOUND OR existing.actor_id<>auth.uid() THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
  IF existing.arguments_hash<>request_hash THEN RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001'; END IF;
  RETURN jsonb_build_object('draft',to_jsonb(existing),'replayed',true);
 END;
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_command_draft_authority(d);
 RETURN jsonb_build_object('draft',to_jsonb(d),'replayed',false);
END $$;

-- ---------------------------------------------------------------------------
-- Reconcile (session): owner only; lock; the truth is the record under the
-- draft's key for this actor. Found: reconciled, naming the record (replayed:
-- the earlier attempt had committed). Not found: unsaved and still pending,
-- or expired on touch once past expiry. Never executes anything; idempotent.
-- ---------------------------------------------------------------------------
-- The record is named, not returned: { kind: receipt | issue, id, replayed },
-- the same object the draft stores; the client reads the record itself
-- through its own route under its own authority.
CREATE FUNCTION haven.reconcile_operation_command_draft(p_draft uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.operation_command_drafts; rec jsonb;
BEGIN
 d:=haven.lock_operation_command_draft(p_draft);
 IF d.state='discarded' THEN RETURN jsonb_build_object('draft',to_jsonb(d),'outcome','discarded'); END IF;
 IF d.state='expired' THEN RETURN jsonb_build_object('draft',to_jsonb(d),'outcome','expired'); END IF;
 IF d.state='reconciled' THEN RETURN jsonb_build_object('draft',to_jsonb(d),'outcome','saved','record',d.reconciled_record); END IF;
 rec:=haven.operation_command_draft_record(d);
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 IF rec IS NOT NULL THEN
  UPDATE public.operation_command_drafts SET state='reconciled',reconciled_at=clock_timestamp(),
   reconciled_record=jsonb_build_object('kind',haven.operation_command_draft_record_kind(d),'id',(rec->>'id')::uuid,'replayed',true)
  WHERE id=d.id RETURNING * INTO d;
 ELSIF d.expires_at<=clock_timestamp() THEN
  UPDATE public.operation_command_drafts SET state='expired' WHERE id=d.id RETURNING * INTO d;
 END IF;
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_command_draft_authority(d);
 RETURN CASE WHEN d.state='reconciled' THEN jsonb_build_object('draft',to_jsonb(d),'outcome','saved','record',d.reconciled_record)
  WHEN d.state='expired' THEN jsonb_build_object('draft',to_jsonb(d),'outcome','expired')
  ELSE jsonb_build_object('draft',to_jsonb(d),'outcome','unsaved') END;
END $$;

-- ---------------------------------------------------------------------------
-- Resume (session): owner only; lock (two resumes serialise on the draft row;
-- the second replays); pending and not expired, or already reconciled (a
-- replay); dispatch by command to the stored command with the stored target,
-- key and arguments under the actor's current authority. The command is
-- idempotent by request key, so a resume after a lost-but-committed answer
-- replays the one record. The command's own exception propagates unchanged:
-- the transaction rolls back and the draft stays pending.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.resume_operation_command_draft(p_draft uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.operation_command_drafts; reply jsonb; record_id uuid;
BEGIN
 d:=haven.lock_operation_command_draft(p_draft);
 IF d.state='discarded' THEN RAISE EXCEPTION 'Draft was discarded' USING ERRCODE='P0001'; END IF;
 IF d.state='expired' OR (d.state='pending' AND d.expires_at<=clock_timestamp()) THEN RAISE EXCEPTION 'Draft has expired' USING ERRCODE='P0001'; END IF;
 CASE d.command
  WHEN 'record_work' THEN reply:=haven.record_operation_work(d.target_id,d.request_key,d.arguments->'payload');
  WHEN 'verify_work' THEN reply:=haven.verify_operation_work(d.target_id,d.request_key,d.arguments->'payload');
  WHEN 'correct_work' THEN reply:=haven.correct_operation_work(d.target_id,d.request_key,(d.arguments->>'expected_receipt_id')::uuid,d.arguments->>'expected_receipt_revision',d.arguments->'payload');
  WHEN 'reverse_work' THEN reply:=haven.reverse_operation_work(d.target_id,d.request_key,(d.arguments->>'expected_receipt_id')::uuid,d.arguments->>'expected_receipt_revision',d.arguments->'payload');
  WHEN 'report_issue' THEN reply:=haven.report_operation_issue(d.request_key,d.arguments->'payload');
 END CASE;
 record_id:=CASE WHEN d.command='report_issue' THEN (reply->'issue'->>'id')::uuid ELSE (reply->'receipt'->>'id')::uuid END;
 IF record_id IS NULL THEN RAISE EXCEPTION 'Draft resume produced no record' USING ERRCODE='P0001'; END IF;
 IF d.state='pending' THEN
  PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
  UPDATE public.operation_command_drafts SET state='reconciled',reconciled_at=clock_timestamp(),
   reconciled_record=jsonb_build_object('kind',haven.operation_command_draft_record_kind(d),'id',record_id,'replayed',coalesce((reply->>'replayed')::boolean,false))
  WHERE id=d.id RETURNING * INTO d;
  PERFORM set_config('haven.operation_occurrence_command','',true);
 END IF;
 PERFORM haven.lock_operation_command_draft_authority(d);
 RETURN jsonb_build_object('draft',to_jsonb(d),'outcome','saved','reply',reply);
END $$;

-- ---------------------------------------------------------------------------
-- Discard (session): owner only; pending → discarded, never resumable;
-- idempotent on a discarded draft; a reconciled draft's record stands; an
-- expired draft is reported expired.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.discard_operation_command_draft(p_draft uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.operation_command_drafts;
BEGIN
 d:=haven.lock_operation_command_draft(p_draft);
 IF d.state='discarded' THEN RETURN jsonb_build_object('draft',to_jsonb(d)); END IF;
 IF d.state='reconciled' THEN RAISE EXCEPTION 'Draft is not pending' USING ERRCODE='P0001'; END IF;
 IF d.state='expired' OR d.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Draft has expired' USING ERRCODE='P0001'; END IF;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 UPDATE public.operation_command_drafts SET state='discarded',discarded_at=clock_timestamp() WHERE id=d.id RETURNING * INTO d;
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_command_draft_authority(d);
 RETURN jsonb_build_object('draft',to_jsonb(d));
END $$;

-- ---------------------------------------------------------------------------
-- Public wrappers and grants.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.save_operation_command_draft_review(p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.save_operation_command_draft(p_request_key,p_payload) $$;
CREATE FUNCTION public.reconcile_operation_command_draft_review(p_draft uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.reconcile_operation_command_draft(p_draft) $$;
CREATE FUNCTION public.resume_operation_command_draft_review(p_draft uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.resume_operation_command_draft(p_draft) $$;
CREATE FUNCTION public.discard_operation_command_draft_review(p_draft uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.discard_operation_command_draft(p_draft) $$;
REVOKE ALL ON FUNCTION
 haven.save_operation_command_draft(text,jsonb),haven.reconcile_operation_command_draft(uuid),haven.resume_operation_command_draft(uuid),haven.discard_operation_command_draft(uuid),
 public.save_operation_command_draft_review(text,jsonb),public.reconcile_operation_command_draft_review(uuid),public.resume_operation_command_draft_review(uuid),public.discard_operation_command_draft_review(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
 haven.save_operation_command_draft(text,jsonb),haven.reconcile_operation_command_draft(uuid),haven.resume_operation_command_draft(uuid),haven.discard_operation_command_draft(uuid),
 public.save_operation_command_draft_review(text,jsonb),public.reconcile_operation_command_draft_review(uuid),public.resume_operation_command_draft_review(uuid),public.discard_operation_command_draft_review(uuid)
 TO authenticated;

-- No draft exists after this migration is applied anywhere, the wrappers are
-- invokers and the helpers are executable by no client role; the replay probe
-- asserts the same.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.operation_command_drafts) THEN RAISE EXCEPTION 'COL-146: a draft exists after the migration; repair before applying'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE '%_operation_command_draft_review' AND p.prosecdef) THEN
  RAISE EXCEPTION 'COL-146: a public draft wrapper is a definer'; END IF;
 IF has_function_privilege('authenticated','haven.lock_operation_command_draft(uuid)','EXECUTE') OR has_function_privilege('service_role','haven.lock_operation_command_draft(uuid)','EXECUTE')
  OR has_function_privilege('anon','public.save_operation_command_draft_review(text,jsonb)','EXECUTE') OR has_function_privilege('service_role','public.resume_operation_command_draft_review(uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'COL-146: draft grants are incorrect'; END IF;
END $$;

COMMENT ON TABLE public.operation_command_drafts IS 'COL-146: the exact arguments of one command (record, verify, correct, reverse, report issue) stored server-side under the actor with the request key the command will use, so an interrupted save can be reconciled against the database or resumed without re-sending edited content. Owner-only, 24-hour expiry, forward-only states, never deleted. The browser holds no payload.';
COMMENT ON COLUMN public.operation_command_drafts.reconciled_record IS 'COL-146: { kind: receipt | issue, id, replayed } once the draft''s key is known to have produced its record for this actor; replayed is true when the record already existed when the draft was reconciled or resumed.';
COMMENT ON FUNCTION haven.save_operation_command_draft(text,jsonb) IS 'COL-146: store one command''s arguments under the actor with its request key before the command is issued; idempotent by key and content for the same actor; another actor''s key is unavailable; nothing in a draft grants anything.';
COMMENT ON FUNCTION haven.reconcile_operation_command_draft(uuid) IS 'COL-146: answer saved (with the record), unsaved, expired or discarded for the owner''s draft from the record under its key; never executes anything.';
COMMENT ON FUNCTION haven.resume_operation_command_draft(uuid) IS 'COL-146: execute the stored command with the stored arguments under the owner''s current authority; the command replays by key when the earlier attempt had committed; the command''s own refusal propagates unchanged and leaves the draft pending.';
COMMENT ON FUNCTION haven.discard_operation_command_draft(uuid) IS 'COL-146: pending becomes discarded and can never be resumed; idempotent on a discarded draft.';
NOTIFY pgrst,'reload schema';
COMMIT;
