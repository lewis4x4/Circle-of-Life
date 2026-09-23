-- COL-627 (Brian, 2026-09-23): med-techs lose the admin finance, payroll and staff
-- pages, and "yes" to locking the underlying staff data at the database too — the
-- staff roster (it carries pay rates), time records and background checks. Staff
-- illness records stay: "they should have that for patients".
--
-- Med-Tech inherited these reads (and background-check writes) from the retired nurse
-- role (migration 468). One RESTRICTIVE policy per table withdraws them from med_tech
-- while keeping each med-tech's OWN rows, which the clock, schedule, shift-swap and
-- profile pages read. Every other role is unaffected. Helpers are wrapped in
-- (SELECT …) so they run once per statement, not once per row.
BEGIN;

CREATE POLICY "Med-techs see their own staff row only" ON public.staff
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'med_tech' OR user_id = (SELECT auth.uid()))
  WITH CHECK ((SELECT haven.app_role()) IS DISTINCT FROM 'med_tech' OR user_id = (SELECT auth.uid()));

CREATE POLICY "Med-techs see their own time records only" ON public.time_records
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'med_tech'
    OR staff_id IN (SELECT s.id FROM public.staff s WHERE s.user_id = (SELECT auth.uid()) AND s.deleted_at IS NULL))
  WITH CHECK ((SELECT haven.app_role()) IS DISTINCT FROM 'med_tech'
    OR staff_id IN (SELECT s.id FROM public.staff s WHERE s.user_id = (SELECT auth.uid()) AND s.deleted_at IS NULL));

CREATE POLICY "Med-techs see their own background checks only" ON public.staff_background_checks
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT haven.app_role()) IS DISTINCT FROM 'med_tech'
    OR staff_id IN (SELECT s.id FROM public.staff s WHERE s.user_id = (SELECT auth.uid()) AND s.deleted_at IS NULL))
  WITH CHECK ((SELECT haven.app_role()) IS DISTINCT FROM 'med_tech'
    OR staff_id IN (SELECT s.id FROM public.staff s WHERE s.user_id = (SELECT auth.uid()) AND s.deleted_at IS NULL));

NOTIFY pgrst, 'reload schema';
COMMIT;
