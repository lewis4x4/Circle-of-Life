-- Operational rollback after restoring the preceding application deployment.
-- Retain all reports, revisions, import receipts and recovery decisions.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.stand_up_command(text,jsonb),haven.stand_up_command(text,jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.stand_up_export_aggregate(uuid,date),haven.stand_up_export_aggregate(uuid,date) FROM service_role;
COMMIT;
-- Reactivation requires validated application/schema parity and restoring only the above grants.
