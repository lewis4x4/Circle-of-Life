-- COL-37: pin search_path on the ten functions that still resolve names through
-- the caller's search_path.
--
-- A function without a SET search_path resolves unqualified names using
-- whatever the caller has configured. For the SECURITY DEFINER members of this
-- list -- haven.can_manage_user, public.auto_trigger_watch_protocol,
-- public.increment_usage -- that is a privilege-escalation path: a caller who
-- can create objects in a schema earlier on their own search_path chooses which
-- code the definer runs. The rest are pinned for consistency, so the advisor
-- reports a clean surface and a future reader does not have to re-derive which
-- of them mattered.
--
-- Eight of the ten already qualify every reference they make, so they only need
-- the setting. Two reach for tables unqualified and are re-created with the
-- schema spelled out; their bodies are otherwise byte-identical to what
-- production runs today.

BEGIN;

-- Already fully qualified -- setting only, no body change.
ALTER FUNCTION haven.can_manage_user(uuid) SET search_path = '';
ALTER FUNCTION public._ai_tool_role_allowed(text, text) SET search_path = '';
ALTER FUNCTION public._kb_seed_targets_touch() SET search_path = '';
ALTER FUNCTION public.auto_trigger_watch_protocol() SET search_path = '';
ALTER FUNCTION public.document_role_can_view_audience(text, text) SET search_path = '';
ALTER FUNCTION public.haven_csc_discrepancy_defaults() SET search_path = '';
ALTER FUNCTION public.haven_exec_nlq_messages_touch_session() SET search_path = '';
ALTER FUNCTION public.normalize_alias_term(text) SET search_path = '';

-- public.increment_usage reached for `usage_counters` unqualified, in both the
-- INSERT target and the ON CONFLICT SET clause. The conflict-target alias stays
-- unqualified by design: it names the insert target, not a schema path.
--
-- Only the (uuid, text, bigint, bigint) overload is unpinned; its sibling
-- (uuid, uuid, ...) already carries search_path=public and is left alone.
CREATE OR REPLACE FUNCTION public.increment_usage(
  p_user_id uuid,
  p_workspace_id text,
  p_tokens_in bigint,
  p_tokens_out bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.usage_counters (user_id, workspace_id, bucket_date, tokens_in, tokens_out, queries)
  VALUES (p_user_id, p_workspace_id, CURRENT_DATE, p_tokens_in, p_tokens_out, 1)
  ON CONFLICT (user_id, bucket_date) DO UPDATE SET
    tokens_in = usage_counters.tokens_in + EXCLUDED.tokens_in,
    tokens_out = usage_counters.tokens_out + EXCLUDED.tokens_out,
    queries = usage_counters.queries + 1;
END;
$function$;

-- public.seed_admission_case_form_1823 reached for
-- admission_document_checklist_items unqualified.
CREATE OR REPLACE FUNCTION public.seed_admission_case_form_1823()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.admission_document_checklist_items (
    organization_id,
    facility_id,
    admission_case_id,
    document_type,
    required,
    created_by,
    updated_by
  )
  VALUES (
    NEW.organization_id,
    NEW.facility_id,
    NEW.id,
    'form_1823',
    true,
    NEW.created_by,
    NEW.updated_by
  )
  ON CONFLICT (admission_case_id, document_type) WHERE deleted_at IS NULL DO NOTHING;

  RETURN NEW;
END;
$function$;

-- CREATE OR REPLACE keeps whatever privileges a function already carries, so on
-- this database the two rewrites above change nothing. On a clean replay they
-- would be created fresh and pick up the default EXECUTE to PUBLIC instead --
-- which is how public.increment_usage, a definer that writes usage rows for any
-- user id it is handed, ended up anon-callable on staging when this migration
-- was rehearsed there. State the privileges rather than inherit them, so every
-- environment lands in the same place: service_role only, matching production.
REVOKE ALL ON FUNCTION public.increment_usage(uuid, text, bigint, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_usage(uuid, text, bigint, bigint) TO service_role;

-- The four trigger functions in this migration still carry the default EXECUTE
-- to PUBLIC, anon, authenticated and service_role. Nothing calls a trigger
-- function by name, and triggers fire without re-checking EXECUTE -- the same
-- reasoning, and the same treatment, as the payroll guards in 389.
REVOKE ALL ON FUNCTION
  public._kb_seed_targets_touch(),
  public.haven_csc_discrepancy_defaults(),
  public.haven_exec_nlq_messages_touch_session(),
  public.seed_admission_case_form_1823()
  FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Rollback must be a separately reviewed forward migration. Removing a pinned
-- search_path re-opens the definer escalation path; if one of these functions
-- needs a schema on its path, name that schema explicitly rather than clearing
-- the setting.
