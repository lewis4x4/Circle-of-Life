BEGIN;
-- COL-152 / COL-32. Extend the existing delivery ledger, not a second task
-- engine. No schedules, recipients, external channels or jobs are activated.
ALTER TABLE public.operation_escalation_deliveries
 ADD COLUMN reminder_issue_id uuid REFERENCES public.operation_issues(id),
 ADD COLUMN reminder_state text CHECK(reminder_state IN('configuration_needed','upcoming','active','resolved')),
 ADD COLUMN reminder_phase text CHECK(reminder_phase IN('due','overdue','follow_up')),
 ADD COLUMN reminder_problem text,
 ADD COLUMN reminder_revision uuid DEFAULT gen_random_uuid(),
 ADD COLUMN reminder_generation integer NOT NULL DEFAULT 1,
 ADD COLUMN reminder_acknowledged_at timestamptz,
 ADD COLUMN reminder_snoozed_until timestamptz,
 ADD COLUMN reminder_updated_at timestamptz,
 ADD COLUMN reminder_source_revision text,
 ADD COLUMN reminder_request_key text,
 ADD COLUMN reminder_request_payload jsonb;
CREATE UNIQUE INDEX operation_reminder_task_identity ON public.operation_escalation_deliveries(task_instance_id) WHERE reminder_state IS NOT NULL AND reminder_issue_id IS NULL;
CREATE UNIQUE INDEX operation_reminder_issue_identity ON public.operation_escalation_deliveries(reminder_issue_id) WHERE reminder_state IS NOT NULL AND reminder_issue_id IS NOT NULL;
ALTER TABLE public.operation_escalation_deliveries ADD CONSTRAINT operation_reminder_channel CHECK(reminder_state IS NULL OR (channel='in_app' AND target_phone IS NULL AND provider_message_id IS NULL AND provider_payload='{}'::jsonb AND deleted_at IS NULL));

-- Even the legacy service writer cannot invent delivery for a managed task.
-- The owner-only definer below is the only granted write surface. The normal
-- audit trigger retains the before/after record for every real transition.
CREATE FUNCTION haven.guard_operation_reminder_delivery() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE task uuid; managed boolean;
BEGIN
 task:=CASE WHEN TG_OP='DELETE' THEN OLD.task_instance_id ELSE NEW.task_instance_id END;
 SELECT occurrence_kind IS NOT NULL INTO managed FROM public.operation_task_instances WHERE id=task;
 IF TG_OP='UPDATE' THEN managed:=managed OR OLD.reminder_state IS NOT NULL OR EXISTS(SELECT 1 FROM public.operation_task_instances WHERE id=OLD.task_instance_id AND occurrence_kind IS NOT NULL); END IF;
 IF managed AND coalesce(current_setting('haven.operation_reminder_command',true),'')<>haven.operation_occurrence_token() THEN
  RAISE EXCEPTION 'Managed reminders require the reminder command' USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION haven.guard_operation_reminder_delivery() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER operation_reminder_delivery_guard BEFORE INSERT OR UPDATE OR DELETE ON public.operation_escalation_deliveries FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_reminder_delivery();
CREATE FUNCTION haven.operation_reminder_readable(p_task uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN t.occurrence_kind IS NULL THEN true ELSE haven.operation_task_readable(p_task) END FROM public.operation_task_instances t WHERE t.id=p_task
$$;
REVOKE ALL ON FUNCTION haven.operation_reminder_readable(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION haven.operation_reminder_readable(uuid) TO authenticated;
CREATE POLICY operation_reminder_subject_scope ON public.operation_escalation_deliveries AS RESTRICTIVE FOR SELECT TO authenticated USING(haven.operation_reminder_readable(task_instance_id));

CREATE FUNCTION haven.operation_reminder_recipient_current(p_user uuid,p_task uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(haven.operation_issue_user_current(p_user,t.organization_id,t.facility_id),false)
 AND haven.operation_issue_user_role_allowed(p_user)
 AND (t.authority_class IN('facility','asset') OR EXISTS(SELECT 1 FROM public.operation_subject_access g WHERE g.user_id=p_user AND g.organization_id=t.organization_id AND g.facility_id=t.facility_id AND g.scope=t.authority_class AND g.can_record AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp())))
 AND (t.authority_class<>'employee_medical' OR EXISTS(SELECT 1 FROM public.employee_medical_access g WHERE g.user_id=p_user AND g.organization_id=t.organization_id AND g.facility_id=t.facility_id AND g.revoked_at IS NULL))
 AND (t.authority_class<>'financial' OR p.app_role::text IN('owner','org_admin'))
 AND (t.authority_class<>'resident' OR p.app_role::text IN('owner','org_admin','facility_admin','nurse'))
 AND (t.authority_class<>'employee_personnel' OR p.app_role::text IN('owner','org_admin','facility_admin','manager') OR EXISTS(SELECT 1 FROM public.operation_activity_subjects s JOIN public.staff employee ON employee.id=s.employee_id WHERE s.id=t.subject_id AND employee.user_id=p_user))
 FROM public.operation_task_instances t JOIN public.user_profiles p ON p.id=p_user WHERE t.id=p_task
$$;
REVOKE ALL ON FUNCTION haven.operation_reminder_recipient_current(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Immutable command receipts preserve all retry keys, including after a newer action.
CREATE TABLE public.operation_reminder_responses(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id),
 facility_id uuid NOT NULL REFERENCES public.facilities(id), delivery_id uuid NOT NULL REFERENCES public.operation_escalation_deliveries(id),
 request_key text NOT NULL, request_payload jsonb NOT NULL, actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(delivery_id,request_key)
);
ALTER TABLE public.operation_reminder_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY operation_reminder_audit_current ON public.audit_log AS RESTRICTIVE FOR SELECT TO authenticated USING(table_name NOT IN('operation_reminder_responses','operation_escalation_deliveries'));
CREATE TRIGGER operation_reminder_responses_no_truncate BEFORE TRUNCATE ON public.operation_reminder_responses FOR EACH STATEMENT EXECUTE FUNCTION haven.guard_operation_catalog_truncate();
REVOKE ALL ON public.operation_reminder_responses FROM anon,authenticated,service_role;
CREATE TRIGGER tr_operation_reminder_responses_audit AFTER INSERT ON public.operation_reminder_responses FOR EACH ROW EXECUTE PROCEDURE public.haven_capture_audit_log();
CREATE FUNCTION haven.guard_operation_reminder_response() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'Reminder response history is immutable' USING ERRCODE='42501'; END $$;
REVOKE ALL ON FUNCTION haven.guard_operation_reminder_response() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER operation_reminder_response_immutable BEFORE UPDATE OR DELETE ON public.operation_reminder_responses FOR EACH ROW EXECUTE FUNCTION haven.guard_operation_reminder_response();

CREATE FUNCTION haven.operation_reminder_command(p_task uuid,p_command text,p_expected_revision uuid DEFAULT NULL,p_until timestamptz DEFAULT NULL,p_request_key text DEFAULT NULL,p_issue uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.operation_task_instances; e public.operation_escalation_deliveries; i public.operation_issues; fr public.operation_facility_requirements;
 recipient uuid; backup uuid; state text; phase text; problem text; threshold timestamptz; source_revision text; stamp timestamptz; changed boolean; replayed boolean:=false; fingerprint jsonb; receipt public.operation_reminder_responses;
BEGIN
 IF p_command NOT IN('refresh','acknowledge','snooze') OR p_command IS NULL THEN RAISE EXCEPTION 'Invalid reminder command' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('operation-reminder:'||p_task::text,0));
 -- Match issue commands' issue -> work lock order. Task reminders never lock issues.
 IF p_issue IS NOT NULL THEN
  i:=haven.lock_operation_issue_authority(p_issue);
  IF i.task_instance_id IS DISTINCT FROM p_task THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 PERFORM haven.lock_operation_work_authority(p_task,NULL);
 SELECT * INTO t FROM public.operation_task_instances WHERE id=p_task;
 IF t.occurrence_kind IS NULL THEN RAISE EXCEPTION 'Managed work required' USING ERRCODE='22023'; END IF;
 SELECT * INTO fr FROM public.operation_facility_requirements WHERE id=t.facility_requirement_id FOR SHARE;
 recipient:=CASE WHEN p_issue IS NOT NULL THEN i.owner_user_id ELSE coalesce(t.assigned_to,fr.owner_user_id) END;
 backup:=CASE WHEN p_issue IS NOT NULL THEN i.backup_user_id ELSE fr.backup_user_id END;
 PERFORM 1 FROM public.user_profiles WHERE id IN(recipient,backup) ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.user_facility_access WHERE user_id IN(recipient,backup) AND facility_id=t.facility_id ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.operation_subject_access WHERE user_id IN(recipient,backup) AND facility_id=t.facility_id ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.employee_medical_access WHERE user_id IN(recipient,backup) AND facility_id=t.facility_id ORDER BY id FOR SHARE;
 SELECT * INTO e FROM public.operation_escalation_deliveries WHERE task_instance_id=p_task AND reminder_state IS NOT NULL AND reminder_issue_id IS NOT DISTINCT FROM p_issue FOR UPDATE;
 -- No authority or time snapshot survives the final potentially blocking lock.
 PERFORM haven.lock_operation_work_authority(p_task,NULL);
 stamp:=clock_timestamp();
 IF NOT coalesce(haven.operation_reminder_recipient_current(recipient,p_task),false) THEN
  recipient:=CASE WHEN coalesce(haven.operation_reminder_recipient_current(backup,p_task),false) THEN backup ELSE NULL END;
 END IF;
 threshold:=CASE WHEN p_issue IS NOT NULL THEN i.follow_up_at ELSE coalesce(t.grace_ends_at,t.due_at) END;
 source_revision:=CASE WHEN p_issue IS NOT NULL THEN i.issue_revision ELSE t.occurrence_revision END;
 state:='upcoming';
 IF (p_issue IS NOT NULL AND i.status='resolved') OR (p_issue IS NULL AND t.status IN('completed','cancelled')) THEN state:='resolved';
 ELSIF threshold IS NULL OR (p_issue IS NULL AND t.occurrence_kind='manual') THEN state:='configuration_needed'; problem:=CASE WHEN p_issue IS NOT NULL THEN 'Approved issue follow-up window needed' ELSE 'Approved deadline needed' END;
 ELSIF p_issue IS NULL AND t.remind_at IS NULL THEN state:='configuration_needed'; problem:='Approved reminder window needed';
 ELSIF recipient IS NULL THEN state:='configuration_needed'; problem:='Current named recipient with work access needed';
 ELSIF p_issue IS NOT NULL THEN phase:='follow_up'; IF stamp>=threshold THEN state:='active'; END IF;
 ELSIF stamp>=threshold THEN state:='active'; phase:='overdue';
 ELSIF stamp>=t.remind_at THEN state:='active'; phase:='due'; END IF;
 fingerprint:=jsonb_build_object('command',p_command,'revision',p_expected_revision,'until',p_until,'actor',auth.uid());
 IF p_command<>'refresh' AND (p_request_key IS NULL OR length(p_request_key) NOT BETWEEN 8 AND 200) THEN RAISE EXCEPTION 'Request key required' USING ERRCODE='22023'; END IF;
 SELECT * INTO receipt FROM public.operation_reminder_responses WHERE delivery_id=e.id AND request_key=p_request_key;
 replayed:=p_command<>'refresh' AND receipt.id IS NOT NULL AND fingerprint=receipt.request_payload;
 IF p_command<>'refresh' AND receipt.id IS NOT NULL AND fingerprint IS DISTINCT FROM receipt.request_payload THEN RAISE EXCEPTION 'Request key changed' USING ERRCODE='40001'; END IF;
 IF p_command<>'refresh' AND NOT coalesce(replayed,false) AND (e.id IS NULL OR p_expected_revision IS DISTINCT FROM e.reminder_revision) THEN RAISE EXCEPTION 'Reminder changed; refresh before retrying' USING ERRCODE='40001'; END IF;
 PERFORM set_config('haven.operation_reminder_command',haven.operation_occurrence_token(),true);
 IF e.id IS NULL THEN
  INSERT INTO public.operation_escalation_deliveries(organization_id,facility_id,task_instance_id,reminder_issue_id,channel,delivery_status,target_user_id,reminder_state,reminder_phase,reminder_problem,reminder_updated_at,reminder_source_revision,created_by)
  VALUES(t.organization_id,t.facility_id,t.id,p_issue,'in_app','queued',recipient,state,phase,problem,stamp,source_revision,auth.uid()) RETURNING * INTO e;
 ELSE
  changed:=(e.target_user_id,e.reminder_state,e.reminder_phase,e.reminder_problem,e.reminder_source_revision) IS DISTINCT FROM (recipient,state,phase,problem,source_revision);
  IF changed THEN
   UPDATE public.operation_escalation_deliveries SET target_user_id=recipient,reminder_state=state,reminder_phase=phase,reminder_problem=problem,
    reminder_generation=e.reminder_generation+CASE WHEN e.reminder_state='resolved' AND state<>'resolved' THEN 1 ELSE 0 END,
    reminder_acknowledged_at=NULL,reminder_snoozed_until=NULL,delivery_status='queued',reminder_request_key=NULL,reminder_request_payload=NULL,
    reminder_source_revision=source_revision,reminder_updated_at=stamp,reminder_revision=gen_random_uuid()
   WHERE id=e.id RETURNING * INTO e;
  END IF;
 END IF;
 IF p_command<>'refresh' THEN
  IF NOT coalesce(replayed,false) AND e.reminder_revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Reminder changed; refresh before retrying' USING ERRCODE='40001'; END IF;
  IF recipient IS DISTINCT FROM auth.uid() OR state<>'active' THEN RAISE EXCEPTION 'Only the current reminder recipient can respond' USING ERRCODE='42501'; END IF;
  IF NOT coalesce(replayed,false) THEN
   IF p_command='snooze' AND (p_until IS NULL OR p_until<=stamp OR NOT isfinite(p_until)) THEN RAISE EXCEPTION 'Choose a future snooze time' USING ERRCODE='22023'; END IF;
   IF p_command='acknowledge' AND p_until IS NOT NULL THEN RAISE EXCEPTION 'Acknowledge does not take a snooze time' USING ERRCODE='22023'; END IF;
   UPDATE public.operation_escalation_deliveries SET reminder_request_key=p_request_key,reminder_request_payload=fingerprint,
    reminder_acknowledged_at=CASE WHEN p_command='acknowledge' THEN coalesce(reminder_acknowledged_at,stamp) ELSE NULL END,
    reminder_snoozed_until=CASE WHEN p_command='snooze' THEN p_until ELSE NULL END,
    delivery_status='sent',reminder_updated_at=stamp,reminder_revision=gen_random_uuid() WHERE id=e.id RETURNING * INTO e;
   INSERT INTO public.operation_reminder_responses(organization_id,facility_id,delivery_id,request_key,request_payload,actor_id) VALUES(t.organization_id,t.facility_id,e.id,p_request_key,fingerprint,auth.uid());
  END IF;
 END IF;
 -- Audit insertion can wait too; a newly expired grant rolls back the command.
 PERFORM haven.lock_operation_work_authority(p_task,NULL);
 IF recipient IS NOT NULL AND NOT coalesce(haven.operation_reminder_recipient_current(recipient,p_task),false) THEN RAISE EXCEPTION 'Reminder recipient changed; refresh' USING ERRCODE='40001'; END IF;
 PERFORM set_config('haven.operation_reminder_command','',true);
 RETURN jsonb_build_object('id',e.id,'issue_id',p_issue,'source_label',CASE WHEN p_issue IS NOT NULL THEN i.summary ELSE t.template_name END,'state',e.reminder_state,'phase',e.reminder_phase,'problem',e.reminder_problem,'revision',e.reminder_revision,'generation',e.reminder_generation,
  'acknowledged_at',e.reminder_acknowledged_at,'snoozed_until',e.reminder_snoozed_until,'can_respond',coalesce(recipient=auth.uid() AND state='active',false),
  'suppressed',coalesce(e.reminder_acknowledged_at IS NOT NULL OR e.reminder_snoozed_until>clock_timestamp(),false),'channel','in_app','delivery_status',e.delivery_status,'replayed',coalesce(replayed,false));
END $$;
REVOKE ALL ON FUNCTION haven.operation_reminder_command(uuid,text,uuid,timestamptz,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.operation_reminder_review(p_task uuid,p_command text,p_expected_revision uuid DEFAULT NULL,p_until timestamptz DEFAULT NULL,p_request_key text DEFAULT NULL,p_issue uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT haven.operation_reminder_command(p_task,p_command,p_expected_revision,p_until,p_request_key,p_issue) $$;
GRANT EXECUTE ON FUNCTION haven.operation_reminder_command(uuid,text,uuid,timestamptz,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.operation_reminder_review(uuid,text,uuid,timestamptz,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.operation_reminder_review(uuid,text,uuid,timestamptz,text,uuid) TO authenticated;
COMMIT;
