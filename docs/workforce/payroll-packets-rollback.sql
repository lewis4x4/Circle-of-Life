-- COL-357 rollback: disable new packet writers while preserving immutable payroll
-- packets, policy history, source revisions and audit evidence. Restore the prior
-- application release first. Never drop finance tables to roll back the feature.
BEGIN;
REVOKE EXECUTE ON FUNCTION
 public.payroll_packet_policy_save(uuid,uuid,jsonb,boolean,integer),
 public.payroll_packet_write(uuid,uuid,uuid,integer,text,integer,date,date,date,jsonb,jsonb,uuid,text),
 public.payroll_packet_action(uuid,uuid,integer,text,jsonb)
FROM PUBLIC,anon,authenticated,service_role;
-- Read RPCs remain available for packet history. Existing payroll exports and
-- timeclock functions are untouched. Re-enabling requires a reviewed forward
-- change granting only these exact functions to service_role.
COMMIT;
