-- haven_set_updated_at must not require an updated_by column.
--
-- The function (006) assigns NEW.updated_by unconditionally. It is attached as
-- a BEFORE UPDATE trigger to 45 tables that were created without that column
-- (verified on production and on a clean replay), so any UPDATE reaching those
-- triggers has raised 'record "new" has no field "updated_by"'. plpgsql
-- resolves record fields when the statement runs, so guarding the assignment
-- repairs every one of those tables without touching their schema. Tables that
-- do have the column keep getting it stamped.

CREATE OR REPLACE FUNCTION public.haven_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at := now();
  IF to_jsonb(NEW) ? 'updated_by' THEN
    NEW.updated_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$function$;
