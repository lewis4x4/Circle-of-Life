BEGIN;

-- COL-145 / HFO-08: corrections, reversals and reviews bound to the exact
-- receipt they reviewed; legacy writers proven refused. Recorded work changes
-- only by appending: a correction is a new performance receipt that restates
-- the work in full, names the exact receipt it corrects and the reason, and
-- supersedes it once; the corrected receipt stays verbatim (its recorder,
-- recorded-at and performed-at are never rewritten). A reversal is a receipt
-- of its own kind that supersedes the effective performance without replacing
-- it and returns the occurrence to unrecorded, so the work can be recorded
-- again as a new chain. Receipts of one act of work share a chain; finalized
-- evidence counts for every receipt in its chain and for none outside it. A
-- review binds to the performance receipt and revision it reviewed and is
-- superseded with it, so a corrected occurrence visibly awaits review again
-- when the rule requires one. Every reachable legacy writer of a managed
-- occurrence is already refused, dead or revoked (col145-evidence/
-- legacy-writers.md); none is translated into a receipt, the ordinary start
-- transition stays, and the probe re-proves each refusal.
-- This migration corrects no receipt, reverses no work, reviews nothing,
-- sets no urgency or reminder rule (Q29 open) and decides nothing about Q10.

-- ---------------------------------------------------------------------------
-- Chain, correction, supersession and review-binding columns on the receipt.
-- The 341 kind and completion-state checks and the kind shape are replaced
-- in place; every other 341/343 check keeps its definition.
-- ---------------------------------------------------------------------------
ALTER TABLE public.operation_execution_receipts
 ADD COLUMN chain_id uuid REFERENCES public.operation_execution_receipts(id),
 ADD COLUMN corrects_receipt_id uuid REFERENCES public.operation_execution_receipts(id),
 ADD COLUMN correction_reason text CHECK(correction_reason IS NULL OR length(btrim(correction_reason)) BETWEEN 1 AND 2000),
 ADD COLUMN correction_seq integer NOT NULL DEFAULT 0 CHECK(correction_seq>=0),
 ADD COLUMN superseded_at timestamptz,
 ADD COLUMN verifies_receipt_id uuid REFERENCES public.operation_execution_receipts(id),
 ADD COLUMN verified_receipt_revision text CHECK(verified_receipt_revision IS NULL OR verified_receipt_revision ~ '^[0-9a-f]{64}$');
CREATE INDEX idx_operation_execution_receipts_chain ON public.operation_execution_receipts(chain_id);
CREATE INDEX idx_operation_execution_receipts_verifies ON public.operation_execution_receipts(verifies_receipt_id) WHERE verifies_receipt_id IS NOT NULL;

-- State assumptions for the backfill: no receipt has been superseded, no
-- receipt carries a chain, correction or binding yet, and every verification
-- receipt has exactly one effective performance receipt on its occurrence.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.operation_execution_receipts WHERE superseded_by_receipt_id IS NOT NULL OR chain_id IS NOT NULL OR corrects_receipt_id IS NOT NULL
   OR correction_reason IS NOT NULL OR correction_seq<>0 OR superseded_at IS NOT NULL OR verifies_receipt_id IS NOT NULL OR verified_receipt_revision IS NOT NULL
   OR receipt_kind NOT IN('performance','verification'))
  OR EXISTS(SELECT 1 FROM public.operation_execution_receipts ver WHERE ver.receipt_kind='verification'
   AND (SELECT count(*) FROM public.operation_execution_receipts perf WHERE perf.task_instance_id=ver.task_instance_id AND perf.receipt_kind='performance' AND perf.superseded_by_receipt_id IS NULL)<>1) THEN
  RAISE EXCEPTION 'COL-145: receipts are not in the expected pre-migration state; repair before applying';
 END IF;
END $$;
-- Backfill at migration time only: a recording is its own chain root; a
-- review binds to the one effective performance receipt of its occurrence.
-- The receipt guard forbids these column moves at run time, so it is paused
-- for the backfill statement alone.
ALTER TABLE public.operation_execution_receipts DISABLE TRIGGER operation_execution_receipt_guard;
UPDATE public.operation_execution_receipts SET chain_id=id WHERE chain_id IS NULL;
UPDATE public.operation_execution_receipts ver SET verifies_receipt_id=perf.id,verified_receipt_revision=perf.revision
 FROM public.operation_execution_receipts perf
 WHERE ver.receipt_kind='verification' AND ver.verifies_receipt_id IS NULL AND perf.task_instance_id=ver.task_instance_id AND perf.receipt_kind='performance' AND perf.superseded_by_receipt_id IS NULL;
ALTER TABLE public.operation_execution_receipts ENABLE TRIGGER operation_execution_receipt_guard;
ALTER TABLE public.operation_execution_receipts ALTER COLUMN chain_id SET NOT NULL;

DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) def FROM pg_catalog.pg_constraint WHERE conrelid='public.operation_execution_receipts'::regclass AND contype='c' LOOP
  IF c.def LIKE 'CHECK ((receipt_kind = ANY%' OR c.def LIKE 'CHECK ((completion_state = ANY%' OR c.def LIKE 'CHECK ((((receipt_kind = ''performance''::text) AND (outcome IS NOT NULL))%' THEN
   EXECUTE format('ALTER TABLE public.operation_execution_receipts DROP CONSTRAINT %I',c.conname);
  END IF;
 END LOOP;
END $$;
ALTER TABLE public.operation_execution_receipts
 ADD CONSTRAINT operation_execution_receipts_receipt_kind_check CHECK(receipt_kind IN('performance','verification','reversal')),
 ADD CONSTRAINT operation_execution_receipts_completion_state_check CHECK(completion_state IN('completed','performed_missing_evidence','awaiting_verification','failed','not_performed','reversed')),
 -- A performance receipt states an outcome; a review and a reversal state none and carry no performer, entry reason or issue.
 ADD CONSTRAINT operation_receipt_kind_shape CHECK(
  (receipt_kind='performance' AND outcome IS NOT NULL)
  OR (receipt_kind='verification' AND outcome IS NULL AND performer_kind='self' AND entry_kind='routine' AND issue_id IS NULL AND corrects_receipt_id IS NULL)
  OR (receipt_kind='reversal' AND outcome IS NULL AND performer_kind='self' AND entry_kind='routine' AND issue_id IS NULL AND "values"='{}'::jsonb
   AND evidence_status='not_required' AND missing_evidence='[]'::jsonb AND corrects_receipt_id IS NOT NULL)),
 -- Only a reversal is reversed; a correction or reversal names what it supersedes and why, once, in sequence.
 ADD CONSTRAINT operation_receipt_correction_shape CHECK(
  (receipt_kind='reversal')=(completion_state='reversed')
  AND (corrects_receipt_id IS NULL)=(correction_reason IS NULL) AND (corrects_receipt_id IS NULL)=(correction_seq=0)
  AND (corrects_receipt_id IS NULL OR corrects_receipt_id<>id)
  AND (superseded_by_receipt_id IS NULL)=(superseded_at IS NULL) AND (superseded_by_receipt_id IS NULL OR superseded_by_receipt_id<>id)),
 -- A review binds to exactly one performance receipt and the revision it reviewed.
 ADD CONSTRAINT operation_receipt_review_binding CHECK(
  (receipt_kind='verification')=(verifies_receipt_id IS NOT NULL) AND (verifies_receipt_id IS NULL)=(verified_receipt_revision IS NULL));
-- The corrected receipt is superseded before its correction exists (the
-- correction takes the one effective-performance slot), so the pointer is
-- checked at commit; the guard pairs both rows when the correction is inserted.
ALTER TABLE public.operation_execution_receipts ALTER CONSTRAINT operation_execution_receipts_superseded_by_receipt_id_fkey DEFERRABLE INITIALLY IMMEDIATE;

-- The 343 guard body is kept: no delete, no write without the token, the
-- evidence transition once. On insert the chain and sequence are derived
-- server-side from the corrected receipt, never trusted from the row, a new
-- receipt is never superseded, a correction or reversal must already be the
-- superseder of the effective performance receipt of its own occurrence, and
-- a review must bind to that effective receipt at its current revision. The
-- only other permitted update sets superseded_by_receipt_id and superseded_at
-- together, once, to a receipt of the same occurrence. revision stays
-- immutable: a superseded receipt is recognisable by its superseder.
CREATE OR REPLACE FUNCTION haven.guard_operation_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE corrected public.operation_execution_receipts; reviewed public.operation_execution_receipts;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Execution receipts are immutable' USING ERRCODE='23514'; END IF;
 IF NOT haven.operation_occurrence_approved() THEN RAISE EXCEPTION 'Use the receipt commands' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  NEW.evidence_status_current:=NEW.evidence_status; NEW.evidence_satisfied_at:=NULL;
  IF NEW.superseded_by_receipt_id IS NOT NULL OR NEW.superseded_at IS NOT NULL THEN RAISE EXCEPTION 'A new receipt is never superseded' USING ERRCODE='23514'; END IF;
  IF NEW.corrects_receipt_id IS NULL THEN
   NEW.chain_id:=NEW.id; NEW.correction_seq:=0;
  ELSE
   SELECT * INTO corrected FROM public.operation_execution_receipts WHERE id=NEW.corrects_receipt_id;
   IF NOT FOUND OR corrected.receipt_kind<>'performance' OR corrected.task_instance_id<>NEW.task_instance_id OR corrected.superseded_by_receipt_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'A correction supersedes the effective performance receipt of its own occurrence' USING ERRCODE='23514';
   END IF;
   NEW.chain_id:=corrected.chain_id; NEW.correction_seq:=corrected.correction_seq+1;
  END IF;
  IF NEW.receipt_kind='verification' THEN
   SELECT * INTO reviewed FROM public.operation_execution_receipts WHERE id=NEW.verifies_receipt_id;
   IF NOT FOUND OR reviewed.receipt_kind<>'performance' OR reviewed.task_instance_id<>NEW.task_instance_id OR reviewed.superseded_by_receipt_id IS NOT NULL
    OR NEW.verified_receipt_revision IS DISTINCT FROM reviewed.revision THEN
    RAISE EXCEPTION 'A review binds to the effective performance receipt of its own occurrence' USING ERRCODE='23514';
   END IF;
  END IF;
  -- Whatever this receipt already supersedes is the receipt it corrects or that receipt's review, on the same occurrence.
  IF EXISTS(SELECT 1 FROM public.operation_execution_receipts s WHERE s.superseded_by_receipt_id=NEW.id
   AND NOT (NEW.corrects_receipt_id IS NOT NULL AND s.task_instance_id=NEW.task_instance_id AND (s.id=NEW.corrects_receipt_id OR (s.receipt_kind='verification' AND s.verifies_receipt_id=NEW.corrects_receipt_id)))) THEN
   RAISE EXCEPTION 'Supersession stays within one act of work' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 -- COL-143: missing → complete with its instant.
 IF to_jsonb(NEW)-ARRAY['evidence_status_current','evidence_satisfied_at'] IS NOT DISTINCT FROM to_jsonb(OLD)-ARRAY['evidence_status_current','evidence_satisfied_at'] THEN
  IF NOT (OLD.evidence_status='missing' AND OLD.evidence_status_current='missing' AND OLD.evidence_satisfied_at IS NULL
          AND NEW.evidence_status_current='complete' AND NEW.evidence_satisfied_at IS NOT NULL) THEN
   RAISE EXCEPTION 'Execution receipts are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 -- COL-145: superseded once. A performance receipt is superseded by the correction or reversal that names it
 -- (paired at that receipt's insert, since it takes the effective slot before it exists); a review is superseded
 -- by the existing correction or reversal of the receipt it reviewed. Nothing else may point anywhere.
 IF to_jsonb(NEW)-ARRAY['superseded_by_receipt_id','superseded_at'] IS NOT DISTINCT FROM to_jsonb(OLD)-ARRAY['superseded_by_receipt_id','superseded_at'] THEN
  IF NOT (OLD.superseded_by_receipt_id IS NULL AND OLD.superseded_at IS NULL AND NEW.superseded_by_receipt_id IS NOT NULL AND NEW.superseded_by_receipt_id<>NEW.id AND NEW.superseded_at IS NOT NULL
          AND OLD.receipt_kind IN('performance','verification')) THEN
   RAISE EXCEPTION 'Execution receipts are immutable' USING ERRCODE='23514';
  END IF;
  SELECT * INTO corrected FROM public.operation_execution_receipts WHERE id=NEW.superseded_by_receipt_id;
  IF OLD.receipt_kind='performance' THEN
   IF FOUND AND NOT (corrected.task_instance_id=OLD.task_instance_id AND corrected.chain_id=OLD.chain_id AND corrected.corrects_receipt_id=OLD.id) THEN
    RAISE EXCEPTION 'Execution receipts are immutable' USING ERRCODE='23514';
   END IF;
  ELSIF NOT FOUND OR NOT (corrected.task_instance_id=OLD.task_instance_id AND corrected.corrects_receipt_id=OLD.verifies_receipt_id AND corrected.recorded_at>=OLD.recorded_at) THEN
   RAISE EXCEPTION 'Execution receipts are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'Execution receipts are immutable' USING ERRCODE='23514';
END $$;

-- Lifecycle events the commands write.
DO $$ DECLARE c text; BEGIN
 SELECT conname INTO c FROM pg_catalog.pg_constraint WHERE conrelid='public.operation_audit_log'::regclass AND contype='c'
  AND pg_get_constraintdef(oid) LIKE '%event_type%';
 IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE public.operation_audit_log DROP CONSTRAINT %I',c); END IF;
 ALTER TABLE public.operation_audit_log ADD CONSTRAINT operation_audit_log_event_type_check CHECK(event_type IN(
  'created','assigned','started','completed','missed','deferred','cancelled','escalated','verified','signed','updated','generated','associated','reconciled','recorded','issue_reported','corrected','reversed'));
END $$;

-- ---------------------------------------------------------------------------
-- Evidence across a chain: a rule is met by finalized evidence attached to any
-- receipt of the chain. Evidence rows keep their own receipt; the per-receipt
-- byte dedupe stays; 343's unmet list and satisfaction work unchanged for the
-- effective receipt of a chain. A reversal ends its chain, so nothing carries
-- into the next recording.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.operation_evidence_chain_rule_met(p_chain uuid,p_rule jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT (SELECT count(*) FROM public.operation_evidence e JOIN public.operation_execution_receipts r ON r.id=e.receipt_id
   WHERE r.chain_id=p_chain AND e.state='finalized' AND e.rule_label=p_rule->>'label' AND e.evidence_kind=p_rule->>'kind')
  >= greatest((p_rule->>'min_count')::int,1)
$$;
CREATE OR REPLACE FUNCTION haven.operation_evidence_rule_met(p_receipt uuid,p_rule jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT haven.operation_evidence_chain_rule_met((SELECT chain_id FROM public.operation_execution_receipts WHERE id=p_receipt),p_rule)
$$;
REVOKE ALL ON FUNCTION haven.operation_evidence_chain_rule_met(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Shared statement validation. The 341 rules for a statement of work are one
-- composite in two steps: the shape of the request (checked before any
-- authority lock, exactly as 341 did) and the statement against the
-- occurrence's own governing versions with a reference instant for the late
-- rule (the server clock for a recording, the chain root's recording instant
-- for a correction). record_operation_work is replaced in place on top of
-- these and behaves exactly as before; the 341 probe is the proof.
-- ---------------------------------------------------------------------------
CREATE TYPE haven.operation_statement AS (
 performed_at_in jsonb,performed timestamptz,performer_kind text,performer_user uuid,performer_vendor uuid,performer_label text,performer_label_in text,
 entry text,reason text,outcome text,vals jsonb,note text,issue_in jsonb,missing jsonb,evidence text,state text);

CREATE FUNCTION haven.operation_work_statement_shape(p_payload jsonb) RETURNS haven.operation_statement
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE s haven.operation_statement; k text; performer jsonb; problem text;
BEGIN
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Record payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF k NOT IN('performed_at','performer','entry_kind','entry_reason','outcome','values','note','issue') THEN RAISE EXCEPTION 'Record payload field is not editable' USING ERRCODE='22023'; END IF;
 END LOOP;
 s.outcome:=p_payload->>'outcome';
 IF s.outcome IS NULL OR s.outcome NOT IN('performed','failed','not_performed') THEN RAISE EXCEPTION 'outcome must be performed, failed or not_performed' USING ERRCODE='22023'; END IF;
 s.performed_at_in:=p_payload->'performed_at';
 IF p_payload ? 'performed_at' AND jsonb_typeof(p_payload->'performed_at')<>'null' AND haven.operation_occurrence_timestamp(p_payload->'performed_at') IS NULL THEN
  RAISE EXCEPTION 'performed_at must be a timestamp' USING ERRCODE='22023'; END IF;
 performer:=coalesce(nullif(p_payload->'performer','null'::jsonb),'{"kind":"self"}'::jsonb);
 IF jsonb_typeof(performer)<>'object' THEN RAISE EXCEPTION 'performer must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(performer) LOOP
  IF k NOT IN('kind','user_id','vendor_id','label') THEN RAISE EXCEPTION 'performer field is not editable' USING ERRCODE='22023'; END IF;
 END LOOP;
 s.performer_kind:=coalesce(performer->>'kind','self');
 IF s.performer_kind NOT IN('self','other_staff','vendor','unknown_historical') THEN RAISE EXCEPTION 'performer kind must be self, other_staff, vendor or unknown_historical' USING ERRCODE='22023'; END IF;
 BEGIN
  s.performer_user:=nullif(performer->>'user_id','')::uuid; s.performer_vendor:=nullif(performer->>'vendor_id','')::uuid;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'performer identifiers must be uuids' USING ERRCODE='22023'; END;
 s.performer_label_in:=performer->>'label';
 s.performer_label:=nullif(btrim(coalesce(performer->>'label','')),'');
 IF length(coalesce(s.performer_label,''))>200 THEN RAISE EXCEPTION 'performer label must be at most 200 characters' USING ERRCODE='22023'; END IF;
 s.entry:=coalesce(p_payload->>'entry_kind','routine');
 IF s.entry NOT IN('routine','late','on_behalf') THEN RAISE EXCEPTION 'entry_kind must be routine, late or on_behalf' USING ERRCODE='22023'; END IF;
 s.reason:=nullif(btrim(coalesce(p_payload->>'entry_reason','')),'');
 IF length(coalesce(s.reason,''))>2000 THEN RAISE EXCEPTION 'entry_reason must be at most 2000 characters' USING ERRCODE='22023'; END IF;
 s.vals:=coalesce(nullif(p_payload->'values','null'::jsonb),'{}'::jsonb);
 IF jsonb_typeof(s.vals)<>'object' THEN RAISE EXCEPTION 'values must be an object' USING ERRCODE='22023'; END IF;
 s.note:=nullif(btrim(coalesce(p_payload->>'note','')),'');
 IF length(coalesce(s.note,''))>4000 THEN RAISE EXCEPTION 'note must be text of at most 4000 characters' USING ERRCODE='22023'; END IF;
 s.issue_in:=nullif(p_payload->'issue','null'::jsonb);
 IF s.issue_in IS NOT NULL THEN
  problem:=haven.operation_issue_payload_problem(s.issue_in);
  IF problem IS NOT NULL THEN RAISE EXCEPTION '%',problem USING ERRCODE='22023'; END IF;
 END IF;
 IF s.outcome='failed' AND s.issue_in IS NULL THEN RAISE EXCEPTION 'A failed outcome requires an issue' USING ERRCODE='22023'; END IF;
 IF s.outcome='not_performed' AND s.reason IS NULL THEN RAISE EXCEPTION 'not_performed requires entry_reason' USING ERRCODE='22023'; END IF;
 RETURN s;
END $$;

-- The fingerprint covers the payload as sent with defaults applied, except the
-- performed instant, which stays as supplied so a replay of a default-now
-- request still matches (341).
CREATE FUNCTION haven.operation_work_canonical(s haven.operation_statement) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('performed_at',s.performed_at_in,'performer',jsonb_build_object('kind',s.performer_kind,'user_id',s.performer_user,'vendor_id',s.performer_vendor,'label',s.performer_label_in),
  'entry_kind',s.entry,'entry_reason',s.reason,'outcome',s.outcome,'values',s.vals,'note',s.note,'issue',s.issue_in)
$$;

-- p_chain is NULL for a recording (no evidence can exist before the receipt);
-- for a correction it is the chain whose finalized evidence counts, and the
-- reference instant is the chain root's recording: a corrected performed time
-- never follows it. p_default is the performed instant when the statement
-- omits one: the server clock for a recording, the corrected receipt's own
-- performed instant for a correction, so a correction never moves it silently.
CREATE FUNCTION haven.operation_work_statement(s haven.operation_statement,t public.operation_task_instances,v public.operation_requirement_versions,fr public.operation_facility_requirements,p_chain uuid,p_reference timestamptz,p_default timestamptz,p_now timestamptz) RETURNS haven.operation_statement
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE vendor_name text; problems text[]; applicable jsonb;
BEGIN
 s.performed:=coalesce(haven.operation_occurrence_timestamp(s.performed_at_in),p_default);
 IF s.performed>p_reference+interval '2 minutes' THEN
  IF p_chain IS NULL THEN RAISE EXCEPTION 'Performed time cannot be in the future' USING ERRCODE='22023'; END IF;
  RAISE EXCEPTION 'Corrected performed time cannot be after the original recording' USING ERRCODE='22023';
 END IF;
 IF s.performed<p_reference-interval '15 minutes' AND s.entry<>'late' THEN RAISE EXCEPTION 'Work performed earlier than fifteen minutes ago must be entered as late with a reason' USING ERRCODE='22023'; END IF;
 IF s.performer_kind<>'self' AND s.entry='routine' THEN RAISE EXCEPTION 'Work performed by someone else must be entered on behalf with a reason' USING ERRCODE='22023'; END IF;
 IF s.entry<>'routine' AND s.reason IS NULL THEN RAISE EXCEPTION 'entry_reason is required for late or on-behalf entries' USING ERRCODE='22023'; END IF;
 IF s.performer_kind='unknown_historical' AND s.entry<>'late' THEN RAISE EXCEPTION 'An unknown historical performer requires a late entry' USING ERRCODE='22023'; END IF;
 IF s.performer_kind IN('self','other_staff') AND s.performer_label IS NOT NULL THEN RAISE EXCEPTION 'A staff performer carries no label' USING ERRCODE='22023'; END IF;
 IF s.performer_kind='self' THEN
  IF s.performer_user IS NOT NULL OR s.performer_vendor IS NOT NULL THEN RAISE EXCEPTION 'A self performer carries no identifier' USING ERRCODE='22023'; END IF;
 ELSIF s.performer_kind='other_staff' THEN
  IF s.performer_user IS NULL OR s.performer_vendor IS NOT NULL THEN RAISE EXCEPTION 'other_staff requires user_id' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.user_profiles p JOIN public.user_facility_access g ON g.user_id=p.id AND g.facility_id=t.facility_id AND g.revoked_at IS NULL
   AND (g.operation_expires_at IS NULL OR g.operation_expires_at>p_now)
   WHERE p.id=s.performer_user AND p.organization_id=t.organization_id AND p.is_active AND p.deleted_at IS NULL FOR SHARE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'Performer is not current staff at this site' USING ERRCODE='22023'; END IF;
 ELSIF s.performer_kind='vendor' THEN
  IF s.performer_vendor IS NULL OR s.performer_user IS NOT NULL THEN RAISE EXCEPTION 'vendor requires vendor_id' USING ERRCODE='22023'; END IF;
  SELECT vv.name INTO vendor_name FROM public.vendors vv JOIN public.vendor_facilities vf ON vf.vendor_id=vv.id AND vf.facility_id=t.facility_id AND vf.deleted_at IS NULL
   WHERE vv.id=s.performer_vendor AND vv.organization_id=t.organization_id AND vv.deleted_at IS NULL FOR SHARE OF vv;
  IF NOT FOUND THEN RAISE EXCEPTION 'Performer vendor is not linked to this site' USING ERRCODE='22023'; END IF;
  s.performer_label:=coalesce(s.performer_label,left(vendor_name,200));
 ELSE
  IF s.performer_user IS NOT NULL OR s.performer_vendor IS NOT NULL OR s.performer_label IS NULL THEN RAISE EXCEPTION 'An unknown historical performer requires a label and no identifier' USING ERRCODE='22023'; END IF;
 END IF;
 -- Values and evidence against the occurrence's own governing versions.
 problems:=haven.operation_receipt_values_problems(coalesce(fr.local_required_inputs,v.required_inputs),s.vals);
 IF coalesce(cardinality(problems),0)>0 THEN RAISE EXCEPTION 'Recorded values are invalid: %',problems[1] USING ERRCODE='22023'; END IF;
 applicable:=haven.operation_receipt_missing_evidence(coalesce(fr.local_required_evidence,v.required_evidence),s.outcome);
 IF p_chain IS NULL THEN s.missing:=applicable;
 ELSE s.missing:=coalesce((SELECT jsonb_agg(x ORDER BY x->>'label') FROM jsonb_array_elements(applicable) x WHERE NOT haven.operation_evidence_chain_rule_met(p_chain,x)),'[]'::jsonb); END IF;
 s.evidence:=CASE WHEN jsonb_array_length(s.missing)>0 THEN 'missing' WHEN jsonb_array_length(applicable)>0 THEN 'complete' ELSE 'not_required' END;
 s.state:=CASE WHEN s.outcome='failed' THEN 'failed' WHEN s.outcome='not_performed' THEN 'not_performed' WHEN s.evidence='missing' THEN 'performed_missing_evidence'
  WHEN v.review_required THEN 'awaiting_verification' ELSE 'completed' END;
 RETURN s;
END $$;

-- A conflict that names the current receipt: the route returns it as a
-- conflict carrying current_receipt_id and current_receipt_revision.
CREATE FUNCTION haven.operation_receipt_conflict(r public.operation_execution_receipts) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Receipt changed since it was read' USING ERRCODE='P0001',DETAIL='current_receipt_id='||r.id||';current_receipt_revision='||r.revision; END $$;
CREATE FUNCTION haven.operation_correction_reply(r public.operation_execution_receipts,prev public.operation_execution_receipts,t public.operation_task_instances,i public.operation_issues,p_superseded_review uuid,p_replayed boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 -- Correction: { receipt, corrected, occurrence, issue, verification_superseded_receipt_id, replayed }.
 -- Reversal:   { receipt, reversed, occurrence, verification_superseded_receipt_id, replayed }.
 SELECT CASE WHEN r.receipt_kind='reversal' THEN
  jsonb_build_object('receipt',to_jsonb(r),'reversed',to_jsonb(prev),
   'occurrence',jsonb_build_object('id',t.id,'status',t.status,'execution_state',t.execution_state,'occurrence_revision',t.occurrence_revision,'performed_at',t.performed_at),
   'verification_superseded_receipt_id',p_superseded_review,'replayed',p_replayed)
 ELSE
  jsonb_build_object('receipt',to_jsonb(r),'corrected',to_jsonb(prev),
   'occurrence',jsonb_build_object('id',t.id,'status',t.status,'execution_state',t.execution_state,'occurrence_revision',t.occurrence_revision,'performed_at',t.performed_at),
   'issue',CASE WHEN i.id IS NULL THEN NULL ELSE to_jsonb(i) END,'verification_superseded_receipt_id',p_superseded_review,'replayed',p_replayed)
 END
$$;
REVOKE ALL ON FUNCTION haven.operation_work_statement_shape(jsonb),haven.operation_work_canonical(haven.operation_statement),
 haven.operation_work_statement(haven.operation_statement,public.operation_task_instances,public.operation_requirement_versions,public.operation_facility_requirements,uuid,timestamptz,timestamptz,timestamptz),
 haven.operation_receipt_conflict(public.operation_execution_receipts),
 haven.operation_correction_reply(public.operation_execution_receipts,public.operation_execution_receipts,public.operation_task_instances,public.operation_issues,uuid,boolean)
 FROM PUBLIC,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Record work (session): the 341 command on the shared statement; behaviour
-- unchanged (order of checks, messages, lock order, fingerprint, writes).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.record_operation_work(p_task uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 t public.operation_task_instances; v public.operation_requirement_versions; fr public.operation_facility_requirements; s haven.operation_statement; now_at timestamptz;
 roles public.app_role[]; canonical jsonb; request_hash text; existing public.operation_execution_receipts; r public.operation_execution_receipts;
 i public.operation_issues; event text; new_status text;
BEGIN
 IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'A request key is required' USING ERRCODE='22023'; END IF;
 s:=haven.operation_work_statement_shape(p_payload);
 -- Current authority first: the occurrence, its subject, the actor's grants
 -- and session are locked and the actor must hold recording authority
 -- (COL-133); the recorder list of the governing versions is checked after
 -- the replay lookup so a replay stays idempotent when validation drifts.
 PERFORM haven.lock_operation_work_authority(p_task,NULL);
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 IF t.occurrence_kind IS NULL THEN RAISE EXCEPTION 'Legacy tasks use the existing completion command' USING ERRCODE='22023'; END IF;
 SELECT * INTO v FROM public.operation_requirement_versions WHERE id=t.requirement_version_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Occurrence has no governing requirement version' USING ERRCODE='P0001'; END IF;
 SELECT * INTO fr FROM public.operation_facility_requirements WHERE id=t.facility_requirement_id FOR SHARE;
 roles:=coalesce(fr.local_allowed_recorder_roles,v.allowed_recorder_roles,'{}');
 canonical:=haven.operation_work_canonical(s);
 request_hash:=encode(sha256(convert_to(jsonb_build_object('task',p_task,'recorder',auth.uid(),'payload',canonical)::text,'UTF8')),'hex');
 SELECT * INTO existing FROM public.operation_execution_receipts WHERE request_key=p_request_key;
 IF FOUND THEN
  IF existing.request_hash=request_hash AND existing.recorder_id=auth.uid() AND existing.task_instance_id=p_task THEN
   SELECT * INTO i FROM public.operation_issues WHERE id=existing.issue_id;
   RETURN haven.operation_receipt_reply(existing,t,i,true);
  END IF;
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END IF;
 SELECT * INTO existing FROM public.operation_execution_receipts WHERE task_instance_id=t.id AND receipt_kind='performance' AND superseded_by_receipt_id IS NULL;
 IF FOUND THEN RAISE EXCEPTION 'Work is already recorded for this occurrence' USING ERRCODE='23505',DETAIL='current_receipt_id='||existing.id; END IF;
 IF t.status='cancelled' OR t.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Occurrence is cancelled' USING ERRCODE='P0001'; END IF;
 IF t.status NOT IN('pending','in_progress','missed','deferred') OR t.execution_state<>'none' THEN RAISE EXCEPTION 'Occurrence cannot be recorded from this state' USING ERRCODE='P0001'; END IF;
 PERFORM haven.lock_operation_work_authority(p_task,roles);
 now_at:=clock_timestamp();
 s:=haven.operation_work_statement(s,t,v,fr,NULL,now_at,now_at,now_at);
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 BEGIN
  IF s.issue_in IS NOT NULL THEN
   INSERT INTO public.operation_issues(organization_id,facility_id,activity_id,subject_id,authority_class,task_instance_id,issue_kind,summary,severity,reported_by,reported_role,reported_at,request_key,request_hash)
   VALUES(t.organization_id,t.facility_id,t.activity_id,t.subject_id,t.authority_class,t.id,coalesce(s.issue_in->>'kind',CASE WHEN s.outcome='failed' THEN 'failed_result' ELSE 'problem' END),
    btrim(s.issue_in->>'summary'),coalesce(nullif(s.issue_in->>'severity',''),'normal'),auth.uid(),haven.app_role()::text,now_at,p_request_key||'|receipt',request_hash) RETURNING * INTO i;
  END IF;
  INSERT INTO public.operation_execution_receipts(organization_id,facility_id,task_instance_id,activity_id,subject_id,authority_class,requirement_version_id,facility_requirement_id,receipt_kind,
   recorder_id,recorder_role,recorded_at,performed_at,performer_kind,performer_user_id,performer_vendor_id,performer_label,entry_kind,entry_reason,outcome,values,note,
   evidence_status,missing_evidence,completion_state,issue_id,request_key,request_hash,revision)
  VALUES(t.organization_id,t.facility_id,t.id,t.activity_id,t.subject_id,t.authority_class,v.id,fr.id,'performance',
   auth.uid(),haven.app_role()::text,now_at,s.performed,s.performer_kind,s.performer_user,s.performer_vendor,s.performer_label,s.entry,s.reason,s.outcome,s.vals,s.note,
   s.evidence,s.missing,s.state,i.id,p_request_key,request_hash,haven.operation_occurrence_revision()) RETURNING * INTO r;
 EXCEPTION WHEN unique_violation THEN
  -- A concurrent commit won the occurrence or the key between our read and our insert.
  SELECT * INTO existing FROM public.operation_execution_receipts WHERE task_instance_id=t.id AND receipt_kind='performance' AND superseded_by_receipt_id IS NULL;
  IF FOUND THEN RAISE EXCEPTION 'Work is already recorded for this occurrence' USING ERRCODE='23505',DETAIL='current_receipt_id='||existing.id; END IF;
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END;
 IF i.id IS NOT NULL THEN UPDATE public.operation_issues SET receipt_id=r.id WHERE id=i.id RETURNING * INTO i; END IF;
 new_status:=CASE WHEN s.state='completed' THEN 'completed' ELSE 'in_progress' END;
 UPDATE public.operation_task_instances SET status=new_status,execution_state=s.state,effective_receipt_id=r.id,performed_at=s.performed,
  signed_by=auth.uid(),signed_at=now_at,
  completed_at=CASE WHEN s.state='completed' THEN now_at END,
  verified_by=CASE WHEN s.state='completed' THEN auth.uid() END,verified_at=CASE WHEN s.state='completed' THEN now_at END,
  sla_met=CASE WHEN t.due_at IS NULL THEN NULL ELSE s.performed<=coalesce(t.grace_ends_at,t.due_at) END,
  completion_notes=s.note,updated_at=now_at,updated_by=auth.uid()
 WHERE id=t.id;
 event:=CASE s.state WHEN 'completed' THEN 'completed' WHEN 'awaiting_verification' THEN 'signed' ELSE 'recorded' END;
 INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
 VALUES(t.organization_id,t.facility_id,t.id,event,t.status,new_status,auth.uid(),haven.app_role()::text,s.note,
  jsonb_build_object('receipt_id',r.id,'completion_state',s.state,'outcome',s.outcome,'entry_kind',s.entry,'performer_kind',s.performer_kind,'performed_at',s.performed,'recorded_at',now_at,
   'evidence_status',s.evidence,'missing_evidence',s.missing,'issue_id',i.id,'request_key',p_request_key,'request_hash',request_hash,'receipt_version',1));
 IF i.id IS NOT NULL THEN
  INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
  VALUES(t.organization_id,t.facility_id,t.id,'issue_reported',new_status,new_status,auth.uid(),haven.app_role()::text,i.summary,
   jsonb_build_object('issue_id',i.id,'issue_kind',i.issue_kind,'severity',i.severity,'receipt_id',r.id));
 END IF;
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_work_authority(p_task,roles);
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 RETURN haven.operation_receipt_reply(r,t,i,false);
END $$;

-- ---------------------------------------------------------------------------
-- Correct work (session): a full restatement that supersedes the exact
-- receipt the corrector read. Order as 341: shape → lock (NULL) → managed →
-- replay → the effective receipt must be the expected one at the expected
-- revision → not cancelled → lock with the governing recorder list →
-- statement against the chain root's recording instant → write under the
-- token (issue, supersession, correction, review supersession, occurrence
-- projection, audit) → re-lock → reply.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.correct_operation_work(p_task uuid,p_request_key text,p_expected_receipt_id uuid,p_expected_receipt_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 t public.operation_task_instances; v public.operation_requirement_versions; fr public.operation_facility_requirements; s haven.operation_statement; now_at timestamptz; reason text; payload jsonb;
 roles public.app_role[]; canonical jsonb; request_hash text; existing public.operation_execution_receipts; perf public.operation_execution_receipts; ver public.operation_execution_receipts;
 r public.operation_execution_receipts; i public.operation_issues; root_at timestamptz; new_id uuid; new_status text; superseded_review uuid;
BEGIN
 IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'A request key is required' USING ERRCODE='22023'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Correction payload must be an object' USING ERRCODE='22023'; END IF;
 IF p_expected_receipt_id IS NULL THEN RAISE EXCEPTION 'An expected receipt is required' USING ERRCODE='22023'; END IF;
 IF p_expected_receipt_revision IS NULL OR p_expected_receipt_revision !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'An expected receipt revision is required' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'A correction reason is required' USING ERRCODE='22023'; END IF;
 reason:=nullif(btrim(p_payload->>'reason'),'');
 IF reason IS NULL OR length(reason)>2000 THEN RAISE EXCEPTION 'reason must be text of at most 2000 characters' USING ERRCODE='22023'; END IF;
 payload:=p_payload-'reason';
 -- A non-routine entry without its own reason takes the correction reason.
 IF coalesce(payload->>'entry_kind','routine')<>'routine' AND nullif(btrim(coalesce(payload->>'entry_reason','')),'') IS NULL THEN payload:=payload||jsonb_build_object('entry_reason',reason); END IF;
 s:=haven.operation_work_statement_shape(payload);
 PERFORM haven.lock_operation_work_authority(p_task,NULL);
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 IF t.occurrence_kind IS NULL THEN RAISE EXCEPTION 'Legacy tasks use the existing completion command' USING ERRCODE='22023'; END IF;
 SELECT * INTO v FROM public.operation_requirement_versions WHERE id=t.requirement_version_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Occurrence has no governing requirement version' USING ERRCODE='P0001'; END IF;
 SELECT * INTO fr FROM public.operation_facility_requirements WHERE id=t.facility_requirement_id FOR SHARE;
 roles:=coalesce(fr.local_allowed_recorder_roles,v.allowed_recorder_roles,'{}');
 canonical:=jsonb_build_object('command','correct','expected_receipt_id',p_expected_receipt_id,'expected_receipt_revision',p_expected_receipt_revision,'reason',reason,'statement',haven.operation_work_canonical(s));
 request_hash:=encode(sha256(convert_to(jsonb_build_object('task',p_task,'recorder',auth.uid(),'payload',canonical)::text,'UTF8')),'hex');
 SELECT * INTO existing FROM public.operation_execution_receipts WHERE request_key=p_request_key;
 IF FOUND THEN
  IF existing.request_hash=request_hash AND existing.recorder_id=auth.uid() AND existing.task_instance_id=p_task AND existing.corrects_receipt_id IS NOT NULL THEN
   SELECT * INTO perf FROM public.operation_execution_receipts WHERE id=existing.corrects_receipt_id;
   SELECT * INTO i FROM public.operation_issues WHERE id=existing.issue_id;
   SELECT id INTO superseded_review FROM public.operation_execution_receipts WHERE receipt_kind='verification' AND superseded_by_receipt_id=existing.id;
   RETURN haven.operation_correction_reply(existing,perf,t,i,superseded_review,true);
  END IF;
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END IF;
 SELECT * INTO perf FROM public.operation_execution_receipts WHERE task_instance_id=t.id AND receipt_kind='performance' AND superseded_by_receipt_id IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Occurrence has no recorded work' USING ERRCODE='P0001'; END IF;
 IF perf.id<>p_expected_receipt_id OR perf.revision<>p_expected_receipt_revision THEN PERFORM haven.operation_receipt_conflict(perf); END IF;
 IF t.status='cancelled' OR t.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Occurrence is cancelled' USING ERRCODE='P0001'; END IF;
 PERFORM haven.lock_operation_work_authority(p_task,roles);
 now_at:=clock_timestamp();
 SELECT * INTO perf FROM public.operation_execution_receipts WHERE id=perf.id FOR UPDATE;
 SELECT recorded_at INTO root_at FROM public.operation_execution_receipts WHERE id=perf.chain_id;
 s:=haven.operation_work_statement(s,t,v,fr,perf.chain_id,root_at,perf.performed_at,now_at);
 SELECT * INTO ver FROM public.operation_execution_receipts WHERE task_instance_id=t.id AND receipt_kind='verification' AND superseded_by_receipt_id IS NULL FOR UPDATE;
 new_id:=gen_random_uuid();
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 SET CONSTRAINTS public.operation_execution_receipts_superseded_by_receipt_id_fkey DEFERRED;
 BEGIN
  IF s.issue_in IS NOT NULL THEN
   INSERT INTO public.operation_issues(organization_id,facility_id,activity_id,subject_id,authority_class,task_instance_id,issue_kind,summary,severity,reported_by,reported_role,reported_at,request_key,request_hash)
   VALUES(t.organization_id,t.facility_id,t.activity_id,t.subject_id,t.authority_class,t.id,coalesce(s.issue_in->>'kind',CASE WHEN s.outcome='failed' THEN 'failed_result' ELSE 'problem' END),
    btrim(s.issue_in->>'summary'),coalesce(nullif(s.issue_in->>'severity',''),'normal'),auth.uid(),haven.app_role()::text,now_at,p_request_key||'|receipt',request_hash) RETURNING * INTO i;
  END IF;
  UPDATE public.operation_execution_receipts SET superseded_by_receipt_id=new_id,superseded_at=now_at WHERE id=perf.id;
  INSERT INTO public.operation_execution_receipts(id,organization_id,facility_id,task_instance_id,activity_id,subject_id,authority_class,requirement_version_id,facility_requirement_id,receipt_kind,
   recorder_id,recorder_role,recorded_at,performed_at,performer_kind,performer_user_id,performer_vendor_id,performer_label,entry_kind,entry_reason,outcome,values,note,
   evidence_status,missing_evidence,completion_state,issue_id,request_key,request_hash,revision,chain_id,corrects_receipt_id,correction_reason,correction_seq)
  VALUES(new_id,t.organization_id,t.facility_id,t.id,t.activity_id,t.subject_id,t.authority_class,v.id,fr.id,'performance',
   auth.uid(),haven.app_role()::text,now_at,s.performed,s.performer_kind,s.performer_user,s.performer_vendor,s.performer_label,s.entry,s.reason,s.outcome,s.vals,s.note,
   s.evidence,s.missing,s.state,i.id,p_request_key,request_hash,haven.operation_occurrence_revision(),perf.chain_id,perf.id,reason,perf.correction_seq+1) RETURNING * INTO r;
 EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END;
 -- Both rows exist: check the pointer now and leave nothing pending for commit.
 SET CONSTRAINTS public.operation_execution_receipts_superseded_by_receipt_id_fkey IMMEDIATE;
 IF ver.id IS NOT NULL AND ver.verifies_receipt_id=perf.id THEN
  UPDATE public.operation_execution_receipts SET superseded_by_receipt_id=r.id,superseded_at=now_at WHERE id=ver.id;
  superseded_review:=ver.id;
 END IF;
 IF i.id IS NOT NULL THEN UPDATE public.operation_issues SET receipt_id=r.id WHERE id=i.id RETURNING * INTO i; END IF;
 new_status:=CASE WHEN s.state='completed' THEN 'completed' ELSE 'in_progress' END;
 UPDATE public.operation_task_instances SET status=new_status,execution_state=s.state,effective_receipt_id=r.id,performed_at=s.performed,
  signed_by=auth.uid(),signed_at=now_at,
  verification_receipt_id=CASE WHEN superseded_review IS NULL THEN verification_receipt_id END,
  second_sign_by=CASE WHEN superseded_review IS NULL THEN second_sign_by END,second_signed_at=CASE WHEN superseded_review IS NULL THEN second_signed_at END,
  completed_at=CASE WHEN s.state='completed' THEN now_at END,
  verified_by=CASE WHEN s.state='completed' THEN auth.uid() END,verified_at=CASE WHEN s.state='completed' THEN now_at END,
  sla_met=CASE WHEN t.due_at IS NULL THEN NULL ELSE s.performed<=coalesce(t.grace_ends_at,t.due_at) END,
  completion_notes=s.note,updated_at=now_at,updated_by=auth.uid()
 WHERE id=t.id;
 INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
 VALUES(t.organization_id,t.facility_id,t.id,'corrected',t.status,new_status,auth.uid(),haven.app_role()::text,reason,
  jsonb_build_object('receipt_id',r.id,'corrected_receipt_id',perf.id,'chain_id',r.chain_id,'correction_seq',r.correction_seq,'reason',reason,'completion_state',s.state,'outcome',s.outcome,
   'entry_kind',s.entry,'performer_kind',s.performer_kind,'performed_at',s.performed,'recorded_at',now_at,'evidence_status',s.evidence,'missing_evidence',s.missing,
   'previous_execution_state',t.execution_state,'previous_status',t.status,'previous_performed_at',t.performed_at,'superseded_verification_receipt_id',superseded_review,
   'issue_id',i.id,'request_key',p_request_key,'request_hash',request_hash,'receipt_version',1));
 IF s.state='completed' THEN
  INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
  VALUES(t.organization_id,t.facility_id,t.id,'completed',t.status,new_status,auth.uid(),haven.app_role()::text,s.note,
   jsonb_build_object('receipt_id',r.id,'corrected_receipt_id',perf.id,'completion_state',s.state,'correction',true));
 END IF;
 IF i.id IS NOT NULL THEN
  INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
  VALUES(t.organization_id,t.facility_id,t.id,'issue_reported',new_status,new_status,auth.uid(),haven.app_role()::text,i.summary,
   jsonb_build_object('issue_id',i.id,'issue_kind',i.issue_kind,'severity',i.severity,'receipt_id',r.id));
 END IF;
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_work_authority(p_task,roles);
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 SELECT * INTO perf FROM public.operation_execution_receipts WHERE id=perf.id;
 RETURN haven.operation_correction_reply(r,perf,t,i,superseded_review,false);
END $$;

-- ---------------------------------------------------------------------------
-- Reverse work (session): a receipt of kind reversal supersedes the effective
-- performance receipt and its review; the occurrence returns to unrecorded
-- (pending, or missed when its grace end or deadline has passed) and can be
-- recorded again as a new chain. Same locks, replay and conflict rule.
-- ---------------------------------------------------------------------------
CREATE FUNCTION haven.reverse_operation_work(p_task uuid,p_request_key text,p_expected_receipt_id uuid,p_expected_receipt_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 t public.operation_task_instances; v public.operation_requirement_versions; fr public.operation_facility_requirements; k text; now_at timestamptz; reason text;
 roles public.app_role[]; request_hash text; existing public.operation_execution_receipts; perf public.operation_execution_receipts; ver public.operation_execution_receipts;
 r public.operation_execution_receipts; new_id uuid; new_status text; superseded_review uuid;
BEGIN
 IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'A request key is required' USING ERRCODE='22023'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Reversal payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF k<>'reason' THEN RAISE EXCEPTION 'Reversal payload field is not editable' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF p_expected_receipt_id IS NULL THEN RAISE EXCEPTION 'An expected receipt is required' USING ERRCODE='22023'; END IF;
 IF p_expected_receipt_revision IS NULL OR p_expected_receipt_revision !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'An expected receipt revision is required' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'A reversal reason is required' USING ERRCODE='22023'; END IF;
 reason:=nullif(btrim(p_payload->>'reason'),'');
 IF reason IS NULL OR length(reason)>2000 THEN RAISE EXCEPTION 'reason must be text of at most 2000 characters' USING ERRCODE='22023'; END IF;
 PERFORM haven.lock_operation_work_authority(p_task,NULL);
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 IF t.occurrence_kind IS NULL THEN RAISE EXCEPTION 'Legacy tasks use the existing completion command' USING ERRCODE='22023'; END IF;
 SELECT * INTO v FROM public.operation_requirement_versions WHERE id=t.requirement_version_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Occurrence has no governing requirement version' USING ERRCODE='P0001'; END IF;
 SELECT * INTO fr FROM public.operation_facility_requirements WHERE id=t.facility_requirement_id FOR SHARE;
 roles:=coalesce(fr.local_allowed_recorder_roles,v.allowed_recorder_roles,'{}');
 request_hash:=encode(sha256(convert_to(jsonb_build_object('task',p_task,'recorder',auth.uid(),'payload',jsonb_build_object('command','reverse','expected_receipt_id',p_expected_receipt_id,'expected_receipt_revision',p_expected_receipt_revision,'reason',reason))::text,'UTF8')),'hex');
 SELECT * INTO existing FROM public.operation_execution_receipts WHERE request_key=p_request_key;
 IF FOUND THEN
  IF existing.request_hash=request_hash AND existing.recorder_id=auth.uid() AND existing.task_instance_id=p_task AND existing.receipt_kind='reversal' THEN
   SELECT * INTO perf FROM public.operation_execution_receipts WHERE id=existing.corrects_receipt_id;
   SELECT id INTO superseded_review FROM public.operation_execution_receipts WHERE receipt_kind='verification' AND superseded_by_receipt_id=existing.id;
   RETURN haven.operation_correction_reply(existing,perf,t,NULL::public.operation_issues,superseded_review,true);
  END IF;
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END IF;
 SELECT * INTO perf FROM public.operation_execution_receipts WHERE task_instance_id=t.id AND receipt_kind='performance' AND superseded_by_receipt_id IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Occurrence has no recorded work' USING ERRCODE='P0001'; END IF;
 IF perf.id<>p_expected_receipt_id OR perf.revision<>p_expected_receipt_revision THEN PERFORM haven.operation_receipt_conflict(perf); END IF;
 IF t.status='cancelled' OR t.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Occurrence is cancelled' USING ERRCODE='P0001'; END IF;
 PERFORM haven.lock_operation_work_authority(p_task,roles);
 now_at:=clock_timestamp();
 SELECT * INTO perf FROM public.operation_execution_receipts WHERE id=perf.id FOR UPDATE;
 SELECT * INTO ver FROM public.operation_execution_receipts WHERE task_instance_id=t.id AND receipt_kind='verification' AND superseded_by_receipt_id IS NULL FOR UPDATE;
 new_id:=gen_random_uuid();
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 SET CONSTRAINTS public.operation_execution_receipts_superseded_by_receipt_id_fkey DEFERRED;
 BEGIN
  UPDATE public.operation_execution_receipts SET superseded_by_receipt_id=new_id,superseded_at=now_at WHERE id=perf.id;
  INSERT INTO public.operation_execution_receipts(id,organization_id,facility_id,task_instance_id,activity_id,subject_id,authority_class,requirement_version_id,facility_requirement_id,receipt_kind,
   recorder_id,recorder_role,recorded_at,performed_at,performer_kind,entry_kind,outcome,values,note,evidence_status,missing_evidence,completion_state,request_key,request_hash,revision,
   chain_id,corrects_receipt_id,correction_reason,correction_seq)
  VALUES(new_id,t.organization_id,t.facility_id,t.id,t.activity_id,t.subject_id,t.authority_class,v.id,fr.id,'reversal',
   auth.uid(),haven.app_role()::text,now_at,now_at,'self','routine',NULL,'{}'::jsonb,NULL,'not_required','[]'::jsonb,'reversed',p_request_key,request_hash,haven.operation_occurrence_revision(),
   perf.chain_id,perf.id,reason,perf.correction_seq+1) RETURNING * INTO r;
 EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END;
 SET CONSTRAINTS public.operation_execution_receipts_superseded_by_receipt_id_fkey IMMEDIATE;
 IF ver.id IS NOT NULL AND ver.verifies_receipt_id=perf.id THEN
  UPDATE public.operation_execution_receipts SET superseded_by_receipt_id=r.id,superseded_at=now_at WHERE id=ver.id;
  superseded_review:=ver.id;
 END IF;
 new_status:=CASE WHEN coalesce(t.grace_ends_at,t.due_at)<now_at THEN 'missed' ELSE 'pending' END;
 UPDATE public.operation_task_instances SET status=new_status,execution_state='none',effective_receipt_id=NULL,verification_receipt_id=NULL,performed_at=NULL,
  completed_at=NULL,signed_by=NULL,signed_at=NULL,second_sign_by=NULL,second_signed_at=NULL,verified_by=NULL,verified_at=NULL,sla_met=NULL,completion_notes=NULL,
  missed_at=CASE WHEN new_status='missed' THEN coalesce(missed_at,now_at) ELSE missed_at END,updated_at=now_at,updated_by=auth.uid()
 WHERE id=t.id;
 INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
 VALUES(t.organization_id,t.facility_id,t.id,'reversed',t.status,new_status,auth.uid(),haven.app_role()::text,reason,
  jsonb_build_object('receipt_id',r.id,'reversed_receipt_id',perf.id,'chain_id',r.chain_id,'correction_seq',r.correction_seq,'reason',reason,'recorded_at',now_at,
   'previous_execution_state',t.execution_state,'previous_status',t.status,'previous_performed_at',t.performed_at,'superseded_verification_receipt_id',superseded_review,
   'request_key',p_request_key,'request_hash',request_hash,'receipt_version',1));
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_work_authority(p_task,roles);
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 SELECT * INTO perf FROM public.operation_execution_receipts WHERE id=perf.id;
 RETURN haven.operation_correction_reply(r,perf,t,NULL::public.operation_issues,superseded_review,false);
END $$;

-- ---------------------------------------------------------------------------
-- Verify work keeps its 343 body and binds the review to the exact receipt
-- and revision it reviewed. receipt_id and receipt_revision, when supplied,
-- must name the effective performance receipt at its current revision; the
-- route requires them, the database tolerates their absence.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION haven.verify_operation_work(p_task uuid,p_request_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.operation_task_instances; v public.operation_requirement_versions; fr public.operation_facility_requirements; k text; note text; now_at timestamptz; expected_id uuid; expected_revision text;
 perf public.operation_execution_receipts; existing public.operation_execution_receipts; r public.operation_execution_receipts; i public.operation_issues; request_hash text; missing jsonb;
BEGIN
 IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN RAISE EXCEPTION 'A request key is required' USING ERRCODE='22023'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Verification payload must be an object' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT * FROM jsonb_object_keys(p_payload) LOOP
  IF k NOT IN('decision','note','receipt_id','receipt_revision') THEN RAISE EXCEPTION 'Verification payload field is not editable' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF p_payload->>'decision' IS DISTINCT FROM 'verified' THEN RAISE EXCEPTION 'decision must be verified' USING ERRCODE='22023'; END IF;
 note:=nullif(btrim(coalesce(p_payload->>'note','')),'');
 IF length(coalesce(note,''))>4000 THEN RAISE EXCEPTION 'note must be text of at most 4000 characters' USING ERRCODE='22023'; END IF;
 IF p_payload ? 'receipt_id' AND jsonb_typeof(p_payload->'receipt_id')<>'null' THEN
  IF jsonb_typeof(p_payload->'receipt_id')<>'string' THEN RAISE EXCEPTION 'receipt_id must be a uuid' USING ERRCODE='22023'; END IF;
  BEGIN expected_id:=(p_payload->>'receipt_id')::uuid; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'receipt_id must be a uuid' USING ERRCODE='22023'; END;
 END IF;
 IF p_payload ? 'receipt_revision' AND jsonb_typeof(p_payload->'receipt_revision')<>'null' THEN
  expected_revision:=p_payload->>'receipt_revision';
  IF jsonb_typeof(p_payload->'receipt_revision')<>'string' OR expected_revision !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'receipt_revision must be 64 hex characters' USING ERRCODE='22023'; END IF;
 END IF;
 PERFORM haven.lock_operation_work_authority(p_task,NULL);
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 IF t.occurrence_kind IS NULL THEN RAISE EXCEPTION 'Legacy tasks use the existing completion command' USING ERRCODE='22023'; END IF;
 SELECT * INTO v FROM public.operation_requirement_versions WHERE id=t.requirement_version_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Occurrence has no governing requirement version' USING ERRCODE='P0001'; END IF;
 SELECT * INTO fr FROM public.operation_facility_requirements WHERE id=t.facility_requirement_id FOR SHARE;
 request_hash:=encode(sha256(convert_to(jsonb_build_object('task',p_task,'recorder',auth.uid(),'payload',jsonb_build_object('decision','verified','note',note,'receipt_id',expected_id,'receipt_revision',expected_revision))::text,'UTF8')),'hex');
 SELECT * INTO existing FROM public.operation_execution_receipts WHERE request_key=p_request_key;
 IF FOUND THEN
  IF existing.request_hash=request_hash AND existing.recorder_id=auth.uid() AND existing.task_instance_id=p_task THEN RETURN haven.operation_receipt_reply(existing,t,NULL::public.operation_issues,true); END IF;
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END IF;
 IF t.status='cancelled' OR t.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Occurrence is cancelled' USING ERRCODE='P0001'; END IF;
 PERFORM haven.lock_operation_work_authority(p_task,coalesce(v.allowed_reviewer_roles,'{}'));
 now_at:=clock_timestamp();
 SELECT * INTO perf FROM public.operation_execution_receipts WHERE task_instance_id=t.id AND receipt_kind='performance' AND superseded_by_receipt_id IS NULL FOR SHARE;
 IF NOT FOUND OR t.execution_state<>'awaiting_verification' THEN RAISE EXCEPTION 'Occurrence is not awaiting verification' USING ERRCODE='P0001'; END IF;
 -- COL-145: the review binds to the receipt the reviewer read.
 IF (expected_id IS NOT NULL AND expected_id<>perf.id) OR (expected_revision IS NOT NULL AND expected_revision<>perf.revision) THEN PERFORM haven.operation_receipt_conflict(perf); END IF;
 IF auth.uid()=perf.recorder_id OR auth.uid() IS NOT DISTINCT FROM perf.performer_user_id THEN
  RAISE EXCEPTION 'A different authorized staff member must verify this task' USING ERRCODE='42501'; END IF;
 -- COL-143: finalized evidence satisfies the receipt's rules.
 missing:=CASE WHEN perf.evidence_status_current='complete' THEN '[]'::jsonb ELSE haven.operation_receipt_missing_evidence(coalesce(fr.local_required_evidence,v.required_evidence),perf.outcome) END;
 IF jsonb_array_length(missing)>0 THEN RAISE EXCEPTION 'Required evidence is missing' USING ERRCODE='P0001'; END IF;
 PERFORM set_config('haven.operation_occurrence_command',haven.operation_occurrence_token(),true);
 BEGIN
  INSERT INTO public.operation_execution_receipts(organization_id,facility_id,task_instance_id,activity_id,subject_id,authority_class,requirement_version_id,facility_requirement_id,receipt_kind,
   recorder_id,recorder_role,recorded_at,performed_at,performer_kind,entry_kind,outcome,values,note,evidence_status,missing_evidence,completion_state,request_key,request_hash,revision,verifies_receipt_id,verified_receipt_revision)
  VALUES(t.organization_id,t.facility_id,t.id,t.activity_id,t.subject_id,t.authority_class,v.id,fr.id,'verification',
   auth.uid(),haven.app_role()::text,now_at,now_at,'self','routine',NULL,'{}'::jsonb,note,perf.evidence_status_current,'[]'::jsonb,'completed',p_request_key,request_hash,haven.operation_occurrence_revision(),perf.id,perf.revision)
  RETURNING * INTO r;
 EXCEPTION WHEN unique_violation THEN
  IF EXISTS(SELECT 1 FROM public.operation_execution_receipts WHERE task_instance_id=t.id AND receipt_kind='verification' AND superseded_by_receipt_id IS NULL) THEN
   RAISE EXCEPTION 'Occurrence is not awaiting verification' USING ERRCODE='P0001'; END IF;
  RAISE EXCEPTION 'This request was already saved with different content' USING ERRCODE='P0001';
 END;
 UPDATE public.operation_task_instances SET status='completed',execution_state='completed',verification_receipt_id=r.id,completed_at=now_at,
  second_sign_by=auth.uid(),second_signed_at=now_at,verified_by=auth.uid(),verified_at=now_at,updated_at=now_at,updated_by=auth.uid() WHERE id=t.id;
 INSERT INTO public.operation_audit_log(organization_id,facility_id,task_instance_id,event_type,from_status,to_status,actor_id,actor_role,event_notes,event_data)
 VALUES(t.organization_id,t.facility_id,t.id,'verified',t.status,'completed',auth.uid(),haven.app_role()::text,note,
  jsonb_build_object('receipt_id',r.id,'performance_receipt_id',perf.id,'verified_receipt_revision',perf.revision,'completion_state','completed','request_key',p_request_key,'request_hash',request_hash,'receipt_version',1)),
 (t.organization_id,t.facility_id,t.id,'completed',t.status,'completed',auth.uid(),haven.app_role()::text,NULL,
  jsonb_build_object('receipt_id',r.id,'performance_receipt_id',perf.id,'independent_verification',true));
 PERFORM set_config('haven.operation_occurrence_command','',true);
 PERFORM haven.lock_operation_work_authority(p_task,coalesce(v.allowed_reviewer_roles,'{}'));
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 RETURN haven.operation_receipt_reply(r,t,NULL::public.operation_issues,false);
END $$;

-- ---------------------------------------------------------------------------
-- Public wrappers and grants.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.correct_operation_work_review(p_task uuid,p_request_key text,p_expected_receipt_id uuid,p_expected_receipt_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.correct_operation_work(p_task,p_request_key,p_expected_receipt_id,p_expected_receipt_revision,p_payload) $$;
CREATE FUNCTION public.reverse_operation_work_review(p_task uuid,p_request_key text,p_expected_receipt_id uuid,p_expected_receipt_revision text,p_payload jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.reverse_operation_work(p_task,p_request_key,p_expected_receipt_id,p_expected_receipt_revision,p_payload) $$;
REVOKE ALL ON FUNCTION
 haven.correct_operation_work(uuid,text,uuid,text,jsonb),haven.reverse_operation_work(uuid,text,uuid,text,jsonb),
 public.correct_operation_work_review(uuid,text,uuid,text,jsonb),public.reverse_operation_work_review(uuid,text,uuid,text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
 haven.correct_operation_work(uuid,text,uuid,text,jsonb),haven.reverse_operation_work(uuid,text,uuid,text,jsonb),
 public.correct_operation_work_review(uuid,text,uuid,text,jsonb),public.reverse_operation_work_review(uuid,text,uuid,text,jsonb)
 TO authenticated;

-- After application every receipt is its own chain root, nothing is
-- superseded, no correction or reversal exists, and every review binds to the
-- effective performance receipt it reviewed at that receipt's revision.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.operation_execution_receipts WHERE chain_id<>id OR corrects_receipt_id IS NOT NULL OR superseded_by_receipt_id IS NOT NULL OR receipt_kind='reversal')
  OR EXISTS(SELECT 1 FROM public.operation_execution_receipts ver JOIN public.operation_execution_receipts perf ON perf.id=ver.verifies_receipt_id
   WHERE ver.receipt_kind='verification' AND (perf.task_instance_id<>ver.task_instance_id OR perf.receipt_kind<>'performance' OR perf.revision<>ver.verified_receipt_revision)) THEN
  RAISE EXCEPTION 'COL-145: receipts are not in the expected post-migration state; repair before applying';
 END IF;
END $$;

COMMENT ON COLUMN public.operation_execution_receipts.chain_id IS 'COL-145: the receipts of one act of work share the first performance receipt''s id; a correction extends the chain, a reversal ends it, a recording after a reversal starts a new one. Derived server-side; immutable.';
COMMENT ON COLUMN public.operation_execution_receipts.corrects_receipt_id IS 'COL-145: the effective performance receipt this correction or reversal superseded; that receipt stays verbatim with superseded_by_receipt_id and superseded_at set once.';
COMMENT ON COLUMN public.operation_execution_receipts.verifies_receipt_id IS 'COL-145: the performance receipt (and, in verified_receipt_revision, the revision) this review reviewed; the review is superseded with it.';
COMMENT ON FUNCTION haven.correct_operation_work(uuid,text,uuid,text,jsonb) IS 'COL-145: a full restatement of recorded work that supersedes the exact receipt the corrector read, under current recorder authority; idempotent by request key and content; conflicts name the current receipt and revision; evidence carries across the chain; review reopens when the rule requires it.';
COMMENT ON FUNCTION haven.reverse_operation_work(uuid,text,uuid,text,jsonb) IS 'COL-145: a reversal receipt that supersedes the effective performance receipt and its review and returns the occurrence to unrecorded (pending or missed by its deadline); the reversed chain stays readable history and its evidence counts for nothing afterwards.';
NOTIFY pgrst,'reload schema';
COMMIT;
