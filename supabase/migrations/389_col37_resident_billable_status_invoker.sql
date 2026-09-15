-- COL-37: close the anonymous read of every resident's census status, and
-- settle the two Security Advisor findings that sit in the same family.
--
-- public.resident_billable_status was created in 217 without security_invoker,
-- so it ran with its owner's rights and ignored the row-level security on
-- public.residents underneath it. Supabase's default grants hand every public
-- schema view to anon and authenticated, so the publishable anon key that ships
-- in the browser bundle could read the whole resident roster -- resident_id,
-- organization_id, facility_id, status, is_billable -- for every facility, with
-- no session at all. Measured on production 2026-09-15 immediately before this
-- migration: GET /rest/v1/residents returned 0 rows to anon (RLS holding),
-- while GET /rest/v1/resident_billable_status returned a count of 33.
--
-- The view is also auto-updatable -- one table in its FROM, simple column
-- references -- so with owner's rights those same grants carried INSERT, UPDATE
-- and DELETE straight through to public.residents. No caller in src/ reads or
-- writes this view; the grants were never deliberate.

BEGIN;

ALTER VIEW public.resident_billable_status SET (security_invoker = true);

-- Nothing anonymous has business reading census status. Authenticated keeps
-- SELECT only; write paths to residents go through the RLS policies on the
-- table, never through a view.
REVOKE ALL ON public.resident_billable_status FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.resident_billable_status FROM authenticated;

COMMENT ON VIEW public.resident_billable_status IS
  'Computed COL billing/census status. Caller RLS via security_invoker: rows follow the reader''s authority over public.residents, not the view owner''s. SELECT to authenticated only -- anon has no grant, and the view is not a write path. Active, hospital hold, and LOA are billable until provider-specific bed-hold policies are configured.';

-- haven_payroll_batch_guard and haven_payroll_line_guard are BEFORE-row trigger
-- functions on public.payroll_export_batches / payroll_export_lines. They were
-- written in 334 before the repo settled on revoking trigger functions, so they
-- kept the default EXECUTE grant to PUBLIC, anon, authenticated and
-- service_role. Triggers fire on the table owner's authority and do not
-- re-check EXECUTE at fire time, so revoking costs the payroll write path
-- nothing. Same treatment as haven.guard_* in 349, 353, 354, 359-361, 368, 369,
-- 374 and 386.
REVOKE ALL ON FUNCTION public.haven_payroll_batch_guard(), public.haven_payroll_line_guard()
  FROM PUBLIC, anon, authenticated, service_role;

-- public.haven_assert_authorized_request() is the third function the advisor
-- flags as anon-executable, and its grant must stay. PostgREST calls it as the
-- request role through pgrst.db_pre_request (set on the authenticator role in
-- 326) before every single request, including anonymous ones -- revoking anon
-- or authenticated would refuse every hosted API call. It takes no arguments,
-- returns void, and either returns silently or raises, so a direct RPC call
-- discloses nothing. Recorded here so the next advisor sweep does not revoke it
-- on sight.
COMMENT ON FUNCTION public.haven_assert_authorized_request() IS
  'PostgREST pgrst.db_pre_request hook (326/329). EXECUTE to anon and authenticated is required, not an oversight: PostgREST runs this as the request role before every request and a revoke refuses the whole API. Returns void, discloses nothing when called directly. COL-37 advisor exception -- do not revoke.';

-- Grants changed, so PostgREST's cached view of the API is now wrong.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- Rollback must be a separately reviewed forward migration. Do not restore
-- owner's-rights semantics on resident_billable_status or the anon grant; if
-- the view needs a service-side consumer, grant that role explicitly.
