-- Align Facility Launch promotion run ledger with haven_set_updated_at().
--
-- The shared trigger writes NEW.updated_by on every update. The Item 1 ledger
-- table had updated_at but missed updated_by, which made live run finalization
-- fail when the trigger executed.

ALTER TABLE public.facility_launch_promotion_runs
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id);
