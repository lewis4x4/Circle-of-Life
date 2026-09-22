-- COL-546: stop the reader claiming no live connection exists when one does.
--
-- insureflow_receiver_read has always returned a hardcoded
--
--   'live_connection_enabled', false
--
-- which was true by construction while synthetic was the only mode there was.
-- 453 made live mode real and left that literal in place, so the reader now
-- reports false while a live connection is enabled and polling. That is a field
-- whose entire job is to answer one question, answering it wrongly.
--
-- Found while building the surface that consumes it — nothing rendered this
-- field before, so nothing had cause to notice.
--
-- Derived from 453's read_impl by substitution; the only changes are the flag,
-- its declaration, and setting it inside the loop that already walks every
-- connection in the caller's organisation.

BEGIN;

CREATE OR REPLACE FUNCTION haven.insureflow_receiver_read_impl(p_action text,p_payload jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record;c public.insureflow_receiver_connections;connections jsonb:='[]';live_enabled boolean:=false;summaries jsonb;entry jsonb;r jsonb;body jsonb;map jsonb;ent record;fresh boolean;eligible boolean;checked timestamptz;expires timestamptz;status text;missing integer;requested uuid;entity_filter uuid;stamp timestamptz;
BEGIN
 SELECT * INTO a FROM haven.current_authorized_actor();
 IF a.actor_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000';END IF;
 IF a.actor_role_text NOT IN('owner','org_admin','facility_admin') THEN RAISE EXCEPTION 'Agency summaries require insurance manager or facility administrator access' USING ERRCODE='42501';END IF;
 IF p_action IS DISTINCT FROM 'list' OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN('connection_id','entity_id')) THEN RAISE EXCEPTION 'Invalid receiver read command' USING ERRCODE='22023';END IF;
 requested:=(p_payload->>'connection_id')::uuid;entity_filter:=(p_payload->>'entity_id')::uuid;
 IF entity_filter IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.entities WHERE id=entity_filter AND organization_id=a.actor_organization_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Entity unavailable' USING ERRCODE='42501';END IF;
 FOR c IN SELECT * FROM public.insureflow_receiver_connections WHERE organization_id=a.actor_organization_id AND (requested IS NULL OR id=requested) ORDER BY name,id FOR SHARE LOOP
 IF c.mode='live' AND c.enabled THEN live_enabled:=true;END IF;
 summaries:='[]';missing:=0;stamp:=clock_timestamp();checked:=(c.state->>'authorization_checked_at')::timestamptz;expires:=checked+make_interval(secs=>c.ttl_seconds);
 fresh:=c.enabled AND c.mode IN('synthetic','live') AND c.state->>'health' IN('healthy','degraded') AND checked IS NOT NULL AND checked<=stamp AND expires>stamp;
 FOR entry IN SELECT value FROM jsonb_array_elements(c.state->'manifest') LOOP
 r:=c.state->'receipts'->(entry->>'release_id');body:=r->'snapshot';eligible:=false;
 IF fresh AND r IS NOT NULL AND r->>'policy_id'=entry->>'policy_id' AND r->>'sequence'=entry->>'sequence' AND r->'validator_version'='1'::jsonb AND r->'conflict'='false'::jsonb AND r->'quarantine'='null'::jsonb AND r->'needs_confirmation'='false'::jsonb AND r->'hash'<>'null'::jsonb AND haven.insureflow_snapshot_valid(body,(entry->>'policy_id')::uuid) AND (NOT c.state->'recovery' ? (entry->>'release_id') OR c.state->'recovery'->(entry->>'release_id')->>'status'='resolved') THEN
 SELECT value INTO map FROM jsonb_array_elements(c.mappings) WHERE (value->>'account_id')::uuid=(body->>'account_id')::uuid AND value->'approved'='true'::jsonb LIMIT 1;
 IF map IS NOT NULL THEN
 SELECT id,name INTO ent FROM public.entities WHERE id=(map->>'entity_id')::uuid AND organization_id=c.organization_id AND deleted_at IS NULL FOR SHARE;
 IF FOUND THEN
 eligible:=true;
 IF (a.actor_role_text IN('owner','org_admin') OR EXISTS(SELECT 1 FROM public.facilities f WHERE f.entity_id=ent.id AND f.deleted_at IS NULL AND f.id IN(SELECT haven.accessible_facility_ids()))) AND (entity_filter IS NULL OR ent.id=entity_filter) THEN
 summaries:=summaries||jsonb_build_array(jsonb_build_object('source_policy_id',entry->>'policy_id','release_id',entry->>'release_id','source_sequence',entry->>'sequence','source_released_at',r->>'created_at','received_at',c.receipt_received_at->>(entry->>'release_id'),'mapped_entity_id',ent.id,'mapped_entity_name',ent.name,'summary',body-ARRAY['schema_version','policy_id','account_id']));
 END IF;
 END IF;
 END IF;
 END IF;
 IF NOT eligible THEN missing:=missing+1;END IF;
 END LOOP;
 status:=CASE WHEN NOT c.enabled THEN 'disabled' WHEN NOT fresh THEN 'unavailable' WHEN missing>0 OR c.state->>'health'='degraded' OR c.last_error_code IS NOT NULL THEN 'degraded' ELSE 'healthy' END;
 connections:=connections||jsonb_build_array(jsonb_build_object('id',c.id,'name',c.name,'provider_instance',c.provider_instance,'source_integration_id',c.source_integration_id,'mode',c.mode,'enabled',c.enabled,'state',status,'revision',c.revision,'last_authorization_check_at',checked,'authorization_valid_until',expires,'incomplete_summary_count',missing,'summaries',summaries));
 END LOOP;
 -- Authority is checked after any connection/entity wait. The clock is checked
 -- again so a read delayed by locks cannot return expired cached material.
 PERFORM haven.insurance_lock_actor(a.actor_user_id,a.actor_organization_id,ARRAY['owner','org_admin','facility_admin']);
 SELECT coalesce(jsonb_agg(CASE WHEN v->>'state'<>'disabled' AND ((v->>'authorization_valid_until')::timestamptz IS NULL OR (v->>'authorization_valid_until')::timestamptz<=clock_timestamp()) THEN v||jsonb_build_object('state','unavailable','summaries','[]'::jsonb) ELSE v END),'[]') INTO connections FROM jsonb_array_elements(connections) v;
 RETURN jsonb_build_object('live_connection_enabled',live_enabled,'connections',connections);
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
