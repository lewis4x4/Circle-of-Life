-- Role-keyed configuration follows the people: the target row holds the widest
-- setting any of its sources held; the source rows are removed.
CREATE TEMP TABLE role_fold(source text PRIMARY KEY, target text NOT NULL) ON COMMIT DROP;
INSERT INTO role_fold VALUES ('nurse','med_tech'),('caregiver','med_tech'),('dietary','cook'),('dietary_aide','cook');

-- role_permissions: view < edit < admin.
CREATE FUNCTION pg_temp.permission_rank(p text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'admin' THEN 3 WHEN 'edit' THEN 2 WHEN 'view' THEN 1 ELSE 0 END $$;
WITH candidates AS (
  SELECT coalesce(f.target, r.app_role) AS app_role, r.feature, r.permission_level, r.description
  FROM public.role_permissions r LEFT JOIN role_fold f ON f.source = r.app_role
  WHERE r.app_role IN (SELECT source FROM role_fold) OR r.app_role IN (SELECT target FROM role_fold)
), widest AS (
  SELECT DISTINCT ON (app_role, feature) app_role, feature, permission_level, description
  FROM candidates ORDER BY app_role, feature, pg_temp.permission_rank(permission_level) DESC
)
MERGE INTO public.role_permissions t
USING widest w ON t.app_role = w.app_role AND t.feature = w.feature
WHEN MATCHED AND pg_temp.permission_rank(w.permission_level) > pg_temp.permission_rank(t.permission_level)
  THEN UPDATE SET permission_level = w.permission_level, updated_at = now()
WHEN NOT MATCHED THEN INSERT (app_role, feature, permission_level, description)
  VALUES (w.app_role, w.feature, w.permission_level, w.description);
DELETE FROM public.role_permissions WHERE app_role IN (SELECT source FROM role_fold);

-- search_tool_policies: enabled if any source had it enabled.
WITH widest AS (
  SELECT r.organization_id, r.tool_name, min(r.tool_tier::text)::public.search_tool_tier AS tool_tier,
         coalesce(f.target, r.app_role) AS app_role, bool_or(r.enabled) AS enabled
  FROM public.search_tool_policies r LEFT JOIN role_fold f ON f.source = r.app_role
  WHERE r.app_role IN (SELECT source FROM role_fold) OR r.app_role IN (SELECT target FROM role_fold)
  GROUP BY 1, 2, 4
)
MERGE INTO public.search_tool_policies t
USING widest w ON t.organization_id = w.organization_id AND t.tool_name = w.tool_name AND t.app_role = w.app_role
WHEN MATCHED AND w.enabled AND NOT t.enabled THEN UPDATE SET enabled = true, updated_at = now()
WHEN NOT MATCHED THEN INSERT (organization_id, tool_name, tool_tier, app_role, enabled)
  VALUES (w.organization_id, w.tool_name, w.tool_tier, w.app_role, w.enabled);
DELETE FROM public.search_tool_policies WHERE app_role IN (SELECT source FROM role_fold);

-- Role arrays: map each source to its target, keep order, drop duplicates.
CREATE FUNCTION pg_temp.role_list_fold(p text[]) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(r ORDER BY o), '{}') FROM (
    SELECT DISTINCT ON (r) r, o FROM (
      SELECT coalesce(f.target, e) r, o FROM unnest(p) WITH ORDINALITY u(e, o) LEFT JOIN role_fold f ON f.source = e
    ) s ORDER BY r, o) d
$$;
UPDATE public.flow_workflow_definitions SET roles_allowed = pg_temp.role_list_fold(roles_allowed)
  WHERE roles_allowed && ARRAY['nurse','caregiver','dietary','dietary_aide'];
UPDATE public.documents SET role_tags = pg_temp.role_list_fold(role_tags)
  WHERE role_tags && ARRAY['nurse','caregiver','dietary','dietary_aide'];
UPDATE public.assessment_templates SET required_role = pg_temp.role_list_fold(required_role::text[])::public.app_role[]
  WHERE required_role && ARRAY['nurse','caregiver','dietary','dietary_aide']::public.app_role[];
UPDATE public.document_acknowledgment_requirements SET required_roles = pg_temp.role_list_fold(required_roles)
  WHERE required_roles && ARRAY['nurse','caregiver','dietary','dietary_aide'];
UPDATE public.training_programs SET applies_to_roles = pg_temp.role_list_fold(applies_to_roles)
  WHERE applies_to_roles && ARRAY['nurse','caregiver','dietary','dietary_aide'];
UPDATE public.facility_operational_thresholds SET notify_roles = pg_temp.role_list_fold(notify_roles)
  WHERE notify_roles && ARRAY['nurse','caregiver','dietary','dietary_aide'];
UPDATE public.organization_operational_threshold_defaults SET notify_roles = pg_temp.role_list_fold(notify_roles)
  WHERE notify_roles && ARRAY['nurse','caregiver','dietary','dietary_aide'];
UPDATE public.report_templates SET intended_roles = pg_temp.role_list_fold(intended_roles::text[])::public.app_role[]
  WHERE intended_roles && ARRAY['nurse','caregiver','dietary','dietary_aide']::public.app_role[];

-- Single-role routing configuration.
UPDATE public.incident_followup_protocols p SET assign_to_role = f.target FROM role_fold f WHERE p.assign_to_role = f.source;

-- The people. The profile row is what the token hook reads (326); changing app_role
-- advances auth_claim_version, so the next token carries the new role.
UPDATE auth.users u SET raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('app_role', f.target)
  FROM public.user_profiles p JOIN role_fold f ON f.source = p.app_role::text WHERE p.id = u.id;
UPDATE public.user_profiles p SET app_role = f.target::public.app_role, updated_at = now()
  FROM role_fold f WHERE p.app_role::text = f.source;

DO $check$
DECLARE v text;
BEGIN
  SELECT string_agg(DISTINCT app_role::text, ', ') INTO v FROM public.user_profiles
    WHERE app_role::text IN ('nurse','caregiver','dietary','dietary_aide') AND deleted_at IS NULL;
  IF v IS NOT NULL THEN RAISE EXCEPTION 'Retired roles still held: %', v; END IF;
  IF EXISTS (SELECT 1 FROM public.role_permissions WHERE app_role IN ('nurse','caregiver','dietary','dietary_aide'))
    OR EXISTS (SELECT 1 FROM public.search_tool_policies WHERE app_role IN ('nurse','caregiver','dietary','dietary_aide')) THEN
    RAISE EXCEPTION 'Role configuration still keyed to a retired role';
  END IF;
END
$check$;

NOTIFY pgrst, 'reload schema';
COMMIT;