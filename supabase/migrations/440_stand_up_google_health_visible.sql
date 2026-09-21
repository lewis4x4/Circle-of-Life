-- A fresh Haven-to-Front-Office receipt must not hide a broken Google workbook
-- intake. Expose only the connector's redacted state and timestamps to the
-- already-authorized Stand Up workspace; credentials and Drive metadata remain
-- private. The UI can now fail visibly before Monday figures are trusted.
BEGIN;

CREATE FUNCTION haven.stand_up_google_health(p_organization_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((
  SELECT jsonb_build_object(
   'state',s.connection_state,
   'last_success_at',s.last_connected_at,
   'last_checked_at',s.last_completed_at,
   'last_outcome',s.last_outcome,
   'last_error_code',s.last_error_code
  )
  FROM haven.stand_up_google_state s
  WHERE s.organization_id=p_organization_id AND s.singleton
 ),jsonb_build_object('state','unconfigured'))
$$;

-- Migration 405's wrapper, with one additive workspace key. All existing
-- command, roster, report metadata, and facility-window behavior is preserved.
CREATE OR REPLACE FUNCTION haven.stand_up_command(p_action text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; reports jsonb; facilities jsonb; organization uuid;
BEGIN
 IF p_action='set_entry_window' THEN RETURN haven.stand_up_set_entry_window(p_payload); END IF;
 IF p_action='reverse_import' THEN RETURN haven.stand_up_reverse_import(p_payload); END IF;
 IF p_action='revisions' THEN RETURN haven.stand_up_revision_history(p_payload); END IF;
 IF p_action='roster' THEN RETURN haven.stand_up_roster_suggestion(p_payload); END IF;
 result:=haven.stand_up_command_v1(p_action,p_payload);
 IF p_action IN('workspace','list') THEN
  organization:=haven.organization_id();
  SELECT coalesce(jsonb_agg(x||coalesce(haven.stand_up_revision_metadata((x->>'revision_id')::uuid),'{}') ORDER BY x->>'week_start' DESC,x->>'facility_id'),'[]') INTO reports FROM jsonb_array_elements(result->'reports') x;
  SELECT coalesce(jsonb_agg(y||jsonb_build_object(
    'entry_open_lead_minutes',(SELECT s.entry_open_lead_minutes FROM public.stand_up_facility_settings s WHERE s.facility_id=(y->>'id')::uuid),
    'open_week',haven.stand_up_open_week((y->>'id')::uuid),
    'entry_opens_at',haven.stand_up_entry_opens_at((y->>'id')::uuid,haven.stand_up_open_week((y->>'id')::uuid))
   ) ORDER BY y->>'name'),'[]') INTO facilities FROM jsonb_array_elements(result->'facilities') y;
  RETURN result||jsonb_build_object(
   'reports',reports,
   'facilities',facilities,
   'server_now',clock_timestamp(),
   'actor_role',haven.app_role()::text,
   'google_connection',haven.stand_up_google_health(organization)
  );
 ELSIF p_action IN('save','commit_recovery') THEN
  RETURN result||coalesce(haven.stand_up_revision_metadata((result->>'revision_id')::uuid),'{}');
 END IF;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION haven.stand_up_google_health(uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION haven.stand_up_google_health(uuid) IS 'Redacted Google workbook connector health for an already-authorized Stand Up workspace. No credential, workbook identifier, file metadata, or business figure is returned.';

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: restore migration 405's haven.stand_up_command definition, then
-- DROP FUNCTION haven.stand_up_google_health(uuid).
