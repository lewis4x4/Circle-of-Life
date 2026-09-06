-- September review B02/B11: one RLS-governed transaction for journal drafts.
-- Shared updated-at trigger records the actor on line history updates.
ALTER TABLE public.journal_entry_lines ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);
CREATE OR REPLACE FUNCTION public.save_journal_draft(
  p_id uuid, p_entity_id uuid, p_facility_id uuid, p_entry_date date,
  p_memo text, p_lines jsonb, p_expected_updated_at timestamptz DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_entry public.journal_entries%ROWTYPE; v_line jsonb; v_org uuid := haven.organization_id();
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF p_id IS NULL OR p_entity_id IS NULL OR p_entry_date IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'A journal requires an entity, date and at least two lines';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.entities WHERE id=p_entity_id AND organization_id=v_org AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Entity unavailable'; END IF;
  IF p_facility_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.facilities WHERE id=p_facility_id AND entity_id=p_entity_id AND organization_id=v_org AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Facility does not belong to journal entity'; END IF;
  SELECT * INTO v_entry FROM public.journal_entries WHERE id=p_id FOR UPDATE;
  IF FOUND THEN
    IF v_entry.status <> 'draft' OR v_entry.deleted_at IS NOT NULL OR v_entry.entity_id <> p_entity_id THEN RAISE EXCEPTION 'Journal is not an editable draft'; END IF;
    IF p_expected_updated_at IS NULL OR v_entry.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Journal changed. Reload before saving'; END IF;
    UPDATE public.journal_entries SET entry_date=p_entry_date, facility_id=p_facility_id, memo=p_memo, updated_by=auth.uid() WHERE id=p_id;
    UPDATE public.journal_entry_lines SET deleted_at=now() WHERE journal_entry_id=p_id AND deleted_at IS NULL;
  ELSE
    IF p_expected_updated_at IS NOT NULL THEN RAISE EXCEPTION 'Journal unavailable'; END IF;
    INSERT INTO public.journal_entries(id,organization_id,entity_id,facility_id,entry_date,memo,source_type,created_by,updated_by)
      VALUES(p_id,v_org,p_entity_id,p_facility_id,p_entry_date,p_memo,'manual',auth.uid(),auth.uid());
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.gl_accounts WHERE id=(v_line->>'gl_account_id')::uuid AND organization_id=v_org AND entity_id=p_entity_id AND is_active AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Account does not belong to journal entity'; END IF;
    INSERT INTO public.journal_entry_lines(journal_entry_id,organization_id,gl_account_id,line_number,debit_cents,credit_cents)
      VALUES(p_id,v_org,(v_line->>'gl_account_id')::uuid,(v_line->>'line_number')::integer,(v_line->>'debit_cents')::integer,(v_line->>'credit_cents')::integer);
  END LOOP;
  RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.save_journal_draft(uuid,uuid,uuid,date,text,jsonb,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_journal_draft(uuid,uuid,uuid,date,text,jsonb,timestamptz) TO authenticated;

-- B18: every ledger insert, including old clients, obtains the account lock and
-- writes the authoritative balance in the same transaction. Direct balance edits fail.
CREATE OR REPLACE FUNCTION public.haven_guard_cash_balance() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF (TG_OP='INSERT' AND NEW.balance_cents <> 0) OR
     (TG_OP='UPDATE' AND NEW.balance_cents IS DISTINCT FROM OLD.balance_cents AND pg_trigger_depth() < 2) THEN
    RAISE EXCEPTION 'Account balances change only through ledger transactions';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_petty_cash_balance BEFORE INSERT OR UPDATE ON public.petty_cash_accounts FOR EACH ROW EXECUTE FUNCTION public.haven_guard_cash_balance();
CREATE TRIGGER guard_trust_balance BEFORE INSERT OR UPDATE ON public.resident_trust_accounts FOR EACH ROW EXECUTE FUNCTION public.haven_guard_cash_balance();
CREATE OR REPLACE FUNCTION public.haven_apply_cash_transaction() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_account record; v_delta integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF NEW.amount_cents IS NULL OR NEW.amount_cents <= 0 OR length(trim(NEW.description))=0 THEN RAISE EXCEPTION 'Positive amount and description required'; END IF;
  IF TG_TABLE_NAME='petty_cash_transactions' THEN
    SELECT * INTO v_account FROM public.petty_cash_accounts WHERE id=NEW.account_id AND deleted_at IS NULL AND is_active FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Account unavailable'; END IF;
    IF NEW.resident_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.residents WHERE id=NEW.resident_id AND facility_id=v_account.facility_id AND organization_id=v_account.organization_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Resident does not belong to account facility'; END IF;
    v_delta := CASE WHEN NEW.direction='credit' THEN NEW.amount_cents ELSE -NEW.amount_cents END;
  ELSE
    SELECT * INTO v_account FROM public.resident_trust_accounts WHERE id=NEW.account_id AND deleted_at IS NULL AND is_active FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Account unavailable'; END IF;
    NEW.resident_id := v_account.resident_id;
    v_delta := CASE WHEN NEW.direction='deposit' THEN NEW.amount_cents ELSE -NEW.amount_cents END;
  END IF;
  NEW.organization_id := v_account.organization_id; NEW.facility_id := v_account.facility_id; NEW.created_by := auth.uid();
  NEW.balance_after_cents := v_account.balance_cents + v_delta;
  IF NEW.balance_after_cents < 0 THEN RAISE EXCEPTION 'Withdrawal exceeds available balance'; END IF;
  IF TG_TABLE_NAME='petty_cash_transactions' THEN
    UPDATE public.petty_cash_accounts SET balance_cents=NEW.balance_after_cents,updated_by=auth.uid() WHERE id=NEW.account_id;
  ELSE
    UPDATE public.resident_trust_accounts SET balance_cents=NEW.balance_after_cents,updated_by=auth.uid() WHERE id=NEW.account_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER apply_petty_cash_transaction BEFORE INSERT ON public.petty_cash_transactions FOR EACH ROW EXECUTE FUNCTION public.haven_apply_cash_transaction();
CREATE TRIGGER apply_trust_transaction BEFORE INSERT ON public.resident_trust_transactions FOR EACH ROW EXECUTE FUNCTION public.haven_apply_cash_transaction();

CREATE OR REPLACE FUNCTION public.post_cash_transaction(p_kind text,p_id uuid,p_account_id uuid,p_direction text,p_amount_cents integer,p_category text,p_description text,p_resident_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_row record;
BEGIN
  IF auth.uid() IS NULL OR p_id IS NULL THEN RAISE EXCEPTION 'Authenticated transaction identity required'; END IF;
  IF p_kind='petty' THEN
    PERFORM 1 FROM public.petty_cash_accounts WHERE id=p_account_id AND deleted_at IS NULL AND is_active FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Account unavailable'; END IF;
    SELECT * INTO v_row FROM public.petty_cash_transactions WHERE id=p_id;
    IF FOUND THEN
      IF v_row.account_id<>p_account_id OR v_row.direction<>p_direction OR v_row.amount_cents<>p_amount_cents OR v_row.category<>p_category OR v_row.description<>trim(p_description) OR v_row.resident_id IS DISTINCT FROM p_resident_id THEN RAISE EXCEPTION 'Transaction identity already used for a different request'; END IF;
      RETURN to_jsonb(v_row);
    END IF;
    INSERT INTO public.petty_cash_transactions(id,account_id,organization_id,facility_id,direction,amount_cents,balance_after_cents,category,description,resident_id)
      VALUES(p_id,p_account_id,haven.organization_id(),p_account_id,p_direction,p_amount_cents,0,p_category,trim(p_description),p_resident_id) RETURNING * INTO v_row;
  ELSIF p_kind='trust' THEN
    PERFORM 1 FROM public.resident_trust_accounts WHERE id=p_account_id AND deleted_at IS NULL AND is_active FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Account unavailable'; END IF;
    SELECT * INTO v_row FROM public.resident_trust_transactions WHERE id=p_id;
    IF FOUND THEN
      IF v_row.account_id<>p_account_id OR v_row.direction<>p_direction OR v_row.amount_cents<>p_amount_cents OR v_row.category<>p_category OR v_row.description<>trim(p_description) THEN RAISE EXCEPTION 'Transaction identity already used for a different request'; END IF;
      RETURN to_jsonb(v_row);
    END IF;
    INSERT INTO public.resident_trust_transactions(id,account_id,organization_id,facility_id,resident_id,direction,amount_cents,balance_after_cents,category,description)
      VALUES(p_id,p_account_id,haven.organization_id(),p_account_id,p_account_id,p_direction,p_amount_cents,0,p_category,trim(p_description)) RETURNING * INTO v_row;
  ELSE RAISE EXCEPTION 'Unknown ledger'; END IF;
  RETURN to_jsonb(v_row);
END $$;
REVOKE ALL ON FUNCTION public.post_cash_transaction(text,uuid,uuid,text,integer,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.post_cash_transaction(text,uuid,uuid,text,integer,text,text,uuid) TO authenticated;

-- B01: one calculation for timestamp-only and manual punches. OT allocation is
-- intentionally not invented: exporting REG/OT requires an explicit reviewed split.
CREATE OR REPLACE FUNCTION public.haven_calculate_worked_hours() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.clock_out IS NULL THEN NEW.actual_hours := NULL;
  ELSE
    IF NEW.clock_out <= NEW.clock_in OR coalesce(NEW.break_minutes,0)<0 OR extract(epoch FROM NEW.clock_out-NEW.clock_in)/60 < coalesce(NEW.break_minutes,0) THEN RAISE EXCEPTION 'Invalid punch or break duration'; END IF;
    NEW.actual_hours := round((extract(epoch FROM NEW.clock_out-NEW.clock_in)/3600 - coalesce(NEW.break_minutes,0)::numeric/60)::numeric,2);
  END IF;
  IF TG_OP='UPDATE' AND (NEW.clock_in IS DISTINCT FROM OLD.clock_in OR NEW.clock_out IS DISTINCT FROM OLD.clock_out OR NEW.break_minutes IS DISTINCT FROM OLD.break_minutes) THEN
    NEW.regular_hours := NULL; NEW.overtime_hours := NULL; NEW.approved := false; NEW.approved_at := NULL; NEW.approved_by := NULL;
  END IF;
  IF NEW.approved AND (NEW.clock_out IS NULL OR NEW.actual_hours IS NULL OR NEW.actual_hours <= 0) THEN RAISE EXCEPTION 'Complete and calculate the punch before approval'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER calculate_worked_hours BEFORE INSERT OR UPDATE ON public.time_records FOR EACH ROW EXECUTE FUNCTION public.haven_calculate_worked_hours();

-- B07: session, signed attendance and optional catalog completions commit together.
CREATE OR REPLACE FUNCTION public.save_inservice_session(p_id uuid,p_session jsonb,p_staff_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_session public.inservice_log_sessions%ROWTYPE; v_staff uuid;
BEGIN
  IF auth.uid() IS NULL OR p_id IS NULL OR coalesce(cardinality(p_staff_ids),0)=0 THEN RAISE EXCEPTION 'Signed-in actor and attendees required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  SELECT * INTO v_session FROM public.inservice_log_sessions WHERE id=p_id;
  IF FOUND THEN RAISE EXCEPTION 'This session was already saved. Return to Training to review it before creating another session'; END IF;
  v_session := jsonb_populate_record(NULL::public.inservice_log_sessions,p_session);
  IF coalesce(v_session.hours,0)<=0 OR length(trim(coalesce(v_session.topic,'')))=0 THEN RAISE EXCEPTION 'Topic and positive hours required'; END IF;
  IF v_session.training_program_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.training_programs WHERE id=v_session.training_program_id AND organization_id=haven.organization_id() AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Training program unavailable'; END IF;
  INSERT INTO public.inservice_log_sessions(id,organization_id,facility_id,session_date,topic,trainer_name,hours,training_program_id,location,notes,trainer_user_id,created_by)
    VALUES(p_id,haven.organization_id(),v_session.facility_id,v_session.session_date,v_session.topic,v_session.trainer_name,v_session.hours,v_session.training_program_id,v_session.location,v_session.notes,auth.uid(),auth.uid());
  FOR v_staff IN SELECT DISTINCT unnest(p_staff_ids) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=v_staff AND organization_id=haven.organization_id() AND facility_id=v_session.facility_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Attendee unavailable in session facility'; END IF;
    INSERT INTO public.inservice_log_attendees(session_id,staff_id,signed_in) VALUES(p_id,v_staff,true);
    IF v_session.training_program_id IS NOT NULL THEN
      INSERT INTO public.staff_training_completions(organization_id,facility_id,staff_id,training_program_id,completed_at,hours_completed,delivery_method,evaluator_user_id,notes,created_by)
        VALUES(haven.organization_id(),v_session.facility_id,v_staff,v_session.training_program_id,v_session.session_date,v_session.hours,'in_person',auth.uid(),'In-service: '||v_session.topic||' (session '||p_id||')',auth.uid());
    END IF;
  END LOOP;
  RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.save_inservice_session(uuid,jsonb,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_inservice_session(uuid,jsonb,uuid[]) TO authenticated;

-- B08: a collection event is part of the primary insert, never an after-save network step.
CREATE OR REPLACE FUNCTION public.haven_collection_activity_event() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.workflow_events(organization_id,facility_id,resident_id,invoice_id,collection_activity_id,event_type,source_module,event_key,created_by,payload_json)
    VALUES(NEW.organization_id,NEW.facility_id,NEW.resident_id,NEW.invoice_id,NEW.id,'collection_activity_logged','billing','collection-activity:'||NEW.id,NEW.performed_by,
      jsonb_build_object('activity_type',NEW.activity_type,'activity_date',NEW.activity_date,'outcome',NEW.outcome,'follow_up_date',NEW.follow_up_date));
  RETURN NEW;
END $$;
CREATE TRIGGER collection_activity_event AFTER INSERT ON public.collection_activities FOR EACH ROW EXECUTE FUNCTION public.haven_collection_activity_event();

-- B14: canonical integer levels/allergies/status, with legacy aliases synchronized.
-- Existing contradictory rows are deliberately not reclassified without clinical review.
CREATE OR REPLACE FUNCTION public.haven_sync_diet_order_contract() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_fluid text;
BEGIN
  IF TG_OP='INSERT' THEN
    IF cardinality(NEW.allergies)=0 AND cardinality(NEW.allergy_constraints)>0 THEN NEW.allergies:=NEW.allergy_constraints; END IF;
    IF NEW.iddsi_liquid_level IS NULL AND NEW.iddsi_fluid_level::text <> 'not_assessed' THEN NEW.iddsi_liquid_level:=substring(NEW.iddsi_fluid_level::text FROM 'level_([0-4])')::integer; END IF;
  ELSE
    IF NEW.allergy_constraints IS DISTINCT FROM OLD.allergy_constraints AND NEW.allergies IS NOT DISTINCT FROM OLD.allergies THEN NEW.allergies:=NEW.allergy_constraints; END IF;
    IF NEW.iddsi_fluid_level IS DISTINCT FROM OLD.iddsi_fluid_level AND NEW.iddsi_liquid_level IS NOT DISTINCT FROM OLD.iddsi_liquid_level THEN NEW.iddsi_liquid_level:=substring(NEW.iddsi_fluid_level::text FROM 'level_([0-4])')::integer; END IF;
    IF NEW.active IS DISTINCT FROM OLD.active AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
      NEW.status:=CASE WHEN NEW.active THEN 'active'::public.diet_order_status ELSE 'discontinued'::public.diet_order_status END;
    END IF;
  END IF;
  NEW.allergy_constraints:=NEW.allergies;
  v_fluid:=CASE NEW.iddsi_liquid_level WHEN 0 THEN 'level_0_thin' WHEN 1 THEN 'level_1_slightly_thick' WHEN 2 THEN 'level_2_mildly_thick' WHEN 3 THEN 'level_3_moderately_thick' WHEN 4 THEN 'level_4_extremely_thick' ELSE 'not_assessed' END;
  NEW.iddsi_fluid_level:=v_fluid::public.iddsi_fluid_level;
  NEW.active:=NEW.status='active' AND NEW.deleted_at IS NULL;
  RETURN NEW;
END $$;
ALTER TABLE public.diet_orders ALTER COLUMN active SET DEFAULT false;
CREATE TRIGGER sync_diet_order_contract BEFORE INSERT OR UPDATE ON public.diet_orders FOR EACH ROW EXECUTE FUNCTION public.haven_sync_diet_order_contract();
CREATE OR REPLACE FUNCTION public.activate_reviewed_diet_order(p_id uuid,p_expected_updated_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_order public.diet_orders%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR haven.app_role() NOT IN ('owner','org_admin','facility_admin','nurse') THEN RAISE EXCEPTION 'Clinical order review role required'; END IF;
  SELECT * INTO v_order FROM public.diet_orders WHERE id=p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_order.status <> 'draft' THEN RAISE EXCEPTION 'Draft order unavailable'; END IF;
  IF v_order.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Order changed. Review again before activation'; END IF;
  IF v_order.iddsi_food_level IS NULL OR v_order.iddsi_liquid_level IS NULL THEN RAISE EXCEPTION 'Review and record both IDDSI levels before activation'; END IF;
  PERFORM 1 FROM public.residents WHERE id=v_order.resident_id FOR UPDATE;
  UPDATE public.diet_orders SET status='superseded',active=false,effective_to=now(),updated_by=auth.uid() WHERE resident_id=v_order.resident_id AND id<>p_id AND active;
  UPDATE public.diet_orders SET status='active',active=true,ordered_by=auth.uid(),updated_by=auth.uid(),effective_from=now() WHERE id=p_id;
  RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.activate_reviewed_diet_order(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.activate_reviewed_diet_order(uuid,timestamptz) TO authenticated;

-- B13: confirmations belong to participants; approval applies coverage atomically.
ALTER TABLE public.shift_swap_requests ADD COLUMN requesting_confirmed_at timestamptz, ADD COLUMN covering_confirmed_at timestamptz, ADD COLUMN eligibility_reviewed_at timestamptz, ADD COLUMN eligibility_reviewed_by uuid REFERENCES auth.users(id);
CREATE OR REPLACE FUNCTION public.haven_apply_approved_shift_swap() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_request public.shift_assignments%ROWTYPE; v_cover public.shift_assignments%ROWTYPE; v_role text; v_cover_role text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF TG_OP='INSERT' THEN
    NEW.requesting_confirmed_at:=NULL; NEW.covering_confirmed_at:=NULL;
    IF NEW.status='approved' THEN RAISE EXCEPTION 'Participants must confirm before manager approval'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.requesting_staff_id IS DISTINCT FROM OLD.requesting_staff_id OR NEW.covering_staff_id IS DISTINCT FROM OLD.covering_staff_id OR NEW.requesting_assignment_id IS DISTINCT FROM OLD.requesting_assignment_id OR NEW.covering_assignment_id IS DISTINCT FROM OLD.covering_assignment_id THEN
    IF OLD.status='approved' THEN RAISE EXCEPTION 'Approved coverage is immutable'; END IF;
    NEW.requesting_confirmed_at:=NULL; NEW.covering_confirmed_at:=NULL;
  ELSE
    IF NEW.requesting_confirmed_at IS DISTINCT FROM OLD.requesting_confirmed_at THEN
      IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=NEW.requesting_staff_id AND user_id=auth.uid() AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Only the requesting employee may confirm'; END IF;
      NEW.requesting_confirmed_at:=now();
    END IF;
    IF NEW.covering_confirmed_at IS DISTINCT FROM OLD.covering_confirmed_at THEN
      IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=NEW.covering_staff_id AND user_id=auth.uid() AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Only the covering employee may confirm'; END IF;
      NEW.covering_confirmed_at:=now();
    END IF;
  END IF;
  IF NEW.eligibility_reviewed_at IS DISTINCT FROM OLD.eligibility_reviewed_at OR NEW.eligibility_reviewed_by IS DISTINCT FROM OLD.eligibility_reviewed_by THEN
    IF haven.app_role() NOT IN ('owner','org_admin','facility_admin','nurse') THEN RAISE EXCEPTION 'Scheduling manager review required'; END IF;
    NEW.eligibility_reviewed_at:=clock_timestamp(); NEW.eligibility_reviewed_by:=auth.uid();
  END IF;
  IF NEW.status='approved' AND OLD.status<>'approved' THEN
    IF haven.app_role() NOT IN ('owner','org_admin','facility_admin','nurse') THEN RAISE EXCEPTION 'Scheduling manager approval required'; END IF;
    IF NEW.eligibility_reviewed_by IS DISTINCT FROM auth.uid() OR NEW.eligibility_reviewed_at IS NULL OR NEW.eligibility_reviewed_at<now()-interval '5 minutes' THEN RAISE EXCEPTION 'Review required credentials, weekly hours and rest before applying coverage'; END IF;
    IF NEW.requesting_confirmed_at IS NULL OR NEW.covering_confirmed_at IS NULL OR NEW.covering_staff_id IS NULL OR NEW.covering_staff_id=NEW.requesting_staff_id THEN RAISE EXCEPTION 'Both distinct employees must confirm the proposed coverage'; END IF;
    -- Lock all involved assignments deterministically, then check the current ownership.
    PERFORM 1 FROM public.shift_assignments WHERE id IN (NEW.requesting_assignment_id,NEW.covering_assignment_id) ORDER BY id FOR UPDATE;
    SELECT * INTO v_request FROM public.shift_assignments WHERE id=NEW.requesting_assignment_id AND deleted_at IS NULL;
    IF NOT FOUND OR v_request.staff_id<>NEW.requesting_staff_id OR v_request.facility_id<>NEW.facility_id OR v_request.organization_id<>NEW.organization_id THEN RAISE EXCEPTION 'Requesting assignment changed or is unavailable'; END IF;
    SELECT staff_role::text INTO v_role FROM public.staff WHERE id=NEW.requesting_staff_id AND deleted_at IS NULL AND employment_status='active';
    SELECT staff_role::text INTO v_cover_role FROM public.staff WHERE id=NEW.covering_staff_id AND deleted_at IS NULL AND employment_status='active' AND facility_id=NEW.facility_id;
    IF v_role IS NULL OR v_cover_role IS DISTINCT FROM v_role THEN RAISE EXCEPTION 'Coverage requires an active employee with the same staffing role'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.staff_certifications WHERE staff_id=NEW.covering_staff_id AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM public.staff_certifications WHERE staff_id=NEW.covering_staff_id AND deleted_at IS NULL AND (status::text IN ('expired','revoked') OR expiration_date<v_request.shift_date)) THEN RAISE EXCEPTION 'Review missing or expired covering employee credentials'; END IF;
    IF NEW.covering_assignment_id IS NOT NULL THEN
      SELECT * INTO v_cover FROM public.shift_assignments WHERE id=NEW.covering_assignment_id AND deleted_at IS NULL;
      IF NOT FOUND OR v_cover.staff_id<>NEW.covering_staff_id OR v_cover.facility_id<>NEW.facility_id OR v_cover.organization_id<>NEW.organization_id THEN RAISE EXCEPTION 'Covering assignment changed or is unavailable'; END IF;
      IF EXISTS(SELECT 1 FROM public.shift_assignments WHERE staff_id=NEW.requesting_staff_id AND deleted_at IS NULL AND status::text NOT IN ('cancelled','no_show') AND id NOT IN(NEW.requesting_assignment_id,NEW.covering_assignment_id) AND shift_date BETWEEN v_cover.shift_date-1 AND v_cover.shift_date+1) THEN RAISE EXCEPTION 'Requesting employee has adjacent assignments; review rest and overlap before coverage'; END IF;
    END IF;
    IF EXISTS(SELECT 1 FROM public.shift_assignments WHERE staff_id=NEW.covering_staff_id AND deleted_at IS NULL AND status::text NOT IN ('cancelled','no_show') AND id<>NEW.requesting_assignment_id AND id IS DISTINCT FROM NEW.covering_assignment_id AND shift_date BETWEEN v_request.shift_date-1 AND v_request.shift_date+1) THEN RAISE EXCEPTION 'Covering employee has adjacent assignments; review rest and overlap before coverage'; END IF;
    UPDATE public.shift_assignments SET staff_id=NEW.covering_staff_id,updated_by=auth.uid() WHERE id=NEW.requesting_assignment_id;
    IF NEW.covering_assignment_id IS NOT NULL THEN UPDATE public.shift_assignments SET staff_id=NEW.requesting_staff_id,updated_by=auth.uid() WHERE id=NEW.covering_assignment_id; END IF;
    NEW.approved_by:=auth.uid(); NEW.approved_at:=now(); NEW.denied_reason:=NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER apply_approved_shift_swap BEFORE INSERT OR UPDATE ON public.shift_swap_requests FOR EACH ROW EXECUTE FUNCTION public.haven_apply_approved_shift_swap();
CREATE OR REPLACE FUNCTION public.confirm_shift_swap(p_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_swap public.shift_swap_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_swap FROM public.shift_swap_requests WHERE id=p_id AND deleted_at IS NULL AND status IN ('pending','claimed') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending swap unavailable'; END IF;
  IF EXISTS(SELECT 1 FROM public.staff WHERE id=v_swap.requesting_staff_id AND user_id=auth.uid() AND deleted_at IS NULL) THEN
    UPDATE public.shift_swap_requests SET requesting_confirmed_at=clock_timestamp() WHERE id=p_id;
  ELSIF EXISTS(SELECT 1 FROM public.staff WHERE id=v_swap.covering_staff_id AND user_id=auth.uid() AND deleted_at IS NULL) THEN
    UPDATE public.shift_swap_requests SET covering_confirmed_at=clock_timestamp() WHERE id=p_id;
  ELSE RAISE EXCEPTION 'Only a participant can confirm this swap'; END IF;
  RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.confirm_shift_swap(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_shift_swap(uuid) TO authenticated;

-- Draft shift edits are serialized with the schedule and validate scope/dates.
CREATE OR REPLACE FUNCTION public.edit_draft_schedule(p_schedule_id uuid,p_action text,p_shift_id uuid,p_staff_id uuid DEFAULT NULL,p_date date DEFAULT NULL,p_start time DEFAULT NULL,p_end time DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_schedule public.schedules%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT * INTO v_schedule FROM public.schedules WHERE id=p_schedule_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_schedule.status<>'draft' THEN RAISE EXCEPTION 'Editable draft schedule unavailable'; END IF;
  IF p_action='remove' THEN
    UPDATE public.shift_assignments SET deleted_at=now(),updated_by=auth.uid() WHERE id=p_shift_id AND schedule_id=p_schedule_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Assignment unavailable'; END IF;
  ELSIF p_action='add' THEN
    IF p_shift_id IS NULL OR p_date IS NULL OR p_start IS NULL OR p_end IS NULL OR p_start=p_end OR p_date<v_schedule.week_start_date OR p_date>v_schedule.week_start_date+6 THEN RAISE EXCEPTION 'Provide a shift date in this week and distinct start/end times'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=p_staff_id AND facility_id=v_schedule.facility_id AND organization_id=v_schedule.organization_id AND deleted_at IS NULL AND employment_status='active') THEN RAISE EXCEPTION 'Active employee in schedule facility required'; END IF;
    INSERT INTO public.shift_assignments(id,schedule_id,staff_id,facility_id,organization_id,shift_date,shift_type,custom_start_time,custom_end_time,created_by,updated_by)
      VALUES(p_shift_id,p_schedule_id,p_staff_id,v_schedule.facility_id,v_schedule.organization_id,p_date,'custom',p_start,p_end,auth.uid(),auth.uid());
  ELSE RAISE EXCEPTION 'Unknown draft action'; END IF;
  RETURN p_shift_id;
END $$;
REVOKE ALL ON FUNCTION public.edit_draft_schedule(uuid,text,uuid,uuid,date,time,time) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.edit_draft_schedule(uuid,text,uuid,uuid,date,time,time) TO authenticated;

-- B09: one statement snapshot over the complete authorized batch (JSON scalar
-- avoids REST set-returning row limits). Display pagination remains separate.
CREATE OR REPLACE FUNCTION public.payroll_export_snapshot(p_batch_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT jsonb_build_object('batch',to_jsonb(b),'lines',coalesce((SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('staff',(SELECT jsonb_build_object('first_name',s.first_name,'last_name',s.last_name) FROM public.staff s WHERE s.id=l.staff_id)) ORDER BY l.created_at,l.id) FROM public.payroll_export_lines l WHERE l.batch_id=b.id AND l.deleted_at IS NULL),'[]'::jsonb))
    INTO v_result FROM public.payroll_export_batches b WHERE b.id=p_batch_id AND b.deleted_at IS NULL;
  IF v_result IS NULL THEN RAISE EXCEPTION 'Payroll batch unavailable'; END IF;
  RETURN v_result||jsonb_build_object('line_count',jsonb_array_length(v_result->'lines'));
END $$;
REVOKE ALL ON FUNCTION public.payroll_export_snapshot(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.payroll_export_snapshot(uuid) TO authenticated;

-- Direct table clients cannot bypass the entity/account boundary either.
CREATE OR REPLACE FUNCTION public.haven_validate_journal_line_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.journal_entries e JOIN public.gl_accounts a ON a.id=NEW.gl_account_id AND a.entity_id=e.entity_id AND a.organization_id=e.organization_id WHERE e.id=NEW.journal_entry_id AND e.organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Account does not belong to journal entity'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_line_scope BEFORE INSERT OR UPDATE ON public.journal_entry_lines FOR EACH ROW EXECUTE FUNCTION public.haven_validate_journal_line_scope();

-- B04: eligibility is enforced at the write boundary against appointment date.
CREATE OR REPLACE FUNCTION public.haven_validate_transport_driver_license() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.driver_staff_id IS NOT NULL AND NEW.status::text <> 'cancelled' AND NOT EXISTS(
    SELECT 1 FROM public.driver_credentials c WHERE c.staff_id=NEW.driver_staff_id AND c.organization_id=NEW.organization_id AND c.deleted_at IS NULL AND c.license_expires_on>=NEW.appointment_date
  ) THEN RAISE EXCEPTION 'Driver license is missing or expires before this trip'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transport_driver_license BEFORE INSERT OR UPDATE ON public.resident_transport_requests FOR EACH ROW EXECUTE FUNCTION public.haven_validate_transport_driver_license();
