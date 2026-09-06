-- Manual tray verification is one acknowledged, audited domain operation.
CREATE OR REPLACE FUNCTION public.haven_record_tray_pass(
  p_ticket_id uuid, p_resident_id uuid, p_food_level integer,
  p_liquid_level integer, p_actor_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor public.user_profiles%ROWTYPE;
  v_ticket public.tray_tickets%ROWTYPE;
  v_diet public.diet_orders%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_actor FROM public.user_profiles WHERE id = p_actor_id AND is_active AND deleted_at IS NULL;
  IF v_actor.app_role::text NOT IN ('dietary','dietary_aide','manager','owner','org_admin','facility_admin') THEN
    RAISE EXCEPTION 'Not permitted to pass trays' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT v_ticket FROM public.tray_tickets WHERE id=p_ticket_id AND resident_id=p_resident_id AND organization_id=v_actor.organization_id FOR UPDATE;
  IF v_actor.app_role::text NOT IN ('owner','org_admin') AND NOT EXISTS (
    SELECT 1 FROM public.user_facility_access WHERE user_id=p_actor_id AND facility_id=v_ticket.facility_id AND organization_id=v_actor.organization_id AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'No access to this facility' USING ERRCODE='42501'; END IF;
  IF v_ticket.status IN ('passed','delivered') AND v_ticket.passed_by=p_actor_id THEN RETURN v_ticket.id; END IF;
  IF v_ticket.status NOT IN ('queued','prepping','plating','plated') THEN RAISE EXCEPTION 'Tray cannot be passed from its current status'; END IF;
  SELECT * INTO v_diet FROM public.diet_orders WHERE resident_id=p_resident_id AND facility_id=v_ticket.facility_id AND organization_id=v_actor.organization_id AND active AND deleted_at IS NULL
    AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now()) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No current active diet order. Contact the nurse.'; END IF;
  IF p_food_level IS DISTINCT FROM v_diet.iddsi_food_level OR p_liquid_level IS DISTINCT FROM v_diet.iddsi_liquid_level THEN
    RAISE EXCEPTION 'Checked levels do not match the current order. Contact the nurse.';
  END IF;
  IF (v_ticket.diet_order_snapshot->>'iddsi_food_level')::integer IS DISTINCT FROM v_diet.iddsi_food_level
    OR (v_ticket.diet_order_snapshot->>'iddsi_liquid_level')::integer IS DISTINCT FROM v_diet.iddsi_liquid_level
    OR v_ticket.diet_order_snapshot->>'diet_type' IS DISTINCT FROM v_diet.diet_type
    OR COALESCE(v_ticket.diet_order_snapshot->'allergies','[]'::jsonb) IS DISTINCT FROM to_jsonb(v_diet.allergies)
  THEN RAISE EXCEPTION 'Tray snapshot differs from the current diet order. Regenerate the tray before serving.'; END IF;
  UPDATE public.tray_tickets SET status='passed', iddsi_confirmed_food=true, iddsi_confirmed_liquid=true,
    allergen_check_passed=true, passed_by=p_actor_id, passed_at=now() WHERE id=p_ticket_id;
  INSERT INTO public.audit_log(table_name,record_id,action,new_data,user_id,organization_id,facility_id)
    VALUES('tray_tickets',p_ticket_id,'UPDATE',jsonb_build_object('event','tray_pass_verified','food_level',p_food_level,'liquid_level',p_liquid_level),p_actor_id,v_actor.organization_id,v_ticket.facility_id);
  RETURN p_ticket_id;
END;
$$;
REVOKE ALL ON FUNCTION public.haven_record_tray_pass(uuid,uuid,integer,integer,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.haven_record_tray_pass(uuid,uuid,integer,integer,uuid) TO service_role;

-- tray_tickets has no updated_by column; do not use the generic audit-field setter.
CREATE OR REPLACE FUNCTION haven.touch_tray_ticket() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN NEW.updated_at:=now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS tr_tray_tickets_set_updated_at ON public.tray_tickets;
CREATE TRIGGER tr_tray_tickets_set_updated_at BEFORE UPDATE ON public.tray_tickets
  FOR EACH ROW EXECUTE FUNCTION haven.touch_tray_ticket();

CREATE OR REPLACE FUNCTION haven.guard_tray_verification() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF current_user NOT IN ('service_role','postgres','supabase_admin') THEN
    IF TG_OP='INSERT' THEN
      IF NEW.status IN ('passed','delivered') OR NEW.passed_by IS NOT NULL OR NEW.passed_at IS NOT NULL
        OR NEW.iddsi_confirmed_food OR NEW.iddsi_confirmed_liquid OR NEW.allergen_check_passed THEN
        RAISE EXCEPTION 'New trays must not contain verified checks' USING ERRCODE='42501';
      END IF;
    ELSE
      IF ROW(NEW.passed_by,NEW.passed_at,NEW.iddsi_confirmed_food,NEW.iddsi_confirmed_liquid,NEW.allergen_check_passed)
        IS DISTINCT FROM ROW(OLD.passed_by,OLD.passed_at,OLD.iddsi_confirmed_food,OLD.iddsi_confirmed_liquid,OLD.allergen_check_passed)
        OR (NEW.status IN ('passed','delivered') AND NEW.status IS DISTINCT FROM OLD.status) THEN
        RAISE EXCEPTION 'Tray verification must use the verified pass operation' USING ERRCODE='42501';
      END IF;
      IF OLD.passed_at IS NOT NULL AND ROW(NEW.resident_id,NEW.facility_id,NEW.organization_id,NEW.meal_service_id,NEW.diet_order_snapshot,NEW.menu_items,NEW.status)
        IS DISTINCT FROM ROW(OLD.resident_id,OLD.facility_id,OLD.organization_id,OLD.meal_service_id,OLD.diet_order_snapshot,OLD.menu_items,OLD.status) THEN
        RAISE EXCEPTION 'Passed tray identity and contents cannot be rewritten' USING ERRCODE='42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_tray_verification ON public.tray_tickets;
CREATE TRIGGER guard_tray_verification BEFORE INSERT OR UPDATE ON public.tray_tickets FOR EACH ROW EXECUTE FUNCTION haven.guard_tray_verification();
