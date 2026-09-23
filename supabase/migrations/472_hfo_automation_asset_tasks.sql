BEGIN;

-- COL-671: the service projection only admitted authority_class='facility', but
-- COL-593 schedules asset work (generator runs, extinguisher checks) under an
-- 'asset' subject. operation_domain_access already treats 'asset' as site-level
-- like 'facility' (no subject grant), and operation_subject_current still
-- requires the asset to be live, unretired and on the task's site. Resident,
-- employee, financial and unclassified tasks stay out, so automation that
-- reconciles against the full population still refuses rather than scoring a
-- partial set as all-clear.
CREATE OR REPLACE VIEW public.operation_automation_tasks WITH (security_invoker=true) AS
 SELECT t.* FROM public.operation_task_instances t
 WHERE t.deleted_at IS NULL AND t.authority_class IN('facility','asset')
 AND coalesce(cardinality(t.completion_evidence_paths),0)=0
 AND haven.operation_subject_current(t.subject_id,t.organization_id,t.facility_id,t.authority_class)
 AND (t.template_id IS NULL OR EXISTS(SELECT 1 FROM public.operation_task_templates linked
 WHERE linked.id=t.template_id AND linked.organization_id=t.organization_id AND linked.deleted_at IS NULL
 AND (linked.facility_id IS NULL OR linked.facility_id=t.facility_id) AND linked.activity_id=t.activity_id
 AND haven.operation_template_links_current(linked.organization_id,t.facility_id,linked.linked_document_id,linked.asset_ref,linked.vendor_booking_ref)));
REVOKE ALL ON public.operation_automation_tasks FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.operation_automation_tasks TO service_role;
COMMENT ON VIEW public.operation_automation_tasks IS 'Service-only projection of open site-level (facility + asset) operation tasks with current subjects and template links. Protected subject classes and unclassified rows are never projected.';
NOTIFY pgrst,'reload schema';
COMMIT;
