-- Immutable organization template revisions, including the complete shift policy.
BEGIN;
ALTER TABLE public.escalation_template_rungs ADD COLUMN shift_overrides jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(shift_overrides)='array');
CREATE OR REPLACE FUNCTION public.observation_config_templates(p_facility_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE org uuid;
BEGIN
 IF NOT haven.can_read_observation_config(p_facility_id) THEN RAISE EXCEPTION 'Reading templates needs facility administration access' USING ERRCODE='42501'; END IF;
 SELECT organization_id INTO org FROM public.facilities WHERE id=p_facility_id AND deleted_at IS NULL;
 RETURN jsonb_build_object('cadence_templates',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'template_key',t.template_key,
 'version_id',v.id,'version_number',v.version_number,'windows',(SELECT coalesce(jsonb_agg(to_jsonb(w)-ARRAY['id','organization_id','cadence_template_version_id','created_at','created_by','updated_at','updated_by','deleted_at'] ORDER BY w.sort_order,w.window_key),'[]'::jsonb) FROM public.cadence_template_windows w WHERE w.cadence_template_version_id=v.id AND w.deleted_at IS NULL)) ORDER BY t.name),'[]'::jsonb)
 FROM public.cadence_templates t JOIN public.cadence_template_versions v ON v.cadence_template_id=t.id AND v.status='active' AND v.deleted_at IS NULL WHERE t.organization_id=org AND t.active AND t.deleted_at IS NULL),
 'escalation_templates',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'template_key',t.template_key,
 'version_id',v.id,'version_number',v.version_number,'rungs',(SELECT coalesce(jsonb_agg(to_jsonb(r)-ARRAY['id','organization_id','escalation_template_version_id','created_at','created_by','updated_at','updated_by','deleted_at'] ORDER BY r.sort_order,r.rung_key),'[]'::jsonb) FROM public.escalation_template_rungs r WHERE r.escalation_template_version_id=v.id AND r.deleted_at IS NULL)) ORDER BY t.name),'[]'::jsonb)
 FROM public.escalation_templates t JOIN public.escalation_template_versions v ON v.escalation_template_id=t.id AND v.status='active' AND v.deleted_at IS NULL WHERE t.organization_id=org AND t.active AND t.deleted_at IS NULL));
END $$;
REVOKE ALL ON FUNCTION public.observation_config_templates(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.observation_config_templates(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.save_observation_template(p_facility_id uuid,p_kind text,p_name text,p_change_reason text,p_rows jsonb,p_template_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE org uuid; tid uuid; vid uuid:=gen_random_uuid(); num integer; actor uuid:=auth.uid();
BEGIN
 IF NOT haven.can_edit_observation_config(p_facility_id) THEN RAISE EXCEPTION 'Editing organization templates needs the owner or an organization administrator' USING ERRCODE='42501'; END IF;
 IF p_kind NOT IN('cadence','escalation') OR nullif(btrim(p_name),'') IS NULL OR length(p_name)>80 OR nullif(btrim(p_change_reason),'') IS NULL OR length(p_change_reason)>500
 OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)=0 THEN
  RAISE EXCEPTION 'A template needs a kind, name, reason and nonempty policy rows' USING ERRCODE='22023'; END IF;
 SELECT organization_id INTO org FROM public.facilities WHERE id=p_facility_id AND deleted_at IS NULL;
 tid:=coalesce(p_template_id,gen_random_uuid());
 PERFORM pg_advisory_xact_lock(hashtextextended(tid::text,0));
 IF p_kind='cadence' THEN
  IF p_template_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.cadence_templates WHERE id=tid AND organization_id=org AND deleted_at IS NULL) THEN
   RAISE EXCEPTION 'Cadence template not found in this organization' USING ERRCODE='42501'; END IF;
  IF p_template_id IS NULL THEN INSERT INTO public.cadence_templates(id,organization_id,template_key,name,created_by) VALUES(tid,org,'template_'||replace(tid::text,'-',''),p_name,actor);
  ELSE UPDATE public.cadence_templates SET name=p_name,updated_by=actor WHERE id=tid; END IF;
  SELECT coalesce(max(version_number),0)+1 INTO num FROM public.cadence_template_versions WHERE cadence_template_id=tid;
  UPDATE public.cadence_template_versions SET status='superseded',updated_by=actor WHERE cadence_template_id=tid AND status='active' AND deleted_at IS NULL;
  INSERT INTO public.cadence_template_versions(id,organization_id,cadence_template_id,version_number,status,change_reason,created_by,activated_by,activated_at)
   VALUES(vid,org,tid,num,'active',p_change_reason,actor,actor,now());
  INSERT INTO public.cadence_template_windows(organization_id,cadence_template_version_id,window_key,label,due_at_local,grace_before_minutes,grace_after_minutes,shift_key,sort_order,enabled,created_by)
  SELECT org,vid,w.window_key,w.label,w.due_at_local,w.grace_before_minutes,w.grace_after_minutes,w.shift_key,w.sort_order,w.enabled,actor
  FROM jsonb_to_recordset(p_rows) w(window_key text,label text,due_at_local time,grace_before_minutes integer,grace_after_minutes integer,shift_key text,sort_order integer,enabled boolean);
 ELSE
  IF p_template_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.escalation_templates WHERE id=tid AND organization_id=org AND deleted_at IS NULL) THEN
   RAISE EXCEPTION 'Escalation template not found in this organization' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE (r->>'is_terminal')::boolean AND (r->>'enabled')::boolean AND nullif(btrim(r->>'protocol_text'),'') IS NOT NULL)
   OR EXISTS(SELECT 1 FROM (SELECT offset_minutes,lag(offset_minutes) OVER(ORDER BY sort_order,rung_key) prev FROM jsonb_to_recordset(p_rows) r(rung_key text,offset_minutes integer,sort_order integer,enabled boolean) WHERE enabled) x WHERE offset_minutes<=prev) THEN
   RAISE EXCEPTION 'A template needs increasing escalation offsets and an enabled terminal protocol' USING ERRCODE='22023'; END IF;
  IF p_template_id IS NULL THEN INSERT INTO public.escalation_templates(id,organization_id,template_key,name,created_by) VALUES(tid,org,'template_'||replace(tid::text,'-',''),p_name,actor);
  ELSE UPDATE public.escalation_templates SET name=p_name,updated_by=actor WHERE id=tid; END IF;
  SELECT coalesce(max(version_number),0)+1 INTO num FROM public.escalation_template_versions WHERE escalation_template_id=tid;
  UPDATE public.escalation_template_versions SET status='superseded',updated_by=actor WHERE escalation_template_id=tid AND status='active' AND deleted_at IS NULL;
  INSERT INTO public.escalation_template_versions(id,organization_id,escalation_template_id,version_number,status,change_reason,created_by,activated_by,activated_at)
   VALUES(vid,org,tid,num,'active',p_change_reason,actor,actor,now());
  INSERT INTO public.escalation_template_rungs(organization_id,escalation_template_version_id,rung_key,label,offset_minutes,is_terminal,assigned_staff_only,include_assigned_staff,use_standing_alert_routes,target_staff_roles,channels,protocol_text,sort_order,enabled,created_by,shift_overrides)
  SELECT org,vid,r.rung_key,r.label,r.offset_minutes,r.is_terminal,r.assigned_staff_only,r.include_assigned_staff,r.use_standing_alert_routes,r.target_staff_roles,r.channels,r.protocol_text,r.sort_order,r.enabled,actor,coalesce(r.shift_overrides,'[]'::jsonb)
  FROM jsonb_to_recordset(p_rows) r(rung_key text,label text,offset_minutes integer,is_terminal boolean,assigned_staff_only boolean,include_assigned_staff boolean,use_standing_alert_routes boolean,target_staff_roles public.staff_role[],channels text[],protocol_text text,sort_order integer,enabled boolean,shift_overrides jsonb);
 END IF;
 RETURN jsonb_build_object('template_id',tid,'version_id',vid,'version_number',num);
END $$;
REVOKE ALL ON FUNCTION public.save_observation_template(uuid,text,text,text,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_observation_template(uuid,text,text,text,jsonb,uuid) TO authenticated,service_role;
REVOKE INSERT,UPDATE,DELETE ON public.cadence_templates,public.cadence_template_versions,public.cadence_template_windows,
 public.escalation_templates,public.escalation_template_versions,public.escalation_template_rungs FROM authenticated;

CREATE OR REPLACE FUNCTION public.apply_template_to_facilities (p_facility_ids uuid[], p_change_reason text, p_cadence_template_id uuid, p_escalation_template_id uuid, p_apply_mode text, p_effective_from timestamptz, p_acknowledgment text, p_expected_cadence_template_version_id uuid, p_expected_escalation_template_version_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, haven, pg_catalog
  AS $func$
DECLARE
  v_windows jsonb := NULL;
  v_rungs jsonb := NULL;
  v_facility_id uuid;
  v_created jsonb;
  v_activated jsonb;
  v_outcomes jsonb := '[]'::jsonb;
  v_template_name text;
  v_facility_name text;
  v_succeeded integer := 0;
  v_failed integer := 0;
BEGIN
  IF p_change_reason IS NULL OR btrim(p_change_reason) = '' THEN
    RAISE EXCEPTION 'Applying a template needs a reason. Say what changed in the template and why it is being pushed out'
      USING ERRCODE = '22023';
  END IF;

  IF p_cadence_template_id IS NULL AND p_escalation_template_id IS NULL THEN
    RAISE EXCEPTION 'apply_template_to_facilities needs a cadence template, an escalation template, or both'
      USING ERRCODE = '22023';
  END IF;

  IF p_facility_ids IS NULL OR array_length(p_facility_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Name the buildings the template is being applied to'
      USING ERRCODE = '22023';
  END IF;

  IF haven.app_role ()::text NOT IN ('owner', 'org_admin') THEN
    RAISE EXCEPTION 'Applying an organization template needs an organization administrator or the owner'
      USING ERRCODE = '42501';
  END IF;

  -- Hold the named templates so a concurrent revision cannot change the
  -- snapshot between preview confirmation and its per-building copies.
  PERFORM 1 FROM public.cadence_templates WHERE id=p_cadence_template_id AND organization_id=haven.organization_id() FOR SHARE;
  PERFORM 1 FROM public.escalation_templates WHERE id=p_escalation_template_id AND organization_id=haven.organization_id() FOR SHARE;
  IF p_expected_cadence_template_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.cadence_template_versions WHERE id=p_expected_cadence_template_version_id AND cadence_template_id=p_cadence_template_id AND status='active' AND deleted_at IS NULL)
   OR p_expected_escalation_template_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.escalation_template_versions WHERE id=p_expected_escalation_template_version_id AND escalation_template_id=p_escalation_template_id AND status='active' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'This template changed after the preview. Review the new revision before applying it' USING ERRCODE='22023'; END IF;
  -- The acknowledgment for a fan out is the template name, typed once, and this
  -- is the only place it is checked.
  --
  -- public.activate_cadence_version asks for the building name because a direct
  -- edit is a decision about one building. A fan out is a decision about a
  -- template, and asking an administrator to type five building names in turn
  -- would either be skipped or automated, which is how a confirmation stops
  -- being one. Typing the template name is the stronger gate for an
  -- organization level action, and the per building diff preview spec 6.8 asks
  -- for is what the administrator reads before typing it. Each building's own
  -- name is then supplied to the per facility activation below, so that gate
  -- keeps working exactly as written for every other caller.
  IF p_acknowledgment IS NOT NULL THEN
    SELECT
      name INTO v_template_name
    FROM (
      SELECT
        t.name
      FROM
        public.cadence_templates t
      WHERE
        t.id = p_cadence_template_id
        AND t.organization_id = haven.organization_id ()
        AND t.deleted_at IS NULL
      UNION ALL
      SELECT
        t.name
      FROM
        public.escalation_templates t
      WHERE
        t.id = p_escalation_template_id
        AND t.organization_id = haven.organization_id ()
        AND t.deleted_at IS NULL) named
    WHERE
      lower(btrim(name)) = lower(btrim(p_acknowledgment))
    LIMIT 1;

    IF v_template_name IS NULL THEN
      RAISE EXCEPTION 'That acknowledgment does not match the name of either template being applied. Type the template name exactly to confirm'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_cadence_template_id IS NOT NULL THEN
    SELECT
      jsonb_agg (jsonb_build_object('window_key', w.window_key, 'label', w.label, 'due_at_local', to_char(w.due_at_local, 'HH24:MI'), 'grace_before_minutes', w.grace_before_minutes, 'grace_after_minutes', w.grace_after_minutes, 'shift_key', w.shift_key, 'sort_order', w.sort_order, 'enabled', w.enabled)
        ORDER BY w.sort_order, w.due_at_local) INTO v_windows
    FROM
      public.cadence_template_windows w
      JOIN public.cadence_template_versions tv ON tv.id = w.cadence_template_version_id
    WHERE
      tv.cadence_template_id = p_cadence_template_id
      AND tv.status = 'active'
      AND tv.deleted_at IS NULL
      AND tv.organization_id = haven.organization_id ()
      AND w.deleted_at IS NULL;

    IF v_windows IS NULL THEN
      RAISE EXCEPTION 'That cadence template has no active version with windows on it'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_escalation_template_id IS NOT NULL THEN
    SELECT
      jsonb_agg (jsonb_build_object('rung_key', r.rung_key, 'label', r.label, 'offset_minutes', r.offset_minutes, 'is_terminal', r.is_terminal, 'assigned_staff_only', r.assigned_staff_only, 'include_assigned_staff', r.include_assigned_staff, 'use_standing_alert_routes', r.use_standing_alert_routes, 'target_staff_roles', to_jsonb (r.target_staff_roles), 'channels', to_jsonb (r.channels), 'protocol_text', r.protocol_text,'shift_overrides',r.shift_overrides, 'sort_order', r.sort_order, 'enabled', r.enabled)
        ORDER BY r.sort_order, r.rung_key) INTO v_rungs
    FROM
      public.escalation_template_rungs r
      JOIN public.escalation_template_versions tv ON tv.id = r.escalation_template_version_id
    WHERE
      tv.escalation_template_id = p_escalation_template_id
      AND tv.status = 'active'
      AND tv.deleted_at IS NULL
      AND tv.organization_id = haven.organization_id ()
      AND r.deleted_at IS NULL;

    IF v_rungs IS NULL THEN
      RAISE EXCEPTION 'That escalation template has no active version with rungs on it'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  FOREACH v_facility_id IN ARRAY p_facility_ids LOOP
    BEGIN
      SELECT
        f.name INTO v_facility_name
      FROM
        public.facilities f
      WHERE
        f.id = v_facility_id
        AND f.deleted_at IS NULL;

      v_created := public.create_cadence_version (p_facility_id := v_facility_id, p_change_reason := p_change_reason, p_windows := v_windows, p_escalation_rungs := v_rungs, p_effective_from := p_effective_from, p_source_cadence_template_id := p_cadence_template_id, p_source_escalation_template_id := p_escalation_template_id);

      v_activated := public.activate_cadence_version (p_change_reason := p_change_reason, p_cadence_version_id := (v_created ->> 'cadence_version_id')::uuid, p_escalation_version_id := (v_created ->> 'escalation_version_id')::uuid, p_apply_mode := p_apply_mode, p_effective_from := p_effective_from, p_acknowledgment := CASE WHEN v_template_name IS NOT NULL THEN
          v_facility_name
        END);

      v_succeeded := v_succeeded + 1;
      v_outcomes := v_outcomes || jsonb_build_object('facility_id', v_facility_id, 'ok', TRUE, 'cadence_version_id', v_created ->> 'cadence_version_id', 'escalation_version_id', v_created ->> 'escalation_version_id', 'effective_from', v_activated ->> 'effective_from');
    EXCEPTION
      WHEN OTHERS THEN
        -- The subtransaction this block opens rolls back only this building's
        -- work. The other buildings keep theirs, and this one is reported by id
        -- rather than disappearing into a cheerful total.
        v_failed := v_failed + 1;
        v_outcomes := v_outcomes || jsonb_build_object('facility_id', v_facility_id, 'ok', FALSE, 'reason', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', v_failed = 0, 'cadence_template_id', p_cadence_template_id, 'escalation_template_id', p_escalation_template_id, 'apply_mode', p_apply_mode, 'facilities_attempted', array_length(p_facility_ids, 1), 'facilities_succeeded', v_succeeded, 'facilities_failed', v_failed, 'facilities', v_outcomes);
END;
$func$;
REVOKE ALL ON FUNCTION public.apply_template_to_facilities(uuid[],text,uuid,uuid,text,timestamptz,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.apply_template_to_facilities(uuid[],text,uuid,uuid,text,timestamptz,text,uuid,uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.apply_template_to_facilities(p_facility_ids uuid[],p_change_reason text,p_cadence_template_id uuid DEFAULT NULL,p_escalation_template_id uuid DEFAULT NULL,p_apply_mode text DEFAULT 'next_shift_boundary',p_effective_from timestamptz DEFAULT NULL,p_acknowledgment text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SET search_path=public,pg_catalog AS $$
 SELECT public.apply_template_to_facilities(p_facility_ids,p_change_reason,p_cadence_template_id,p_escalation_template_id,p_apply_mode,p_effective_from,p_acknowledgment,NULL::uuid,NULL::uuid);
$$;
CREATE OR REPLACE FUNCTION public.facility_config_template_drift (p_at timestamptz DEFAULT now(), p_facility_id uuid DEFAULT NULL)
  RETURNS TABLE (
    organization_id uuid,
    facility_id uuid,
    facility_name text,
    cadence_version_id uuid,
    escalation_version_id uuid,
    cadence_template_id uuid,
    cadence_template_name text,
    escalation_template_id uuid,
    escalation_template_name text,
    on_cadence_template boolean,
    on_escalation_template boolean,
    cadence_drift_count bigint,
    escalation_drift_count bigint)
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_catalog
  AS $func$
WITH in_force AS (
  SELECT
    f.id AS facility_id,
    f.organization_id,
    f.name AS facility_name,
    public.facility_cadence_in_force (f.id, p_at) AS cadence_version_id,
    public.facility_escalation_in_force (f.id, p_at) AS escalation_version_id
  FROM
    public.facilities f
  WHERE
    f.deleted_at IS NULL
    AND (p_facility_id IS NULL OR f.id = p_facility_id)
),
bound AS (
  SELECT
    i.*,
    b.cadence_template_id,
    b.escalation_template_id,
    ct.name AS cadence_template_name,
    et.name AS escalation_template_name,
    ctv.id AS cadence_template_version_id,
    etv.id AS escalation_template_version_id
  FROM
    in_force i
    LEFT JOIN public.facility_config_template_bindings b ON b.facility_id = i.facility_id
      AND b.deleted_at IS NULL
    LEFT JOIN public.cadence_templates ct ON ct.id = b.cadence_template_id
      AND ct.deleted_at IS NULL
    LEFT JOIN public.escalation_templates et ON et.id = b.escalation_template_id
      AND et.deleted_at IS NULL
    LEFT JOIN public.cadence_template_versions ctv ON ctv.cadence_template_id = ct.id
      AND ctv.status = 'active'
      AND ctv.deleted_at IS NULL
    LEFT JOIN public.escalation_template_versions etv ON etv.escalation_template_id = et.id
      AND etv.status = 'active'
      AND etv.deleted_at IS NULL
)
SELECT
  b.organization_id,
  b.facility_id,
  b.facility_name,
  b.cadence_version_id,
  b.escalation_version_id,
  b.cadence_template_id,
  b.cadence_template_name,
  b.escalation_template_id,
  b.escalation_template_name,
  (b.cadence_template_id IS NOT NULL) AS on_cadence_template,
  (b.escalation_template_id IS NOT NULL) AS on_escalation_template,
  CASE WHEN b.cadence_template_id IS NULL THEN
    NULL
  ELSE
    (
      SELECT
        count(*)
      FROM ((
          SELECT
            w.window_key,
            w.label,
            w.due_at_local,
            w.grace_before_minutes,
            w.grace_after_minutes,
            w.shift_key,
            w.enabled
          FROM
            public.facility_cadence_windows w
          WHERE
            w.cadence_version_id = b.cadence_version_id
            AND w.deleted_at IS NULL)
        EXCEPT ALL (
          SELECT
            tw.window_key,
            tw.label,
            tw.due_at_local,
            tw.grace_before_minutes,
            tw.grace_after_minutes,
            tw.shift_key,
            tw.enabled
          FROM
            public.cadence_template_windows tw
          WHERE
            tw.cadence_template_version_id = b.cadence_template_version_id
            AND tw.deleted_at IS NULL)
        UNION ALL (
          SELECT
            tw.window_key,
            tw.label,
            tw.due_at_local,
            tw.grace_before_minutes,
            tw.grace_after_minutes,
            tw.shift_key,
            tw.enabled
          FROM
            public.cadence_template_windows tw
          WHERE
            tw.cadence_template_version_id = b.cadence_template_version_id
            AND tw.deleted_at IS NULL
          EXCEPT ALL
          SELECT
            w.window_key,
            w.label,
            w.due_at_local,
            w.grace_before_minutes,
            w.grace_after_minutes,
            w.shift_key,
            w.enabled
          FROM
            public.facility_cadence_windows w
          WHERE
            w.cadence_version_id = b.cadence_version_id
            AND w.deleted_at IS NULL)) difference)
  END AS cadence_drift_count,
  CASE WHEN b.escalation_template_id IS NULL THEN
    NULL
  ELSE
    (
      SELECT
        count(*)
      FROM ((
          SELECT
            r.rung_key,
            r.label,
            r.offset_minutes,
            r.is_terminal,
            r.assigned_staff_only,
            r.include_assigned_staff,
            r.use_standing_alert_routes,
            r.target_staff_roles,
            r.channels,
            r.enabled,r.protocol_text,r.sort_order,
            (SELECT coalesce(jsonb_agg(jsonb_build_object('shift_key',o.shift_key,'offset_minutes',o.offset_minutes,'channels',o.channels) ORDER BY o.shift_key),'[]'::jsonb) FROM public.facility_escalation_rung_shift_overrides o WHERE o.escalation_rung_id=r.id AND o.deleted_at IS NULL)
          FROM
            public.facility_escalation_rungs r
          WHERE
            r.escalation_version_id = b.escalation_version_id
            AND r.deleted_at IS NULL)
        EXCEPT ALL (
          SELECT
            tr.rung_key,
            tr.label,
            tr.offset_minutes,
            tr.is_terminal,
            tr.assigned_staff_only,
            tr.include_assigned_staff,
            tr.use_standing_alert_routes,
            tr.target_staff_roles,
            tr.channels,
            tr.enabled,tr.protocol_text,tr.sort_order,
            (SELECT coalesce(jsonb_agg(o ORDER BY o->>'shift_key'),'[]'::jsonb) FROM jsonb_array_elements(tr.shift_overrides) o)
          FROM
            public.escalation_template_rungs tr
          WHERE
            tr.escalation_template_version_id = b.escalation_template_version_id
            AND tr.deleted_at IS NULL)
        UNION ALL (
          SELECT
            tr.rung_key,
            tr.label,
            tr.offset_minutes,
            tr.is_terminal,
            tr.assigned_staff_only,
            tr.include_assigned_staff,
            tr.use_standing_alert_routes,
            tr.target_staff_roles,
            tr.channels,
            tr.enabled,tr.protocol_text,tr.sort_order,
            (SELECT coalesce(jsonb_agg(o ORDER BY o->>'shift_key'),'[]'::jsonb) FROM jsonb_array_elements(tr.shift_overrides) o)
          FROM
            public.escalation_template_rungs tr
          WHERE
            tr.escalation_template_version_id = b.escalation_template_version_id
            AND tr.deleted_at IS NULL
          EXCEPT ALL
          SELECT
            r.rung_key,
            r.label,
            r.offset_minutes,
            r.is_terminal,
            r.assigned_staff_only,
            r.include_assigned_staff,
            r.use_standing_alert_routes,
            r.target_staff_roles,
            r.channels,
            r.enabled,r.protocol_text,r.sort_order,
            (SELECT coalesce(jsonb_agg(jsonb_build_object('shift_key',o.shift_key,'offset_minutes',o.offset_minutes,'channels',o.channels) ORDER BY o.shift_key),'[]'::jsonb) FROM public.facility_escalation_rung_shift_overrides o WHERE o.escalation_rung_id=r.id AND o.deleted_at IS NULL)
          FROM
            public.facility_escalation_rungs r
          WHERE
            r.escalation_version_id = b.escalation_version_id
            AND r.deleted_at IS NULL)) difference)
  END AS escalation_drift_count
FROM
  bound b;
$func$;
NOTIFY pgrst,'reload schema';
COMMENT ON FUNCTION public.observation_config_templates(uuid) IS 'COL-37 ruling: definer required for the facility-administrator template preview across organization template children whose mutation permissions are separately restricted. can_read_observation_config checks current role and facility access; every template read is restricted to that facility organization.';
COMMENT ON FUNCTION public.save_observation_template(uuid,text,text,text,jsonb,uuid) IS 'COL-37 ruling: definer required because immutable template rows cannot be written directly. can_edit_observation_config checks current owner or organization administrator and facility access; supplied template IDs must match that organization, and each revision records actor and required reason.';
COMMENT ON FUNCTION public.apply_template_to_facilities(uuid[],text,uuid,uuid,text,timestamptz,text,uuid,uuid) IS 'COL-37 ruling: definer required to lock the confirmed template revision without granting direct UPDATE access. Current owner/org_admin role is required; template locks and reads are organization-scoped, and each facility write delegates to current-authority create and activate commands, returning per-facility refusals.';
COMMIT;

-- Operational rollback / containment (execute only for a verified incident):
-- BEGIN;
-- REVOKE EXECUTE ON FUNCTION public.save_observation_template(uuid,text,text,text,jsonb,uuid) FROM authenticated;
-- COMMIT;
-- Preserve all new history and assignments. Restore service with a reviewed
-- forward correction and the matching GRANT EXECUTE, not DROP or data deletion.
-- The release handoff records pre-change definitions and the recovery marker.
