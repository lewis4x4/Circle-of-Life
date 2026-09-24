-- COL-804 conservative rollback. Restore the previous application first, then
-- pause the new editing paths. Preserve every assignment/snapshot and interval
-- reader; removing those would orphan already-published split/custom work in
-- clinical consumers. Cadence, clock punches and payroll rules remain intact.
BEGIN;
REVOKE INSERT,UPDATE ON public.facility_schedule_presets FROM authenticated;
REVOKE EXECUTE ON FUNCTION
 public.schedule_preset_save(uuid,uuid,integer,text,text,integer,jsonb,public.staff_role[],boolean,boolean,boolean),
 public.schedule_bulk_upsert(uuid,timestamptz,jsonb),
 public.schedule_copy_week(uuid,timestamptz)
FROM PUBLIC,anon,authenticated,service_role;
-- Re-enable only through a reviewed forward change after restoring the repaired
-- application. No DROP, assignment rewrite, clinical cadence rewrite or deletion.
COMMIT;
