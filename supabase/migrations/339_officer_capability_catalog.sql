-- 339: Officer capability catalog (Front Office capability federation, D-07).
--
-- Haven publishes a small, fixed, aggregate-only catalog that Front Office can
-- call on behalf of a signed-in officer. Wire contract: Front Office
-- docs/specs/0004-CAPABILITY-FEDERATION.md, contract version
-- front-office-capability-v1, target name `haven`. Haven design and operator
-- procedure: docs/specs/OFFICER-CAPABILITY-CATALOG.md.
--
-- Everything lives in schema `officer`. No client role has any privilege on
-- anything in it. The only doors are four SECURITY DEFINER functions in
-- `public`, granted to service_role alone and called by the `officer-catalog`
-- Edge Function after it has verified the request HMAC:
--   public.officer_key_secret_env(p_key_id)   -> which Edge secret holds the key
--   public.officer_catalog(p_key_id)          -> enabled capabilities for the key
--   public.officer_execute(...)               -> one read or one command
--   public.officer_record_refusal(...)        -> audit a refusal after rollback
--
-- Scope: every read is organization-wide for the organization stored on the
-- officer's registry row (officer.federated_officers.organization_id) and
-- reports a per-facility breakdown. Nothing in the request envelope is ever
-- used as scope, no haven.* helper is called (they read auth.uid(), which is
-- NULL on this path), and no ai_tool_* or exec-kpi function is reused: they
-- take caller context as parameters, the confused-deputy shape this design
-- refuses. Their SQL predicates are copied here and cited per read.
--
-- PHI: every capability returns counts, cents and facility names only.
-- No resident, staff or person identifier, name, note or free text appears in
-- any envelope, audit row or seed. phi_class is constrained to 'none'.
--
-- GRANT DURABILITY: 308_revoke_anon_security_definer_rpc_execute.sql is an
-- idempotent sweep that grants every public SECURITY DEFINER function it does
-- not recognise to `authenticated`. If 308 is ever re-run, officer_catalog,
-- officer_execute, officer_key_secret_env and officer_record_refusal MUST be
-- added to its service-role-only list first. supabase/tests/review_officer_catalog.sql
-- is the tripwire. Also: CREATE OR REPLACE FUNCTION resets EXECUTE to PUBLIC,
-- which is why the REVOKE/GRANT block in section 8 runs after every definition
-- in this file and must run again after any future redefinition.
--
-- Safe to replay: IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT throughout.
-- Transactional: the whole file applies or nothing does.

BEGIN;

-- =============================================================================
-- 0. Schema and privilege posture
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS officer;
COMMENT ON SCHEMA officer IS 'Front Office capability federation (D-07). Private: no client role holds any privilege here; reached only through public.officer_* SECURITY DEFINER doors granted to service_role.';

REVOKE ALL ON SCHEMA officer FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA officer REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA officer REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA officer REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

-- =============================================================================
-- 1. Tables (contract section 3, plus organization scope and facility coverage)
-- =============================================================================

-- Registry of officer seats Front Office may act for. Keyed by the Front Office
-- user_profiles.id. Rows are inserted by the Haven operator through a reviewed
-- statement (scripts/officer/register-officers.example.sql), never by Front
-- Office and never by this migration. organization_id is the ONLY read scope.
CREATE TABLE IF NOT EXISTS officer.federated_officers (
  front_office_profile_id uuid PRIMARY KEY,
  officer_role text NOT NULL CHECK (officer_role IN ('owner','ceo','cfo','coo','ctdo')),
  email text NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations (id),
  target_user_id uuid NULL REFERENCES public.user_profiles (id),
  is_active boolean NOT NULL DEFAULT false,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE officer.federated_officers IS 'Officer seats Front Office may act for. organization_id is the only read scope; the envelope is never trusted for scope.';

-- One row per calling system key. The secret itself is never stored: secret_env
-- names the Edge Function secret that holds it.
CREATE TABLE IF NOT EXISTS officer.gateway_keys (
  key_id text PRIMARY KEY CHECK (key_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
  secret_env text NOT NULL CHECK (secret_env ~ '^OFFICER_GATEWAY_HMAC_[A-Z0-9_]{1,64}$'),
  enabled boolean NOT NULL DEFAULT false,
  allowed_capabilities text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE officer.gateway_keys IS 'Calling-system keys. enabled=false is the soft kill switch. secret_env names an Edge secret; the value is never in the database.';

-- Replay guard: (key_id, nonce) inserted inside the same transaction as the work.
CREATE TABLE IF NOT EXISTS officer.request_nonces (
  key_id text NOT NULL,
  nonce uuid NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key_id, nonce)
);
CREATE INDEX IF NOT EXISTS idx_officer_request_nonces_seen_at ON officer.request_nonces (seen_at);
COMMENT ON TABLE officer.request_nonces IS 'Replay guard. Duplicate (key_id, nonce) raises 23505 replayed_request. Rows older than 15 minutes are pruned on each execute.';

-- The published catalog. Text here is shown to officers verbatim; keep it plain.
CREATE TABLE IF NOT EXISTS officer.capabilities (
  name text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]{0,63}$'),
  version integer NOT NULL CHECK (version >= 1),
  kind text NOT NULL CHECK (kind IN ('read','command')),
  title text NOT NULL CHECK (length(title) <= 80),
  description text NOT NULL CHECK (length(description) <= 400),
  synonyms text[] NOT NULL DEFAULT '{}',
  meaning text NOT NULL CHECK (length(meaning) <= 400),
  params jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(params) = 'array'),
  unit text NULL,
  allowed_officer_roles text[] NOT NULL,
  assurance text NOT NULL CHECK (assurance IN ('session','mfa')),
  phi_class text NOT NULL CHECK (phi_class = 'none'),
  requires_confirmation boolean NOT NULL,
  effects text[] NULL,
  verb_phrase text NULL,
  reversible boolean NULL,
  undo_hint text NULL,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (name, version),
  CHECK (kind <> 'command' OR requires_confirmation)
);
COMMENT ON TABLE officer.capabilities IS 'Published capability catalog. A name is never reused for a different meaning; bump version when meaning, params or result shape change.';

-- Command idempotency: (key_id, intent_id) -> stored result. Append-only.
CREATE TABLE IF NOT EXISTS officer.command_receipts (
  key_id text NOT NULL,
  intent_id uuid NOT NULL,
  officer_ref uuid NOT NULL,
  request_sha256 text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key_id, intent_id)
);
COMMENT ON TABLE officer.command_receipts IS 'Command idempotency. Same intent + same request hash replays the stored result; different hash is refused (idempotency_key_reused).';

-- Append-only audit. Names, figures, parameter values and free text never
-- appear here: capability name, versions, hashes, outcome codes only.
CREATE TABLE IF NOT EXISTS officer.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  via text NOT NULL DEFAULT 'front_office',
  key_id text,
  officer_ref uuid,
  officer_role text,
  target_user_id uuid NULL,
  capability text,
  capability_version integer,
  args_sha256 text,
  intent_id uuid NULL,
  nonce uuid,
  outcome text NOT NULL,
  error_code text NULL
);
CREATE INDEX IF NOT EXISTS idx_officer_audit_events_key_time ON officer.audit_events (key_id, occurred_at DESC);
COMMENT ON TABLE officer.audit_events IS 'Append-only. One row per accepted call (written before the work, same transaction) and one per refusal (written by officer_record_refusal after rollback). Never carries names, figures or parameter values.';

-- Operator-maintained honesty table: which facilities carry live records. Only
-- Homewood Lodge does today; facilities 001, 002, 004 and 005 hold seeded
-- demonstration rows (033_seed_oakridge_demo_data.sql, 120_col_multi_facility_demo_seed.sql).
-- Every read labels each by_facility row with its coverage and appends a fixed
-- qualifier whenever a demo facility is covered.
CREATE TABLE IF NOT EXISTS officer.facility_coverage (
  facility_id uuid PRIMARY KEY REFERENCES public.facilities (id),
  coverage text NOT NULL CHECK (coverage IN ('live','demo','none')),
  note text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE officer.facility_coverage IS 'Operator-maintained: live = operations data, demo = seeded demonstration rows, none = no records. Drives the coverage label and the demo qualifier on every read.';

ALTER TABLE officer.federated_officers ENABLE ROW LEVEL SECURITY;
ALTER TABLE officer.gateway_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE officer.request_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE officer.capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE officer.command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE officer.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE officer.facility_coverage ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 2. Append-only trigger (the haven.stand_up_immutable pattern, 336)
-- =============================================================================
CREATE OR REPLACE FUNCTION officer.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  RAISE EXCEPTION 'officer.% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$fn$;

DROP TRIGGER IF EXISTS officer_audit_events_append_only ON officer.audit_events;
CREATE TRIGGER officer_audit_events_append_only
  BEFORE UPDATE OR DELETE ON officer.audit_events
  FOR EACH ROW EXECUTE FUNCTION officer.reject_mutation();

DROP TRIGGER IF EXISTS officer_command_receipts_append_only ON officer.command_receipts;
CREATE TRIGGER officer_command_receipts_append_only
  BEFORE UPDATE OR DELETE ON officer.command_receipts
  FOR EACH ROW EXECUTE FUNCTION officer.reject_mutation();

-- =============================================================================
-- 3. Private helpers
-- =============================================================================

-- The published catalog version. Bump here (and only here) when any capability
-- row changes; Front Office shows it beside every figure.
CREATE OR REPLACE FUNCTION officer.catalog_version()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$ SELECT '2026-09-11.2'::text $fn$;

-- Refusal helper: the published code is the message, the SQLSTATE selects the
-- HTTP status in the Edge Function (42501 -> 403, 22023 -> 400, P0409 -> 409,
-- P0401 -> 401, P0429 -> 429, 23505 -> 409).
CREATE OR REPLACE FUNCTION officer.refuse(p_code text, p_sqlstate text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  RAISE EXCEPTION USING MESSAGE = p_code, ERRCODE = p_sqlstate;
END;
$fn$;

-- UTC calendar date, the executive KPI convention (exec-kpi-metrics.ts utcTodayDate).
CREATE OR REPLACE FUNCTION officer.utc_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$ SELECT (pg_catalog.now() AT TIME ZONE 'UTC')::date $fn$;

CREATE OR REPLACE FUNCTION officer.iso_now()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$ SELECT to_char(pg_catalog.now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $fn$;

-- The organization's non-deleted facilities with their coverage label
-- (NULL when the operator has not classified a facility).
CREATE OR REPLACE FUNCTION officer.scope_facilities(p_organization_id uuid)
RETURNS TABLE (facility_id uuid, facility_name text, coverage text, licensed_beds integer)
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT f.id, left(f.name, 80), c.coverage, f.total_licensed_beds
  FROM public.facilities f
  LEFT JOIN officer.facility_coverage c ON c.facility_id = f.id
  WHERE f.organization_id = p_organization_id
    AND f.deleted_at IS NULL
  ORDER BY f.name
  LIMIT 50
$fn$;

CREATE OR REPLACE FUNCTION officer.demo_qualifier()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$ SELECT 'Figures for facilities marked demo come from seeded demonstration data, not operations.'::text $fn$;

-- Append the demo qualifier when any covered facility is a demo facility.
CREATE OR REPLACE FUNCTION officer.with_demo_qualifier(p_qualifiers text[], p_organization_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM officer.scope_facilities(p_organization_id) s WHERE s.coverage = 'demo')
              THEN p_qualifiers || officer.demo_qualifier()
              ELSE p_qualifiers END
$fn$;

-- The one JSON shape every read returns (contract section 2.6). Building it in
-- one place keeps the top-level key set exact: Front Office rejects anything else.
CREATE OR REPLACE FUNCTION officer.read_envelope(
  p_capability text,
  p_version integer,
  p_validity text,
  p_value numeric,
  p_unit text,
  p_qualifiers text[],
  p_data jsonb,
  p_missing_count integer,
  p_audit_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT jsonb_build_object(
    'ok', true,
    'kind', 'read',
    'capability', p_capability,
    'version', p_version,
    'generated_at', officer.iso_now(),
    'as_of', officer.iso_now(),
    'freshness', jsonb_build_object('state', 'current'),
    'validity', p_validity,
    'value', CASE WHEN p_validity = 'valid' THEN to_jsonb(p_value) ELSE 'null'::jsonb END,
    'unit', p_unit,
    'qualifiers', to_jsonb(COALESCE(p_qualifiers, '{}'::text[])),
    'data', COALESCE(p_data, '{}'::jsonb),
    'missing', jsonb_build_object('count', COALESCE(p_missing_count, 0)),
    'audit_id', p_audit_id
  )
$fn$;

-- Validate p_args against the capability's declared params: exact key set,
-- scalar types, enum membership, string length <= 200. Raises invalid_args.
-- Every v1 read declares no params, so only {} is accepted for them.
CREATE OR REPLACE FUNCTION officer.assert_args(p_params jsonb, p_args jsonb)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $fn$
DECLARE
  v_param jsonb;
  v_name text;
  v_type text;
  v_value jsonb;
  v_declared text[] := '{}';
  v_key text;
BEGIN
  IF p_args IS NULL OR jsonb_typeof(p_args) <> 'object' THEN
    PERFORM officer.refuse('invalid_args', '22023');
  END IF;
  FOR v_param IN SELECT value FROM jsonb_array_elements(COALESCE(p_params, '[]'::jsonb)) LOOP
    v_name := v_param->>'name';
    v_type := v_param->>'type';
    v_declared := v_declared || v_name;
    v_value := p_args->v_name;
    IF v_value IS NULL OR jsonb_typeof(v_value) = 'null' THEN
      IF COALESCE((v_param->>'required')::boolean, false) THEN
        PERFORM officer.refuse('invalid_args', '22023');
      END IF;
      CONTINUE;
    END IF;
    IF v_type = 'string' THEN
      IF jsonb_typeof(v_value) <> 'string' OR length(v_value #>> '{}') > 200 THEN
        PERFORM officer.refuse('invalid_args', '22023');
      END IF;
      IF v_param ? 'enum' AND NOT (v_param->'enum' @> v_value) THEN
        PERFORM officer.refuse('invalid_args', '22023');
      END IF;
    ELSIF v_type = 'integer' THEN
      IF jsonb_typeof(v_value) <> 'number' OR (v_value #>> '{}')::numeric <> trunc((v_value #>> '{}')::numeric) THEN
        PERFORM officer.refuse('invalid_args', '22023');
      END IF;
    ELSIF v_type = 'number' THEN
      IF jsonb_typeof(v_value) <> 'number' THEN
        PERFORM officer.refuse('invalid_args', '22023');
      END IF;
    ELSIF v_type = 'boolean' THEN
      IF jsonb_typeof(v_value) <> 'boolean' THEN
        PERFORM officer.refuse('invalid_args', '22023');
      END IF;
    ELSIF v_type = 'date' THEN
      IF jsonb_typeof(v_value) <> 'string' OR (v_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN
        PERFORM officer.refuse('invalid_args', '22023');
      END IF;
      BEGIN
        PERFORM (v_value #>> '{}')::date;
      EXCEPTION WHEN OTHERS THEN
        PERFORM officer.refuse('invalid_args', '22023');
      END;
    ELSE
      PERFORM officer.refuse('invalid_args', '22023');
    END IF;
  END LOOP;
  FOR v_key IN SELECT jsonb_object_keys(p_args) LOOP
    IF NOT (v_key = ANY(v_declared)) THEN
      PERFORM officer.refuse('invalid_args', '22023');
    END IF;
  END LOOP;
END;
$fn$;

-- Render one capability row as the contract's Capability object.
CREATE OR REPLACE FUNCTION officer.capability_json(c officer.capabilities)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'name', c.name,
    'version', c.version,
    'kind', c.kind,
    'title', c.title,
    'description', c.description,
    'synonyms', to_jsonb(c.synonyms),
    'meaning', c.meaning,
    'params', c.params,
    'unit', c.unit,
    'allowed_officer_roles', to_jsonb(c.allowed_officer_roles),
    'assurance', c.assurance,
    'phi_class', c.phi_class,
    'requires_confirmation', c.requires_confirmation,
    'effects', CASE WHEN c.effects IS NULL THEN NULL ELSE to_jsonb(c.effects) END,
    'verb_phrase', c.verb_phrase,
    'reversible', c.reversible,
    'undo_hint', c.undo_hint
  ))
$fn$;

-- =============================================================================
-- 4. Read capabilities (fixed SQL, organization-wide, scoped by the registry
--    organization only; each returns data.by_facility with a coverage label)
-- =============================================================================

-- occupied_beds: residents with status active / hospital_hold / loa and
-- deleted_at null (exec-kpi-metrics.ts:318-323; haven.vw_v2_facility_rollup 211:36-45).
CREATE OR REPLACE FUNCTION officer.read_occupied_beds(p_organization_id uuid, p_version integer, p_audit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_total bigint;
  v_by_facility jsonb;
  v_facilities integer;
BEGIN
  SELECT count(*) INTO v_total
  FROM public.residents r
  WHERE r.organization_id = p_organization_id
    AND r.deleted_at IS NULL
    AND r.status IN ('active', 'hospital_hold', 'loa');

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('facility', x.facility_name, 'coverage', x.coverage, 'value', x.n)) ORDER BY x.facility_name), '[]'::jsonb), count(*)
    INTO v_by_facility, v_facilities
  FROM (
    SELECT s.facility_name, s.coverage,
           (SELECT count(*) FROM public.residents r
             WHERE r.facility_id = s.facility_id AND r.organization_id = p_organization_id
               AND r.deleted_at IS NULL AND r.status IN ('active', 'hospital_hold', 'loa')) AS n
    FROM officer.scope_facilities(p_organization_id) s
  ) x;

  RETURN officer.read_envelope(
    'occupied_beds', p_version, 'valid', v_total, 'beds',
    officer.with_demo_qualifier(ARRAY['Counts residents whose status is active, hospital hold or leave of absence and who are not deleted, at the time of the read. Residents on hospital hold or leave keep their bed and are counted.'], p_organization_id),
    jsonb_build_object('facilities_covered', v_facilities, 'by_facility', v_by_facility),
    0, p_audit_id);
END;
$fn$;

-- licensed_capacity: sum of facilities.total_licensed_beds, with occupancy
-- percent against occupied_beds when both figures exist (exec-kpi-metrics.ts:489-499).
CREATE OR REPLACE FUNCTION officer.read_licensed_capacity(p_organization_id uuid, p_version integer, p_audit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_capacity bigint;
  v_facilities integer;
  v_missing integer;
  v_occupied bigint;
  v_by_facility jsonb;
  v_data jsonb;
  v_qualifiers text[] := officer.with_demo_qualifier(ARRAY['Sum of licensed beds across the organization''s facilities that are not deleted. Occupancy percent divides occupied beds (active, hospital hold or leave residents) by this figure.'], p_organization_id);
BEGIN
  SELECT COALESCE(sum(s.licensed_beds), 0), count(*), count(*) FILTER (WHERE COALESCE(s.licensed_beds, 0) <= 0),
         COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('facility', s.facility_name, 'coverage', s.coverage, 'value', s.licensed_beds)) ORDER BY s.facility_name), '[]'::jsonb)
    INTO v_capacity, v_facilities, v_missing, v_by_facility
  FROM officer.scope_facilities(p_organization_id) s;

  IF v_facilities = 0 THEN
    RETURN officer.read_envelope('licensed_capacity', p_version, 'no_data', NULL, 'beds',
      v_qualifiers || 'No facilities are registered for this organization.'::text,
      jsonb_build_object('facilities_covered', 0, 'by_facility', '[]'::jsonb), 0, p_audit_id);
  END IF;

  SELECT count(*) INTO v_occupied
  FROM public.residents r
  WHERE r.organization_id = p_organization_id
    AND r.deleted_at IS NULL
    AND r.status IN ('active', 'hospital_hold', 'loa');

  v_data := jsonb_build_object('facilities_covered', v_facilities, 'by_facility', v_by_facility, 'occupied_beds', v_occupied);
  IF v_capacity > 0 THEN
    v_data := v_data || jsonb_build_object('occupancy_percent', round((v_occupied::numeric / v_capacity::numeric) * 100, 1));
  END IF;

  RETURN officer.read_envelope('licensed_capacity', p_version, 'valid', v_capacity, 'beds', v_qualifiers, v_data, v_missing, p_audit_id);
END;
$fn$;

-- open_ar_balance: open receivable balance in cents, aged by due_date.
-- Predicate: deleted_at IS NULL AND voided_at IS NULL AND balance_due > 0 AND
-- status NOT IN ('draft','void','written_off','paid'). Drafts never count.
-- Bucket SQL adapted from ai_tool_ar_aging_by_facility (234:721-742), which
-- ages by invoice_date; this read ages by due_date and says so. no_data when
-- the organization has no invoice rows at all; invoices with no open balance
-- are a valid zero.
CREATE OR REPLACE FUNCTION officer.read_open_ar_balance(p_organization_id uuid, p_version integer, p_audit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_today date := officer.utc_today();
  v_invoices_exist boolean;
  v_cents bigint;
  v_count bigint;
  v_current bigint; v_1_30 bigint; v_31_60 bigint; v_61_90 bigint; v_over_90 bigint; v_oldest integer;
  v_by_facility jsonb;
  v_facilities integer;
  v_data jsonb;
  v_qualifiers text[] := officer.with_demo_qualifier(ARRAY[
    'Sum of invoice balance_due, in cents, over invoices where deleted_at IS NULL AND voided_at IS NULL AND balance_due > 0 AND status NOT IN (draft, void, written_off, paid). Draft invoices never count. Aging buckets are by due date against today.',
    'The billing AR aging materialized view and the executive KPI dashboard use different predicates (the view excludes draft and void by status only and keeps zero balances; the KPI applies no status filter), so those three figures will not agree.'
  ], p_organization_id);
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.invoices i WHERE i.organization_id = p_organization_id AND i.deleted_at IS NULL)
    INTO v_invoices_exist;

  SELECT COALESCE(sum(i.balance_due), 0), count(*),
         COALESCE(sum(CASE WHEN (v_today - i.due_date) <= 0 THEN i.balance_due ELSE 0 END), 0),
         COALESCE(sum(CASE WHEN (v_today - i.due_date) BETWEEN 1 AND 30 THEN i.balance_due ELSE 0 END), 0),
         COALESCE(sum(CASE WHEN (v_today - i.due_date) BETWEEN 31 AND 60 THEN i.balance_due ELSE 0 END), 0),
         COALESCE(sum(CASE WHEN (v_today - i.due_date) BETWEEN 61 AND 90 THEN i.balance_due ELSE 0 END), 0),
         COALESCE(sum(CASE WHEN (v_today - i.due_date) > 90 THEN i.balance_due ELSE 0 END), 0),
         COALESCE(max(CASE WHEN (v_today - i.due_date) > 0 THEN (v_today - i.due_date) END), 0)
    INTO v_cents, v_count, v_current, v_1_30, v_31_60, v_61_90, v_over_90, v_oldest
  FROM public.invoices i
  WHERE i.organization_id = p_organization_id
    AND i.deleted_at IS NULL
    AND i.voided_at IS NULL
    AND i.balance_due > 0
    AND i.status NOT IN ('draft', 'void', 'written_off', 'paid');

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('facility', x.facility_name, 'coverage', x.coverage, 'value', x.cents, 'invoice_count', x.n)) ORDER BY x.facility_name), '[]'::jsonb), count(*)
    INTO v_by_facility, v_facilities
  FROM (
    SELECT s.facility_name, s.coverage,
           (SELECT COALESCE(sum(i.balance_due), 0) FROM public.invoices i
             WHERE i.facility_id = s.facility_id AND i.organization_id = p_organization_id
               AND i.deleted_at IS NULL AND i.voided_at IS NULL AND i.balance_due > 0
               AND i.status NOT IN ('draft', 'void', 'written_off', 'paid')) AS cents,
           (SELECT count(*) FROM public.invoices i
             WHERE i.facility_id = s.facility_id AND i.organization_id = p_organization_id
               AND i.deleted_at IS NULL AND i.voided_at IS NULL AND i.balance_due > 0
               AND i.status NOT IN ('draft', 'void', 'written_off', 'paid')) AS n
    FROM officer.scope_facilities(p_organization_id) s
  ) x;

  v_data := jsonb_build_object(
    'invoice_count', v_count, 'facilities_covered', v_facilities, 'by_facility', v_by_facility,
    'aging_current_cents', v_current, 'aging_1_30_cents', v_1_30, 'aging_31_60_cents', v_31_60,
    'aging_61_90_cents', v_61_90, 'aging_90_plus_cents', v_over_90, 'oldest_past_due_days', v_oldest);

  IF NOT v_invoices_exist THEN
    RETURN officer.read_envelope('open_ar_balance', p_version, 'no_data', NULL, 'cents',
      v_qualifiers || 'No invoices exist for this organization, so there is no balance to report.'::text, v_data, 0, p_audit_id);
  END IF;
  RETURN officer.read_envelope('open_ar_balance', p_version, 'valid', v_cents, 'cents', v_qualifiers, v_data, 0, p_audit_id);
END;
$fn$;

-- billed_revenue_mtd: sum of invoices.total for invoices dated from the first
-- of the current UTC month through today, status in sent/paid/partial/overdue,
-- deleted_at null, voided_at null (exec-kpi-metrics.ts:333-341). The seeded
-- rev_mtd metric definition (151) cites a column that does not exist; ignored.
-- no_data when no invoice rows at all are dated inside the period.
CREATE OR REPLACE FUNCTION officer.read_billed_revenue_mtd(p_organization_id uuid, p_version integer, p_audit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_today date := officer.utc_today();
  v_month_start date := date_trunc('month', officer.utc_today())::date;
  v_in_period bigint;
  v_cents bigint;
  v_count bigint;
  v_by_facility jsonb;
  v_facilities integer;
  v_data jsonb;
  v_qualifiers text[];
BEGIN
  v_qualifiers := officer.with_demo_qualifier(ARRAY[
    'Sum of invoice totals, in cents, for invoices dated ' || to_char(v_month_start, 'YYYY-MM-DD') || ' through ' || to_char(v_today, 'YYYY-MM-DD') || ' with status sent, paid, partial or overdue, excluding deleted and voided invoices. Drafts are not counted. Same definition as the executive KPI dashboard.'
  ], p_organization_id);

  SELECT count(*) INTO v_in_period
  FROM public.invoices i
  WHERE i.organization_id = p_organization_id AND i.deleted_at IS NULL
    AND i.invoice_date >= v_month_start AND i.invoice_date <= v_today;

  SELECT COALESCE(sum(i.total), 0), count(*) INTO v_cents, v_count
  FROM public.invoices i
  WHERE i.organization_id = p_organization_id AND i.deleted_at IS NULL AND i.voided_at IS NULL
    AND i.invoice_date >= v_month_start AND i.invoice_date <= v_today
    AND i.status IN ('sent', 'paid', 'partial', 'overdue');

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('facility', x.facility_name, 'coverage', x.coverage, 'value', x.cents, 'invoice_count', x.n)) ORDER BY x.facility_name), '[]'::jsonb), count(*)
    INTO v_by_facility, v_facilities
  FROM (
    SELECT s.facility_name, s.coverage,
           (SELECT COALESCE(sum(i.total), 0) FROM public.invoices i
             WHERE i.facility_id = s.facility_id AND i.organization_id = p_organization_id
               AND i.deleted_at IS NULL AND i.voided_at IS NULL
               AND i.invoice_date >= v_month_start AND i.invoice_date <= v_today
               AND i.status IN ('sent', 'paid', 'partial', 'overdue')) AS cents,
           (SELECT count(*) FROM public.invoices i
             WHERE i.facility_id = s.facility_id AND i.organization_id = p_organization_id
               AND i.deleted_at IS NULL AND i.voided_at IS NULL
               AND i.invoice_date >= v_month_start AND i.invoice_date <= v_today
               AND i.status IN ('sent', 'paid', 'partial', 'overdue')) AS n
    FROM officer.scope_facilities(p_organization_id) s
  ) x;

  v_data := jsonb_build_object('invoice_count', v_count, 'facilities_covered', v_facilities, 'by_facility', v_by_facility,
    'period_start', to_char(v_month_start, 'YYYY-MM-DD'), 'period_end', to_char(v_today, 'YYYY-MM-DD'));

  IF v_in_period = 0 THEN
    RETURN officer.read_envelope('billed_revenue_mtd', p_version, 'no_data', NULL, 'cents',
      v_qualifiers || 'No invoices are dated inside the period, so there is no billed revenue to report.'::text, v_data, 0, p_audit_id);
  END IF;
  RETURN officer.read_envelope('billed_revenue_mtd', p_version, 'valid', v_cents, 'cents', v_qualifiers, v_data, 0, p_audit_id);
END;
$fn$;

-- incidents_last_30_days: incidents by occurred_at in the trailing 30 UTC days
-- (today and the 29 days before it), deleted_at null (exec-kpi-metrics.ts:350-357).
CREATE OR REPLACE FUNCTION officer.read_incidents_last_30_days(p_organization_id uuid, p_version integer, p_audit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_today date := officer.utc_today();
  v_from timestamptz := ((v_today - 29)::timestamp AT TIME ZONE 'UTC');
  v_to timestamptz := ((v_today + 1)::timestamp AT TIME ZONE 'UTC');
  v_total bigint;
  v_by_facility jsonb;
  v_facilities integer;
BEGIN
  SELECT count(*) INTO v_total
  FROM public.incidents i
  WHERE i.organization_id = p_organization_id
    AND i.deleted_at IS NULL
    AND i.occurred_at >= v_from
    AND i.occurred_at < v_to;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('facility', x.facility_name, 'coverage', x.coverage, 'value', x.n)) ORDER BY x.facility_name), '[]'::jsonb), count(*)
    INTO v_by_facility, v_facilities
  FROM (
    SELECT s.facility_name, s.coverage,
           (SELECT count(*) FROM public.incidents i
             WHERE i.facility_id = s.facility_id AND i.organization_id = p_organization_id
               AND i.deleted_at IS NULL AND i.occurred_at >= v_from AND i.occurred_at < v_to) AS n
    FROM officer.scope_facilities(p_organization_id) s
  ) x;

  RETURN officer.read_envelope(
    'incidents_last_30_days', p_version, 'valid', v_total, 'incidents',
    officer.with_demo_qualifier(ARRAY['Counts incident reports whose occurrence time falls in the last 30 UTC days including today, excluding deleted reports. All severities and statuses are included.'], p_organization_id),
    jsonb_build_object('facilities_covered', v_facilities, 'by_facility', v_by_facility, 'window_days', 30),
    0, p_audit_id);
END;
$fn$;

-- staff_certifications_expiring_30_days: active certifications whose
-- expiration_date is between today and today + 30 days (UTC dates), deleted_at
-- null (exec-kpi-metrics.ts workforce predicate). Count only; never names.
CREATE OR REPLACE FUNCTION officer.read_staff_certifications_expiring_30_days(p_organization_id uuid, p_version integer, p_audit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_today date := officer.utc_today();
  v_total bigint;
  v_by_facility jsonb;
  v_facilities integer;
BEGIN
  SELECT count(*) INTO v_total
  FROM public.staff_certifications c
  WHERE c.organization_id = p_organization_id
    AND c.deleted_at IS NULL
    AND c.status = 'active'
    AND c.expiration_date IS NOT NULL
    AND c.expiration_date >= v_today
    AND c.expiration_date <= v_today + 30;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('facility', x.facility_name, 'coverage', x.coverage, 'value', x.n)) ORDER BY x.facility_name), '[]'::jsonb), count(*)
    INTO v_by_facility, v_facilities
  FROM (
    SELECT s.facility_name, s.coverage,
           (SELECT count(*) FROM public.staff_certifications c
             WHERE c.facility_id = s.facility_id AND c.organization_id = p_organization_id
               AND c.deleted_at IS NULL AND c.status = 'active' AND c.expiration_date IS NOT NULL
               AND c.expiration_date >= v_today AND c.expiration_date <= v_today + 30) AS n
    FROM officer.scope_facilities(p_organization_id) s
  ) x;

  RETURN officer.read_envelope(
    'staff_certifications_expiring_30_days', p_version, 'valid', v_total, 'certifications',
    officer.with_demo_qualifier(ARRAY['Counts staff certifications with status active and an expiration date between today and 30 days from today, excluding deleted records. Certifications already expired are not counted.'], p_organization_id),
    jsonb_build_object('facilities_covered', v_facilities, 'by_facility', v_by_facility, 'window_days', 30),
    0, p_audit_id);
END;
$fn$;

-- =============================================================================
-- 5. The synthetic command
-- =============================================================================
-- command_ping writes only officer.command_receipts (plus the audit row written
-- by officer_execute). It touches no domain table. It exists to prove signing,
-- nonce, registry, intent binding, idempotency and audit end to end.
CREATE OR REPLACE FUNCTION officer.command_ping(
  p_key_id text,
  p_officer_ref uuid,
  p_intent_id uuid,
  p_request_sha256 text,
  p_version integer,
  p_audit_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_now text := officer.iso_now();
  v_result jsonb;
BEGIN
  v_result := jsonb_build_object(
    'ok', true,
    'kind', 'command',
    'capability', 'command_ping',
    'version', p_version,
    'receipt', jsonb_build_object('intent_id', p_intent_id, 'replayed', false, 'executed_at', v_now, 'audit_id', p_audit_id),
    'result', jsonb_build_object('pong', true, 'server_time', v_now)
  );
  INSERT INTO officer.command_receipts (key_id, intent_id, officer_ref, request_sha256, result)
  VALUES (p_key_id, p_intent_id, p_officer_ref, p_request_sha256, v_result);
  RETURN v_result;
END;
$fn$;

-- =============================================================================
-- 6. Public doors (service_role only)
-- =============================================================================

-- Which Edge secret holds this key's HMAC, and whether the key is enabled.
-- Returns NULL for an unknown key so the Edge Function answers a uniform 401.
CREATE OR REPLACE FUNCTION public.officer_key_secret_env(p_key_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT jsonb_build_object('secret_env', k.secret_env, 'enabled', k.enabled)
  FROM officer.gateway_keys k
  WHERE k.key_id = p_key_id
$fn$;
COMMENT ON FUNCTION public.officer_key_secret_env(text) IS 'officer-catalog Edge Function only. Returns the Edge secret NAME (never a value) and the enabled flag for a gateway key.';

-- The catalog: enabled capabilities the key is allowed to invoke.
CREATE OR REPLACE FUNCTION public.officer_catalog(p_key_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_key officer.gateway_keys%ROWTYPE;
  v_caps jsonb;
BEGIN
  SELECT * INTO v_key FROM officer.gateway_keys k WHERE k.key_id = p_key_id AND k.enabled;
  IF NOT FOUND THEN
    PERFORM officer.refuse('key_disabled', '42501');
  END IF;
  SELECT COALESCE(jsonb_agg(officer.capability_json(c) ORDER BY c.kind, c.name, c.version), '[]'::jsonb)
    INTO v_caps
  FROM officer.capabilities c
  WHERE c.enabled AND c.name = ANY(v_key.allowed_capabilities);
  RETURN jsonb_build_object(
    'target', 'haven',
    'contract', 'front-office-capability-v1',
    'catalog_version', officer.catalog_version(),
    'generated_at', officer.iso_now(),
    'capabilities', v_caps
  );
END;
$fn$;
COMMENT ON FUNCTION public.officer_catalog(text) IS 'officer-catalog Edge Function only. Enabled capabilities the gateway key may invoke, contract front-office-capability-v1.';

-- Execute one read or one command. Checks run in the contract's order (2.6):
-- key enabled and allowed; skew; nonce; officer registered, active, in window,
-- email and role match; capability enabled and version current; role allowed;
-- assurance; args; command intent and idempotency. Then the audit row, then
-- the work, in one transaction. Dispatch is a CASE over fixed functions; no
-- dynamic SQL touches any caller value.
CREATE OR REPLACE FUNCTION public.officer_execute(
  p_key_id text,
  p_officer_ref uuid,
  p_officer_email text,
  p_officer_role text,
  p_officer_assurance text,
  p_nonce uuid,
  p_sent_at timestamptz,
  p_capability text,
  p_version integer,
  p_args jsonb,
  p_catalog_hash text,
  p_intent jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_key officer.gateway_keys%ROWTYPE;
  v_officer officer.federated_officers%ROWTYPE;
  v_cap officer.capabilities%ROWTYPE;
  v_recent integer;
  v_intent_id uuid;
  v_request_sha256 text;
  v_args_sha256 text;
  v_prior officer.command_receipts%ROWTYPE;
  v_audit_id uuid;
  v_result jsonb;
BEGIN
  -- PostgREST reproduces a JSON null for a jsonb parameter; treat it as absent.
  IF p_intent IS NOT NULL AND jsonb_typeof(p_intent) = 'null' THEN
    p_intent := NULL;
  END IF;

  -- Opportunistic nonce pruning (15-minute memory).
  DELETE FROM officer.request_nonces n WHERE n.seen_at < pg_catalog.now() - interval '15 minutes';

  -- 1. Key enabled and allowed for this capability.
  IF p_key_id IS NULL OR p_capability IS NULL OR p_capability !~ '^[a-z][a-z0-9_]{0,63}$' THEN
    PERFORM officer.refuse('invalid_args', '22023');
  END IF;
  SELECT * INTO v_key FROM officer.gateway_keys k WHERE k.key_id = p_key_id;
  IF NOT FOUND OR NOT v_key.enabled THEN
    PERFORM officer.refuse('key_disabled', '42501');
  END IF;
  IF NOT (p_capability = ANY(v_key.allowed_capabilities)) THEN
    PERFORM officer.refuse('capability_denied', '42501');
  END IF;

  -- Serialize per key (the 336 pattern): rate limit count, nonce and receipt
  -- checks below then see each other's commits in order.
  PERFORM pg_advisory_xact_lock(hashtextextended('officer_execute:' || p_key_id, 0));

  -- Rate limit: 60 execute calls per key per minute, counted in audit_events.
  SELECT count(*) INTO v_recent
  FROM officer.audit_events a
  WHERE a.key_id = p_key_id AND a.occurred_at > pg_catalog.now() - interval '1 minute';
  IF v_recent >= 60 THEN
    PERFORM officer.refuse('rate_limited', 'P0429');
  END IF;

  -- 2. Clock skew: 60 seconds either way.
  IF p_sent_at IS NULL OR abs(extract(epoch FROM (pg_catalog.now() - p_sent_at))) > 60 THEN
    PERFORM officer.refuse('expired_request', 'P0401');
  END IF;

  -- 3. Nonce, in this transaction. A duplicate is a replay.
  IF p_nonce IS NULL THEN
    PERFORM officer.refuse('invalid_args', '22023');
  END IF;
  BEGIN
    INSERT INTO officer.request_nonces (key_id, nonce) VALUES (p_key_id, p_nonce);
  EXCEPTION WHEN unique_violation THEN
    PERFORM officer.refuse('replayed_request', '23505');
  END;

  -- 4. Officer: registered, email and role match, active, in validity window.
  SELECT * INTO v_officer FROM officer.federated_officers o WHERE o.front_office_profile_id = p_officer_ref;
  IF NOT FOUND
     OR lower(btrim(v_officer.email)) IS DISTINCT FROM lower(btrim(COALESCE(p_officer_email, '')))
     OR v_officer.officer_role IS DISTINCT FROM p_officer_role THEN
    PERFORM officer.refuse('principal_unknown', '42501');
  END IF;
  IF NOT v_officer.is_active
     OR v_officer.valid_from > pg_catalog.now()
     OR (v_officer.valid_until IS NOT NULL AND v_officer.valid_until <= pg_catalog.now()) THEN
    PERFORM officer.refuse('principal_inactive', '42501');
  END IF;

  -- 5. Capability enabled and version current.
  SELECT * INTO v_cap FROM officer.capabilities c WHERE c.name = p_capability AND c.enabled ORDER BY c.version DESC LIMIT 1;
  IF NOT FOUND THEN
    PERFORM officer.refuse('capability_denied', '42501');
  END IF;
  IF p_version IS DISTINCT FROM v_cap.version THEN
    PERFORM officer.refuse('version_conflict', 'P0409');
  END IF;

  -- 6. Role allowed.
  IF NOT (p_officer_role = ANY(v_cap.allowed_officer_roles)) THEN
    PERFORM officer.refuse('capability_denied', '42501');
  END IF;

  -- 7. Assurance satisfied.
  IF p_officer_assurance IS NULL OR p_officer_assurance NOT IN ('session', 'mfa') THEN
    PERFORM officer.refuse('invalid_args', '22023');
  END IF;
  IF v_cap.assurance = 'mfa' AND p_officer_assurance <> 'mfa' THEN
    PERFORM officer.refuse('assurance_required', '42501');
  END IF;

  -- 8. Args exact key set, scalar types, enum membership, length bound.
  PERFORM officer.assert_args(v_cap.params, p_args);
  IF p_catalog_hash IS NULL OR p_catalog_hash !~ '^[0-9a-f]{64}$' THEN
    PERFORM officer.refuse('invalid_args', '22023');
  END IF;
  v_args_sha256 := encode(sha256(convert_to(p_args::text, 'UTF8')), 'hex');

  -- 9. Commands: intent required; idempotency by (key, intent) and request hash.
  IF v_cap.kind = 'command' THEN
    IF p_intent IS NULL OR jsonb_typeof(p_intent) <> 'object' OR (p_intent->>'intent_id') IS NULL THEN
      PERFORM officer.refuse('invalid_args', '22023');
    END IF;
    BEGIN
      v_intent_id := (p_intent->>'intent_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      PERFORM officer.refuse('invalid_args', '22023');
    END;
    IF p_intent ? 'expected_version' AND jsonb_typeof(p_intent->'expected_version') NOT IN ('null', 'number') THEN
      PERFORM officer.refuse('invalid_args', '22023');
    END IF;
    v_request_sha256 := encode(sha256(convert_to(jsonb_build_object(
      'capability', p_capability, 'version', p_version, 'args', p_args, 'officer_ref', p_officer_ref)::text, 'UTF8')), 'hex');
    SELECT * INTO v_prior FROM officer.command_receipts r WHERE r.key_id = p_key_id AND r.intent_id = v_intent_id;
    IF FOUND THEN
      IF v_prior.request_sha256 <> v_request_sha256 THEN
        PERFORM officer.refuse('idempotency_key_reused', '22023');
      END IF;
      INSERT INTO officer.audit_events (key_id, officer_ref, officer_role, target_user_id, capability, capability_version, args_sha256, intent_id, nonce, outcome)
      VALUES (p_key_id, p_officer_ref, v_officer.officer_role, v_officer.target_user_id, p_capability, p_version, v_args_sha256, v_intent_id, p_nonce, 'replayed')
      RETURNING id INTO v_audit_id;
      RETURN jsonb_set(v_prior.result, '{receipt,replayed}', 'true'::jsonb);
    END IF;
  ELSIF p_intent IS NOT NULL THEN
    PERFORM officer.refuse('invalid_args', '22023');
  END IF;

  -- Audit first; a failed audit insert fails the call.
  INSERT INTO officer.audit_events (key_id, officer_ref, officer_role, target_user_id, capability, capability_version, args_sha256, intent_id, nonce, outcome)
  VALUES (p_key_id, p_officer_ref, v_officer.officer_role, v_officer.target_user_id, p_capability, p_version, v_args_sha256, v_intent_id, p_nonce, 'ok')
  RETURNING id INTO v_audit_id;

  -- Dispatch on the name. Never EXECUTE format() over a caller value.
  CASE p_capability
    WHEN 'occupied_beds' THEN
      v_result := officer.read_occupied_beds(v_officer.organization_id, p_version, v_audit_id);
    WHEN 'licensed_capacity' THEN
      v_result := officer.read_licensed_capacity(v_officer.organization_id, p_version, v_audit_id);
    WHEN 'open_ar_balance' THEN
      v_result := officer.read_open_ar_balance(v_officer.organization_id, p_version, v_audit_id);
    WHEN 'billed_revenue_mtd' THEN
      v_result := officer.read_billed_revenue_mtd(v_officer.organization_id, p_version, v_audit_id);
    WHEN 'incidents_last_30_days' THEN
      v_result := officer.read_incidents_last_30_days(v_officer.organization_id, p_version, v_audit_id);
    WHEN 'staff_certifications_expiring_30_days' THEN
      v_result := officer.read_staff_certifications_expiring_30_days(v_officer.organization_id, p_version, v_audit_id);
    WHEN 'command_ping' THEN
      v_result := officer.command_ping(p_key_id, p_officer_ref, v_intent_id, v_request_sha256, p_version, v_audit_id);
    ELSE
      PERFORM officer.refuse('capability_denied', '42501');
  END CASE;

  RETURN v_result;
END;
$fn$;
COMMENT ON FUNCTION public.officer_execute(text,uuid,text,text,text,uuid,timestamptz,text,integer,jsonb,text,jsonb) IS 'officer-catalog Edge Function only. Verifies key, skew, nonce, registry, capability, role, assurance, args and intent in contract order, audits, then dispatches with CASE.';

-- Record a refusal after officer_execute rolled back. Called by the Edge
-- Function only for requests whose HMAC verified, so unauthenticated callers
-- cannot fill the audit table. Codes are constrained to the published set.
CREATE OR REPLACE FUNCTION public.officer_record_refusal(
  p_key_id text,
  p_officer_ref uuid,
  p_capability text,
  p_capability_version integer,
  p_nonce uuid,
  p_error_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF p_key_id IS NULL OR p_key_id !~ '^[a-zA-Z0-9_-]{1,64}$' THEN
    RETURN;
  END IF;
  IF p_error_code IS NULL OR p_error_code NOT IN (
    'invalid_contract','invalid_args','idempotency_key_reused','expired_request',
    'key_disabled','capability_denied','principal_unknown','principal_inactive','assurance_required',
    'replayed_request','version_conflict') THEN
    RETURN;
  END IF;
  INSERT INTO officer.audit_events (key_id, officer_ref, capability, capability_version, nonce, outcome, error_code)
  VALUES (p_key_id, p_officer_ref,
          CASE WHEN p_capability ~ '^[a-z][a-z0-9_]{0,63}$' THEN p_capability END,
          p_capability_version, p_nonce, 'refused', p_error_code);
END;
$fn$;
COMMENT ON FUNCTION public.officer_record_refusal(text,uuid,text,integer,uuid,text) IS 'officer-catalog Edge Function only. Writes the refusal audit row that the rolled-back officer_execute could not keep.';

-- =============================================================================
-- 7. Seed: the catalog, facility coverage and one disabled key. No registry
--    rows, no PHI.
-- =============================================================================
INSERT INTO officer.capabilities
  (name, version, kind, title, description, synonyms, meaning, params, unit, allowed_officer_roles, assurance, phi_class, requires_confirmation, effects, verb_phrase, reversible, undo_hint, enabled)
VALUES
  ('occupied_beds', 1, 'read', 'Occupied beds',
   'How many residents currently occupy a bed across Circle of Life, with a per-facility breakdown.',
   ARRAY['census','heads in beds','occupancy','occupied beds','resident count','how many residents'],
   'Residents with status active, hospital hold or leave of absence who are not deleted, counted at the time of the read. Residents on hold or leave keep their bed.',
   '[]'::jsonb, 'beds', ARRAY['owner','ceo','cfo','coo','ctdo'], 'session', 'none', false, NULL, NULL, NULL, NULL, true),
  ('licensed_capacity', 1, 'read', 'Licensed capacity',
   'Total licensed beds across Circle of Life facilities, with occupancy percent and a per-facility breakdown.',
   ARRAY['capacity','licensed beds','occupancy rate','occupancy percent','how full','bed capacity'],
   'Sum of licensed beds over facilities that are not deleted. Occupancy percent is occupied beds divided by this figure.',
   '[]'::jsonb, 'beds', ARRAY['owner','ceo','cfo','coo','ctdo'], 'session', 'none', false, NULL, NULL, NULL, NULL, true),
  ('open_ar_balance', 1, 'read', 'Open accounts receivable balance',
   'Outstanding invoice balance in cents across Circle of Life, aged by due date, with the number of open invoices and a per-facility breakdown. Drafts never count.',
   ARRAY['AR','accounts receivable','receivables','outstanding invoices','open invoices','unpaid invoices','balance due','money owed','aging','past due'],
   'Sum of invoice balance due where not deleted, not voided, balance above zero and status not draft, void, written off or paid, aged by due date. The billing aging view and the executive KPI use different predicates and will not agree.',
   '[]'::jsonb, 'cents', ARRAY['owner','ceo','cfo','coo','ctdo'], 'session', 'none', false, NULL, NULL, NULL, NULL, true),
  ('billed_revenue_mtd', 1, 'read', 'Billed revenue month to date',
   'Invoiced total in cents from the first of the current month through today across Circle of Life, with a per-facility breakdown.',
   ARRAY['revenue','billed revenue','invoiced','billing this month','month to date','MTD revenue','rent roll billed'],
   'Sum of invoice totals dated from the first of the current month through today with status sent, paid, partial or overdue, excluding deleted and voided invoices. Drafts are not counted.',
   '[]'::jsonb, 'cents', ARRAY['owner','ceo','cfo','coo','ctdo'], 'session', 'none', false, NULL, NULL, NULL, NULL, true),
  ('incidents_last_30_days', 1, 'read', 'Incidents in the last 30 days',
   'How many incident reports occurred across Circle of Life in the trailing 30 days, with a per-facility breakdown.',
   ARRAY['incidents','incident reports','falls','events','safety incidents','incidents this month'],
   'Incident reports whose occurrence time falls in the last 30 UTC days including today, excluding deleted reports. All severities and statuses.',
   '[]'::jsonb, 'incidents', ARRAY['owner','ceo','cfo','coo','ctdo'], 'session', 'none', false, NULL, NULL, NULL, NULL, true),
  ('staff_certifications_expiring_30_days', 1, 'read', 'Staff certifications expiring within 30 days',
   'How many active staff certifications expire in the next 30 days across Circle of Life, with a per-facility breakdown.',
   ARRAY['expiring certifications','certifications expiring','certs expiring','staff credentials','training expirations','expiring licenses'],
   'Active staff certifications with an expiration date between today and 30 days from today, excluding deleted records and already expired certifications.',
   '[]'::jsonb, 'certifications', ARRAY['owner','ceo','cfo','coo','ctdo'], 'session', 'none', false, NULL, NULL, NULL, NULL, true),
  ('command_ping', 1, 'command', 'Test note',
   'Synthetic command that records a test note in Circle of Life. Proves the confirm step end to end and changes nothing in the business.',
   ARRAY['ping','test note','test the connection','connection test'],
   'Writes one receipt and one audit row in Circle of Life. No resident, staff, billing or facility record is touched.',
   '[]'::jsonb, NULL, ARRAY['owner','ceo','cfo','coo','ctdo'], 'session', 'none', true,
   ARRAY['Synthetic. Proves the confirm step; changes nothing in the business.'],
   'record the test note in Circle of Life', true, NULL, true)
ON CONFLICT (name, version) DO UPDATE SET
  kind = EXCLUDED.kind,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  synonyms = EXCLUDED.synonyms,
  meaning = EXCLUDED.meaning,
  params = EXCLUDED.params,
  unit = EXCLUDED.unit,
  allowed_officer_roles = EXCLUDED.allowed_officer_roles,
  assurance = EXCLUDED.assurance,
  phi_class = EXCLUDED.phi_class,
  requires_confirmation = EXCLUDED.requires_confirmation,
  effects = EXCLUDED.effects,
  verb_phrase = EXCLUDED.verb_phrase,
  reversible = EXCLUDED.reversible,
  undo_hint = EXCLUDED.undo_hint;

-- Facility coverage: Homewood Lodge is the controlled real-data launch
-- facility; the other four hold seeded demonstration rows. Operator-maintained
-- after this seed (DO NOTHING on replay so an operator change survives).
INSERT INTO officer.facility_coverage (facility_id, coverage, note)
SELECT v.id, v.coverage, v.note
FROM (VALUES
  ('00000000-0000-0000-0002-000000000003'::uuid, 'live', 'Homewood Lodge: controlled real-data launch facility.'),
  ('00000000-0000-0000-0002-000000000001'::uuid, 'demo', 'Oakridge: historical seeded validation pilot (033); demonstration rows only.'),
  ('00000000-0000-0000-0002-000000000002'::uuid, 'demo', 'Rising Oaks: seeded demonstration rows (120).'),
  ('00000000-0000-0000-0002-000000000004'::uuid, 'demo', 'The Plantation on Summers: seeded demonstration rows (120).'),
  ('00000000-0000-0000-0002-000000000005'::uuid, 'demo', 'Grande Cypress: seeded demonstration rows (120).')
) AS v (id, coverage, note)
WHERE EXISTS (SELECT 1 FROM public.facilities f WHERE f.id = v.id)
ON CONFLICT (facility_id) DO NOTHING;

-- The Front Office key ships disabled. The operator enables it after the Edge
-- secret OFFICER_GATEWAY_HMAC_FRONT_OFFICE_V1 is set and the registry rows are
-- inserted (docs/specs/OFFICER-CAPABILITY-CATALOG.md section 6).
INSERT INTO officer.gateway_keys (key_id, secret_env, enabled, allowed_capabilities)
VALUES ('front_office_v1', 'OFFICER_GATEWAY_HMAC_FRONT_OFFICE_V1', false,
        ARRAY['occupied_beds','licensed_capacity','open_ar_balance','billed_revenue_mtd','incidents_last_30_days','staff_certifications_expiring_30_days','command_ping'])
ON CONFLICT (key_id) DO NOTHING;

-- =============================================================================
-- 8. Grants: the doors to service_role only; everything private to nobody.
--    Runs after every definition because CREATE OR REPLACE resets EXECUTE.
-- =============================================================================
REVOKE ALL ON FUNCTION public.officer_key_secret_env(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.officer_catalog(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.officer_execute(text,uuid,text,text,text,uuid,timestamptz,text,integer,jsonb,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.officer_record_refusal(text,uuid,text,integer,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.officer_key_secret_env(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.officer_catalog(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.officer_execute(text,uuid,text,text,text,uuid,timestamptz,text,integer,jsonb,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.officer_record_refusal(text,uuid,text,integer,uuid,text) TO service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA officer FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA officer FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA officer FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
COMMIT;
-- Rollback: scripts/officer/disable-officer-catalog.sql revokes the four doors
-- from service_role and keeps every audit row. Full removal is
-- DROP FUNCTION public.officer_execute(text,uuid,text,text,text,uuid,timestamptz,text,integer,jsonb,text,jsonb),
-- public.officer_catalog(text), public.officer_key_secret_env(text),
-- public.officer_record_refusal(text,uuid,text,integer,uuid,text); then
-- DROP SCHEMA officer CASCADE. No domain table or column was changed.
