BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT INSERT,UPDATE ON public.tray_tickets TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TEMP TABLE dietary_fixture AS SELECT gen_random_uuid() actor,gen_random_uuid() resident,gen_random_uuid() ticket,gen_random_uuid() service,
 id facility,organization_id org FROM public.facilities WHERE deleted_at IS NULL LIMIT 1;
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) SELECT actor,actor||'@dietary-review.invalid',jsonb_build_object('organization_id',org,'app_role','dietary'),jsonb_build_object('full_name','Dietary test') FROM dietary_fixture;
INSERT INTO public.user_profiles(id,organization_id,email,full_name,app_role,is_active) SELECT actor,org,actor||'@dietary-review.invalid','Dietary test','dietary',true FROM dietary_fixture
 ON CONFLICT(id) DO UPDATE SET organization_id=excluded.organization_id,app_role=excluded.app_role,is_active=true;
INSERT INTO public.user_facility_access(user_id,facility_id,organization_id,revoked_at) SELECT actor,facility,org,now() FROM dietary_fixture;
INSERT INTO public.residents(id,facility_id,organization_id,first_name,last_name,date_of_birth,gender) SELECT resident,facility,org,'Dietary','Test','1940-01-01','female' FROM dietary_fixture;
INSERT INTO public.diet_orders(organization_id,facility_id,resident_id,diet_type,iddsi_food_level,iddsi_liquid_level,allergies,status)
 SELECT org,facility,resident,'regular',7,0,ARRAY['egg'],'active' FROM dietary_fixture;
INSERT INTO public.meal_services(id,organization_id,facility_id,service_date,meal_period,venue,scheduled_start,scheduled_end)
 SELECT service,org,facility,'2099-12-31','dinner','private_dining',now(),now()+interval '1 hour' FROM dietary_fixture;
INSERT INTO public.tray_tickets(id,organization_id,facility_id,resident_id,meal_service_id,diet_order_snapshot)
 SELECT ticket,org,facility,resident,service,'{"diet_type":"regular","iddsi_food_level":7,"iddsi_liquid_level":0,"allergies":["egg"]}' FROM dietary_fixture;
DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM dietary_fixture;
 BEGIN
  PERFORM public.haven_record_tray_pass(f.ticket,f.resident,7,0,f.actor);
  RAISE EXCEPTION 'Revoked dietary actor passed a tray';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE public.user_facility_access SET revoked_at=NULL WHERE user_id=f.actor;
 UPDATE public.tray_tickets SET diet_order_snapshot=jsonb_set(diet_order_snapshot,'{allergies}','[]') WHERE id=f.ticket;
 BEGIN
  PERFORM public.haven_record_tray_pass(f.ticket,f.resident,7,0,f.actor);
  RAISE EXCEPTION 'Stale allergy snapshot passed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Tray snapshot differs from the current diet order. Regenerate the tray before serving.' THEN RAISE; END IF; END;
 UPDATE public.tray_tickets SET diet_order_snapshot=jsonb_set(diet_order_snapshot,'{allergies}','["egg"]') WHERE id=f.ticket;
 PERFORM public.haven_record_tray_pass(f.ticket,f.resident,7,0,f.actor);
 IF NOT EXISTS(SELECT 1 FROM public.tray_tickets WHERE id=f.ticket AND status='passed' AND passed_by=f.actor AND passed_at IS NOT NULL) THEN RAISE EXCEPTION 'Valid pass was not saved'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.audit_log WHERE record_id=f.ticket AND user_id=f.actor AND new_data->>'event'='tray_pass_verified') THEN RAISE EXCEPTION 'Verified pass audit missing'; END IF;
END $$;
GRANT SELECT ON dietary_fixture TO authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','app_role','dietary','organization_id',org,'app_metadata',jsonb_build_object('app_role','dietary','organization_id',org))::text,true) FROM dietary_fixture;
SET LOCAL ROLE authenticated;
DO $$ DECLARE f record; BEGIN
 SELECT * INTO f FROM dietary_fixture;
 BEGIN
  INSERT INTO public.tray_tickets(organization_id,facility_id,resident_id,meal_service_id,status,passed_by,passed_at)
    VALUES(f.org,f.facility,f.resident,f.service,'passed',f.actor,now());
  RAISE EXCEPTION 'Client forged a passed tray on insert';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
