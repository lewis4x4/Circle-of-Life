-- COL-594 (Home W2, slice 1): Record payment on Home, shipped dark.
--
-- Brian 2026-09-22: "I don't want to wait on building, I will slow roll
-- releasing her on modules but the modules still need to be built." Building
-- and releasing are separate gates, so this migration adds both halves:
--
--   * home_module_releases -- a per-facility, effective-dated release switch
--     for Home modules (record_payment, past_due, quick_note, call_out). Nothing
--     is released by this migration. Owners and org admins flip it through
--     home_set_module_release; no deploy is needed.
--   * home_record_payment -- the Home capture command. It refuses unless the
--     module is released for the resident's facility, requires the check or
--     confirmation photo already uploaded to the payment-evidence bucket, applies
--     the payment to the resident's oldest open invoice, requires a reason when
--     the amount is not the full open balance, and records everything through
--     the existing haven.record_finance_payment (finance authority, receipt,
--     idempotency, invoice settlement, and the 458 bridge that posts the
--     resident ledger entry for an activated entity). No second write path.
--   * payment_evidence + the private payment-evidence bucket.
--   * home_rent_settings (facility due day + grace, effective-dated, nothing
--     seeded), residents.rent_due_day, and home_past_due -- the read behind the
--     past-due strip and the On-tap rent row. Released separately as past_due.
--
-- Known limit, stated rather than hidden: payment_allocations allows one
-- allocation per payment (PK payment_id), so a payment larger than the oldest
-- invoice's balance leaves the remainder unapplied on the payment instead of
-- spilling to the next invoice. The resident ledger is balance-forward and nets
-- the whole amount either way. Multi-invoice allocation is a follow-up.
--
-- Rolls forward only.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Release switch
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.home_module_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  module_key text NOT NULL CHECK (module_key IN ('record_payment', 'past_due', 'quick_note', 'call_out')),
  released_from timestamptz NOT NULL,
  released_until timestamptz,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  set_by uuid NOT NULL REFERENCES auth.users(id),
  ended_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (released_until IS NULL OR released_until > released_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_home_module_releases_open
  ON public.home_module_releases (facility_id, module_key) WHERE released_until IS NULL;
CREATE INDEX IF NOT EXISTS idx_home_module_releases_facility
  ON public.home_module_releases (organization_id, facility_id);

COMMENT ON TABLE public.home_module_releases IS
  'COL-594/COL-591: when each Home module is live for a facility. Building is not releasing: a module ships dark and is switched on here, per facility, effective-dated, without a deploy. Closed intervals are history; at most one open interval per facility and module.';

ALTER TABLE public.home_module_releases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Facility members see Home module releases" ON public.home_module_releases;
CREATE POLICY "Facility members see Home module releases" ON public.home_module_releases
  FOR SELECT TO authenticated USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
  );
REVOKE ALL ON public.home_module_releases FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.home_module_releases TO authenticated;

DROP TRIGGER IF EXISTS home_module_releases_audit_trigger ON public.home_module_releases;
CREATE TRIGGER home_module_releases_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.home_module_releases
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

CREATE OR REPLACE FUNCTION public.home_module_released(p_facility_id uuid, p_module_key text, p_at timestamptz DEFAULT clock_timestamp())
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.home_module_releases r
    WHERE r.facility_id = p_facility_id AND r.module_key = p_module_key
      AND r.released_from <= p_at AND (r.released_until IS NULL OR r.released_until > p_at)
  )
$$;
REVOKE ALL ON FUNCTION public.home_module_released(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.home_module_released(uuid, text, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.home_released_modules(p_facility_id uuid)
RETURNS text[] LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  SELECT COALESCE(array_agg(DISTINCT r.module_key ORDER BY r.module_key), '{}')
  FROM public.home_module_releases r
  WHERE r.facility_id = p_facility_id
    AND r.released_from <= clock_timestamp() AND (r.released_until IS NULL OR r.released_until > clock_timestamp())
$$;
REVOKE ALL ON FUNCTION public.home_released_modules(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.home_released_modules(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.home_set_module_release(
  p_facility_id uuid, p_module_key text, p_released boolean, p_reason text, p_effective_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a record;
  v_at timestamptz := COALESCE(p_effective_at, clock_timestamp());
  v_org uuid;
  v_open public.home_module_releases;
BEGIN
  SELECT * INTO a FROM haven.current_authorized_actor();
  IF a.actor_user_id IS NULL OR a.actor_role_text NOT IN ('owner', 'org_admin') THEN
    RAISE EXCEPTION 'Only an owner or org admin releases Home modules' USING ERRCODE = '42501';
  END IF;
  SELECT organization_id INTO v_org FROM public.facilities
   WHERE id = p_facility_id AND deleted_at IS NULL AND organization_id = a.actor_organization_id;
  IF v_org IS NULL OR p_facility_id NOT IN (SELECT haven.accessible_facility_ids()) THEN
    RAISE EXCEPTION 'Facility unavailable' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Say why this module is being switched' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_open FROM public.home_module_releases
   WHERE facility_id = p_facility_id AND module_key = p_module_key AND released_until IS NULL
   FOR UPDATE;

  IF p_released THEN
    IF FOUND THEN
      RETURN jsonb_build_object('facilityId', p_facility_id, 'module', p_module_key, 'released', true, 'since', v_open.released_from, 'changed', false);
    END IF;
    INSERT INTO public.home_module_releases (organization_id, facility_id, module_key, released_from, reason, set_by)
    VALUES (v_org, p_facility_id, p_module_key, v_at, btrim(p_reason), a.actor_user_id);
    RETURN jsonb_build_object('facilityId', p_facility_id, 'module', p_module_key, 'released', true, 'since', v_at, 'changed', true);
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('facilityId', p_facility_id, 'module', p_module_key, 'released', false, 'changed', false);
  END IF;
  UPDATE public.home_module_releases
     SET released_until = GREATEST(v_at, released_from + interval '1 microsecond'),
         ended_by = a.actor_user_id,
         reason = reason || E'\nEnded: ' || btrim(p_reason),
         updated_at = now()
   WHERE id = v_open.id;
  RETURN jsonb_build_object('facilityId', p_facility_id, 'module', p_module_key, 'released', false, 'changed', true);
END $$;
REVOKE ALL ON FUNCTION public.home_set_module_release(uuid, text, boolean, text, timestamptz) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.home_set_module_release(uuid, text, boolean, text, timestamptz) TO authenticated;
COMMENT ON FUNCTION public.home_set_module_release(uuid, text, boolean, text, timestamptz) IS
  'COL-37 ruling: definer required — home_module_releases has no browser write grant so a release is always attributable and reasoned; the function asserts a current owner/org_admin actor with access to the facility, writes one row (open or close an interval) and nothing else (COL-594).';

-- ---------------------------------------------------------------------------
-- 2. Check / confirmation photo
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('payment-evidence', 'payment-evidence', false, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Object names are <facility_id>/<payment_id>/<file>. Only finance-scope roles
-- with access to that facility may write or read them; nobody updates or deletes.
CREATE OR REPLACE FUNCTION haven.payment_evidence_object_access(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_facility uuid; a record;
BEGIN
  IF p_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]+$' THEN RETURN false; END IF;
  v_facility := split_part(p_name, '/', 1)::uuid;
  SELECT * INTO a FROM haven.current_authorized_actor();
  RETURN a.actor_user_id IS NOT NULL
     AND a.actor_role_text IN ('owner', 'org_admin', 'facility_admin')
     AND EXISTS (SELECT 1 FROM public.facilities f WHERE f.id = v_facility
                 AND f.organization_id = a.actor_organization_id AND f.deleted_at IS NULL)
     AND v_facility IN (SELECT haven.accessible_facility_ids());
END $$;
REVOKE ALL ON FUNCTION haven.payment_evidence_object_access(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION haven.payment_evidence_object_access(text) TO authenticated;

DROP POLICY IF EXISTS payment_evidence_insert ON storage.objects;
CREATE POLICY payment_evidence_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-evidence' AND haven.payment_evidence_object_access(name));
DROP POLICY IF EXISTS payment_evidence_read ON storage.objects;
CREATE POLICY payment_evidence_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payment-evidence' AND haven.payment_evidence_object_access(name));
DROP POLICY IF EXISTS payment_evidence_no_update ON storage.objects;
CREATE POLICY payment_evidence_no_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (bucket_id <> 'payment-evidence') WITH CHECK (bucket_id <> 'payment-evidence');
DROP POLICY IF EXISTS payment_evidence_no_delete ON storage.objects;
CREATE POLICY payment_evidence_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id <> 'payment-evidence');

CREATE TABLE IF NOT EXISTS public.payment_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE REFERENCES public.payments(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  bucket_id text NOT NULL DEFAULT 'payment-evidence' CHECK (bucket_id = 'payment-evidence'),
  object_path text NOT NULL,
  mismatch_reason text,
  recorded_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.payment_evidence IS
  'COL-594: the check or confirmation photo behind a payment captured on Home, and the reason given when the amount was not the open balance. Append-only; payments themselves are immutable (340).';

ALTER TABLE public.payment_evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Finance roles see payment evidence" ON public.payment_evidence;
CREATE POLICY "Finance roles see payment evidence" ON public.payment_evidence
  FOR SELECT TO authenticated USING (
    organization_id = haven.organization_id()
    AND facility_id IN (SELECT haven.accessible_facility_ids())
    AND haven.app_role()::text IN ('owner', 'org_admin', 'facility_admin')
  );
REVOKE ALL ON public.payment_evidence FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_evidence TO authenticated;

CREATE OR REPLACE FUNCTION haven.refuse_payment_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Payment evidence is append-only' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION haven.refuse_payment_evidence_mutation() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS payment_evidence_append_only ON public.payment_evidence;
CREATE TRIGGER payment_evidence_append_only BEFORE UPDATE OR DELETE ON public.payment_evidence
  FOR EACH ROW EXECUTE FUNCTION haven.refuse_payment_evidence_mutation();
DROP TRIGGER IF EXISTS payment_evidence_audit_trigger ON public.payment_evidence;
CREATE TRIGGER payment_evidence_audit_trigger AFTER INSERT ON public.payment_evidence
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ---------------------------------------------------------------------------
-- 3. The Home capture command
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.home_record_payment(
  p_id uuid,
  p_resident_id uuid,
  p_payment_date date,
  p_amount_cents integer,
  p_method text,
  p_evidence_path text,
  p_reference text DEFAULT NULL,
  p_payer_name text DEFAULT NULL,
  p_mismatch_reason text DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_resident record;
  v_prior public.finance_command_receipts%ROWTYPE;
  v_oldest uuid;
  v_open bigint;
  v_reason text := nullif(btrim(coalesce(p_mismatch_reason, '')), '');
  v_notes text;
  v_result jsonb;
BEGIN
  IF p_id IS NULL OR p_resident_id IS NULL OR p_payment_date IS NULL OR p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Resident, date and a positive amount are required' USING ERRCODE = '22023';
  END IF;
  SELECT r.id, r.facility_id, r.organization_id INTO v_resident
    FROM public.residents r WHERE r.id = p_resident_id AND r.deleted_at IS NULL;
  IF NOT FOUND OR v_resident.facility_id NOT IN (SELECT haven.accessible_facility_ids()) THEN
    RAISE EXCEPTION 'Resident unavailable' USING ERRCODE = '42501';
  END IF;

  -- A retry of a request that already landed returns its receipt, even if the
  -- oldest open invoice has changed since (it was this payment that changed it).
  SELECT * INTO v_prior FROM public.finance_command_receipts WHERE command_type = 'payment' AND id = p_id;
  IF FOUND THEN
    IF v_prior.organization_id <> v_resident.organization_id OR (v_prior.payload->>'resident_id')::uuid <> p_resident_id
       OR (v_prior.payload->>'amount_cents')::integer <> p_amount_cents THEN
      RAISE EXCEPTION 'Command identity already used for different content' USING ERRCODE = '23505';
    END IF;
    RETURN v_prior.result || jsonb_build_object('replayed', true);
  END IF;

  IF NOT public.home_module_released(v_resident.facility_id, 'record_payment') THEN
    RAISE EXCEPTION 'Record payment is not switched on for this facility yet' USING ERRCODE = '42501';
  END IF;

  IF p_evidence_path IS NULL
     OR p_evidence_path NOT LIKE v_resident.facility_id::text || '/' || p_id::text || '/%'
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'payment-evidence' AND o.name = p_evidence_path) THEN
    RAISE EXCEPTION 'Attach the check or confirmation photo before recording' USING ERRCODE = '22023';
  END IF;

  SELECT i.id INTO v_oldest FROM public.invoices i
   WHERE i.resident_id = p_resident_id AND i.facility_id = v_resident.facility_id AND i.deleted_at IS NULL
     AND i.status IN ('sent', 'partial', 'overdue') AND i.balance_due > 0
   ORDER BY i.due_date NULLS LAST, i.invoice_date, i.created_at, i.id
   LIMIT 1
   FOR UPDATE;
  SELECT COALESCE(sum(i.balance_due), 0) INTO v_open FROM public.invoices i
   WHERE i.resident_id = p_resident_id AND i.facility_id = v_resident.facility_id AND i.deleted_at IS NULL
     AND i.status IN ('sent', 'partial', 'overdue') AND i.balance_due > 0;

  IF p_amount_cents <> v_open AND v_reason IS NULL THEN
    RAISE EXCEPTION 'This is not the full amount due. Say why (partial payment, overpayment, prepayment, other).'
      USING ERRCODE = 'P0001', HINT = 'mismatch_reason_required';
  END IF;

  v_notes := concat_ws(' ', 'Recorded on Home.',
                       CASE WHEN p_amount_cents <> v_open THEN 'Amount differs from the open balance: ' || v_reason || '.' END,
                       nullif(btrim(coalesce(p_note, '')), ''));

  v_result := haven.record_finance_payment(p_id, p_resident_id, v_oldest, p_payment_date, p_amount_cents,
                                           p_method, p_reference, p_payer_name, v_notes);

  INSERT INTO public.payment_evidence (payment_id, organization_id, facility_id, object_path, mismatch_reason, recorded_by)
  VALUES (p_id, v_resident.organization_id, v_resident.facility_id, p_evidence_path,
          CASE WHEN p_amount_cents <> v_open THEN v_reason END, auth.uid())
  ON CONFLICT (payment_id) DO NOTHING;

  RETURN v_result || jsonb_build_object('invoice_id', v_oldest, 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.home_record_payment(uuid, uuid, date, integer, text, text, text, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.home_record_payment(uuid, uuid, date, integer, text, text, text, text, text, text) TO authenticated;
COMMENT ON FUNCTION public.home_record_payment(uuid, uuid, date, integer, text, text, text, text, text, text) IS
  'COL-37 ruling: definer required — payments and payment_evidence have no browser write path (340 guard, append-only evidence); the function checks facility access and the per-facility release switch, verifies the uploaded photo object, picks the oldest open invoice, and writes through haven.record_finance_payment, which re-asserts current finance authority (owner/org_admin/facility_admin), keeps the receipt and idempotency, and triggers the 458 ledger bridge (COL-594).';

-- ---------------------------------------------------------------------------
-- 4. Past-due rent (Home W2 strip and On-tap rent row)
-- ---------------------------------------------------------------------------
-- The due day and the grace period are configuration, never code: a facility
-- default that is effective-dated, and an optional per-resident due day (the
-- 5th for most, ~18th for some per DEC-2026-09-22-03). Nothing is seeded; a
-- facility with no settings reads as "not configured", not as "nobody owes".
CREATE TABLE IF NOT EXISTS public.home_rent_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  default_due_day smallint NOT NULL CHECK (default_due_day BETWEEN 1 AND 28),
  grace_days smallint NOT NULL CHECK (grace_days BETWEEN 0 AND 60),
  effective_from date NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  set_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (facility_id, effective_from)
);
COMMENT ON TABLE public.home_rent_settings IS
  'COL-594: when rent is due and how long before it is past due on Home, per facility, effective-dated. The latest row with effective_from <= the facility''s local date applies. Append-only history.';
ALTER TABLE public.home_rent_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Facility members see rent settings" ON public.home_rent_settings;
CREATE POLICY "Facility members see rent settings" ON public.home_rent_settings
  FOR SELECT TO authenticated USING (
    organization_id = haven.organization_id() AND facility_id IN (SELECT haven.accessible_facility_ids())
  );
REVOKE ALL ON public.home_rent_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.home_rent_settings TO authenticated;
DROP TRIGGER IF EXISTS home_rent_settings_audit_trigger ON public.home_rent_settings;
CREATE TRIGGER home_rent_settings_audit_trigger AFTER INSERT OR UPDATE OR DELETE ON public.home_rent_settings
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

ALTER TABLE public.residents
  ADD COLUMN IF NOT EXISTS rent_due_day smallint CHECK (rent_due_day IS NULL OR rent_due_day BETWEEN 1 AND 28);
COMMENT ON COLUMN public.residents.rent_due_day IS
  'COL-594: day of the month this resident''s rent is due, when it differs from the facility default in home_rent_settings. NULL = facility default.';

CREATE OR REPLACE FUNCTION public.home_set_rent_settings(
  p_facility_id uuid, p_default_due_day integer, p_grace_days integer, p_effective_from date, p_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a record; v_org uuid; v_row public.home_rent_settings;
BEGIN
  SELECT * INTO a FROM haven.current_authorized_actor();
  IF a.actor_user_id IS NULL OR a.actor_role_text NOT IN ('owner', 'org_admin') THEN
    RAISE EXCEPTION 'Only an owner or org admin sets rent terms' USING ERRCODE = '42501';
  END IF;
  SELECT organization_id INTO v_org FROM public.facilities
   WHERE id = p_facility_id AND deleted_at IS NULL AND organization_id = a.actor_organization_id;
  IF v_org IS NULL OR p_facility_id NOT IN (SELECT haven.accessible_facility_ids()) THEN
    RAISE EXCEPTION 'Facility unavailable' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(coalesce(p_reason, '')), '') IS NULL OR p_effective_from IS NULL THEN
    RAISE EXCEPTION 'An effective date and the decision behind it are required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.home_rent_settings (organization_id, facility_id, default_due_day, grace_days, effective_from, reason, set_by)
  VALUES (v_org, p_facility_id, p_default_due_day, p_grace_days, p_effective_from, btrim(p_reason), a.actor_user_id)
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END $$;
REVOKE ALL ON FUNCTION public.home_set_rent_settings(uuid, integer, integer, date, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.home_set_rent_settings(uuid, integer, integer, date, text) TO authenticated;
COMMENT ON FUNCTION public.home_set_rent_settings(uuid, integer, integer, date, text) IS
  'COL-37 ruling: definer required — home_rent_settings has no browser write grant so every rent-term change is attributable and reasoned; the function asserts a current owner/org_admin actor with access to the facility and appends one effective-dated row (COL-594).';

-- Who is past due today. SECURITY INVOKER: invoices and residents RLS decide
-- what the caller sees; a caller without billing access sees nobody.
CREATE OR REPLACE FUNCTION public.home_past_due(p_facility_id uuid, p_as_of timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH f AS (
    SELECT fa.id, (p_as_of AT TIME ZONE COALESCE(fa.timezone, 'America/New_York'))::date AS local_date
    FROM public.facilities fa WHERE fa.id = p_facility_id AND fa.deleted_at IS NULL
  ), cfg AS (
    SELECT s.default_due_day, s.grace_days, s.effective_from
    FROM public.home_rent_settings s JOIN f ON s.facility_id = f.id
    WHERE s.effective_from <= f.local_date
    ORDER BY s.effective_from DESC LIMIT 1
  ), open_invoices AS (
    SELECT i.resident_id, i.balance_due,
           make_date(extract(year FROM i.period_start)::int, extract(month FROM i.period_start)::int,
                     COALESCE(r.rent_due_day, cfg.default_due_day)::int) AS due_on
    FROM public.invoices i
    JOIN public.residents r ON r.id = i.resident_id AND r.deleted_at IS NULL
    CROSS JOIN cfg
    WHERE i.facility_id = p_facility_id AND i.deleted_at IS NULL
      AND i.status IN ('sent', 'partial', 'overdue') AND i.balance_due > 0
  ), late AS (
    SELECT o.resident_id, min(o.due_on) AS oldest_due, sum(o.balance_due)::bigint AS open_cents
    FROM open_invoices o CROSS JOIN cfg CROSS JOIN f
    WHERE o.due_on + cfg.grace_days < f.local_date
    GROUP BY o.resident_id
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM cfg) THEN
      jsonb_build_object('configured', false, 'localDate', (SELECT local_date FROM f), 'residents', '[]'::jsonb)
    ELSE jsonb_build_object(
      'configured', true,
      'localDate', (SELECT local_date FROM f),
      'graceDays', (SELECT grace_days FROM cfg),
      'defaultDueDay', (SELECT default_due_day FROM cfg),
      'residents', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'residentId', l.resident_id,
                 'name', r.last_name || ', ' || COALESCE(nullif(r.preferred_name, ''), r.first_name),
                 'oldestDueDate', l.oldest_due,
                 'daysPastDue', (SELECT local_date FROM f) - l.oldest_due,
                 'openCents', l.open_cents)
               ORDER BY l.oldest_due, r.last_name)
        FROM late l JOIN public.residents r ON r.id = l.resident_id), '[]'::jsonb))
  END
$$;
REVOKE ALL ON FUNCTION public.home_past_due(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.home_past_due(uuid, timestamptz) TO authenticated;
COMMENT ON FUNCTION public.home_past_due(uuid, timestamptz) IS
  'COL-594: residents whose oldest open invoice is past its due day (resident rent_due_day, else the facility default) plus the facility grace days, oldest first, at the facility''s local date. Not configured when the facility has no home_rent_settings in effect. INVOKER: billing RLS scopes it.';

COMMIT;

NOTIFY pgrst, 'reload schema';
