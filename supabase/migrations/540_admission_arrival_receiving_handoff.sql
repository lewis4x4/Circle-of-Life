-- COL-333: the receiving team acknowledges each arrival, and what is still
-- outstanding is durable, through the existing handoff infrastructure.
--
--   * When an arrival is confirmed, the same transaction posts one high-priority
--     resident note to the facility's shift handoff board (shift_handoff_notes,
--     301; read on /admin/handoff and the floor tablet's Handoff tab). The
--     receiving shift acknowledges it there, exactly as any handoff note, and
--     that acknowledgment (who and when) is the receiving team's receipt. The
--     note names what was still outstanding at arrival.
--   * Outstanding commitments are derived, never a second list to keep in
--     step: haven.admission_outstanding_commitments(case) reads the admission's
--     required documents that are neither received nor waived (the admission
--     checklist, which is today's manual signed-document path: admission and
--     financial agreements and the rest are marked received there; DocuSign and
--     MACD remain COL-166 / COL-168), and the onboarding steps the onboarding
--     queue already checks (care plan, medication profile, resident payer,
--     family consent).
--   * public.admission_arrival_status (538) also returns the receiving note and
--     its acknowledgment, the live outstanding commitments and the last
--     reversal, so the admission page shows all of it in one place.
-- One note per arrival: the note's source is the approval the arrival was
-- confirmed under, so an arrival confirmed again after a reversal gets its own.
BEGIN;

CREATE FUNCTION haven.admission_outstanding_commitments(p_case uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH c AS (SELECT * FROM public.admission_cases WHERE id = p_case AND deleted_at IS NULL)
  SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'kind', x ->> 'label'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('kind', 'document', 'key', d.document_type::text,
      'label', initcap(replace(d.document_type::text, '_', ' '))) x
    FROM c JOIN public.admission_document_checklist_items d ON d.admission_case_id = c.id
    WHERE d.deleted_at IS NULL AND d.required AND d.received_at IS NULL AND nullif(btrim(coalesce(d.waived_reason, '')), '') IS NULL
    UNION ALL
    SELECT jsonb_build_object('kind', 'onboarding', 'key', s.key, 'label', s.label)
    FROM c CROSS JOIN LATERAL (VALUES
      ('care_plan', 'Care plan', EXISTS (SELECT 1 FROM public.care_plans p WHERE p.resident_id = c.resident_id AND p.deleted_at IS NULL)),
      ('medication_profile', 'Medication profile', EXISTS (SELECT 1 FROM public.resident_medications m WHERE m.resident_id = c.resident_id AND m.deleted_at IS NULL)),
      ('resident_payer', 'Resident payer', EXISTS (SELECT 1 FROM public.resident_payers p WHERE p.resident_id = c.resident_id AND p.deleted_at IS NULL)),
      ('family_consent', 'Family consent', EXISTS (SELECT 1 FROM public.family_consent_records f WHERE f.resident_id = c.resident_id AND f.deleted_at IS NULL))
    ) s(key, label, done)
    WHERE NOT s.done
  ) t
$$;
REVOKE ALL ON FUNCTION haven.admission_outstanding_commitments(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION haven.admission_arrival_receiving_handoff()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid; v_tz text; v_when text; v_outstanding text;
BEGIN
  v_actor := coalesce(nullif(current_setting('haven.movement_actor', true), '')::uuid, NEW.updated_by, NEW.created_by);
  SELECT coalesce(f.timezone, 'America/New_York') INTO v_tz FROM public.facilities f WHERE f.id = NEW.facility_id;
  v_when := CASE WHEN NEW.actual_arrival_precision = 'date'
    THEN to_char(NEW.actual_arrival_at AT TIME ZONE coalesce(v_tz, 'America/New_York'), 'FMMon FMDD')
    ELSE to_char(NEW.actual_arrival_at AT TIME ZONE coalesce(v_tz, 'America/New_York'), 'FMMon FMDD at FMHH12:MI AM') END;
  SELECT string_agg(x ->> 'label', ', ' ORDER BY x ->> 'kind', x ->> 'label') INTO v_outstanding
  FROM jsonb_array_elements(haven.admission_outstanding_commitments(NEW.id)) x;
  PERFORM haven.admission_handoff_note(NEW.organization_id, NEW.facility_id, NEW.resident_id, v_actor, 'resident', 'high',
    format('New arrival, moved in %s. Receiving team: acknowledge this note. %s', v_when,
      CASE WHEN v_outstanding IS NULL THEN 'Nothing outstanding is recorded on the admission.'
        ELSE 'Still outstanding: ' || v_outstanding || '.' END),
    'admission_arrival', coalesce(NEW.arrival_approval_id, NEW.id));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION haven.admission_arrival_receiving_handoff() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER tr_admission_arrival_receiving_handoff
  AFTER UPDATE OF actual_arrival_at ON public.admission_cases
  FOR EACH ROW
  WHEN (OLD.actual_arrival_at IS NULL AND NEW.actual_arrival_at IS NOT NULL)
  EXECUTE FUNCTION haven.admission_arrival_receiving_handoff();

-- Migration 538's reader, with the receiving note, the outstanding commitments
-- and the last reversal.
CREATE OR REPLACE FUNCTION public.admission_arrival_status(p_case uuid, p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.admission_cases; readiness jsonb; cur public.admission_arrival_approvals; latest public.admission_arrival_approvals;
  why text; approver text; roles text[]; note public.shift_handoff_notes; reversal public.admission_arrival_reversals;
BEGIN
  SELECT * INTO c FROM public.admission_cases WHERE id = p_case AND deleted_at IS NULL;
  IF NOT FOUND OR haven.admission_actor_role(p_actor_id, c.facility_id,
       ARRAY['owner','org_admin','facility_admin','manager','admin_assistant','coordinator','med_tech']) IS NULL THEN
    RAISE EXCEPTION 'Admission not found' USING ERRCODE = '42501';
  END IF;
  readiness := haven.admission_arrival_readiness(c.id);
  cur := haven.admission_arrival_approval_current(c.id);
  SELECT * INTO latest FROM public.admission_arrival_approvals a WHERE a.admission_case_id = c.id ORDER BY a.created_at DESC, a.id DESC LIMIT 1;
  roles := haven.admission_arrival_approval_roles(c.organization_id, c.facility_id);
  IF cur.id IS NULL AND latest.id IS NOT NULL AND c.actual_arrival_at IS NULL THEN
    why := CASE
      WHEN latest.decision = 'withdrawn' THEN 'withdrawn'
      WHEN latest.readiness_fingerprint IS DISTINCT FROM readiness ->> 'fingerprint' THEN 'readiness_changed'
      WHEN haven.admission_actor_role(latest.actor_id, c.facility_id, roles) IS NULL THEN 'approver_no_longer_authorized'
      ELSE 'superseded_by_reversal' END;
  END IF;
  SELECT full_name INTO approver FROM public.user_profiles WHERE id = coalesce(cur.actor_id, latest.actor_id);
  IF c.actual_arrival_at IS NOT NULL THEN
    SELECT * INTO note FROM public.shift_handoff_notes n
    WHERE n.source_kind = 'admission_arrival' AND n.source_id = coalesce(c.arrival_approval_id, c.id);
  END IF;
  SELECT * INTO reversal FROM public.admission_arrival_reversals r WHERE r.admission_case_id = c.id ORDER BY r.created_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'admission_case_id', c.id, 'status', c.status, 'actual_arrival_at', c.actual_arrival_at, 'actual_arrival_precision', c.actual_arrival_precision,
    'ready', (readiness ->> 'ready')::boolean, 'blocked_by', readiness -> 'blocked_by', 'fingerprint', readiness ->> 'fingerprint',
    'approval', CASE WHEN cur.id IS NULL THEN NULL ELSE jsonb_build_object('id', cur.id, 'approved_by', cur.actor_id, 'approved_by_name', approver,
      'approved_role', cur.actor_role, 'approved_at', cur.created_at) END,
    'latest_decision', CASE WHEN latest.id IS NULL THEN NULL ELSE jsonb_build_object('decision', latest.decision, 'by', latest.actor_id, 'by_name', approver,
      'at', latest.created_at, 'reason', latest.reason) END,
    'approval_invalid_because', why,
    'approval_roles', to_jsonb(roles),
    'can_approve', haven.admission_actor_role(p_actor_id, c.facility_id, roles) IS NOT NULL,
    'receiving', CASE WHEN note.id IS NULL THEN NULL ELSE jsonb_build_object('note_id', note.id, 'posted_at', note.created_at,
      'acknowledged_at', note.acknowledged_at, 'acknowledged_by', note.acknowledged_by,
      'acknowledged_by_name', (SELECT p.full_name FROM public.user_profiles p WHERE p.id = note.acknowledged_by)) END,
    'outstanding', haven.admission_outstanding_commitments(c.id),
    'last_reversal', CASE WHEN reversal.id IS NULL THEN NULL ELSE jsonb_build_object('id', reversal.id, 'at', reversal.created_at,
      'reason', reversal.reason, 'by_name', (SELECT p.full_name FROM public.user_profiles p WHERE p.id = reversal.actor_id),
      'census_review_acknowledged_at', (SELECT n.acknowledged_at FROM public.shift_handoff_notes n WHERE n.id = reversal.census_review_note_id),
      'finance_review_acknowledged_at', (SELECT n.acknowledged_at FROM public.shift_handoff_notes n WHERE n.id = reversal.finance_review_note_id)) END);
END $$;
REVOKE ALL ON FUNCTION public.admission_arrival_status(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admission_arrival_status(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public.admission_arrival_status(uuid, uuid) IS
  'COL-333: for one admission and the acting user: readiness and its fingerprint, the administrator approval in force (or why the latest no longer counts), whether the actor may approve, the receiving handoff note and its acknowledgment, the outstanding commitments, and the last arrival reversal with its review acknowledgments. Service route only.';

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Rollback: DROP TRIGGER tr_admission_arrival_receiving_handoff ON public.admission_cases;
-- DROP FUNCTION haven.admission_arrival_receiving_handoff(), haven.admission_outstanding_commitments(uuid);
-- restore migration 538's public.admission_arrival_status. Posted notes stay on the board.
