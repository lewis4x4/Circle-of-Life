-- Retire a synthetic COL-504 hosted-smoke case on Haven HFO Staging. Run as the postgres role
-- through the Management API (node hosted-query.mjs iwcnajanvjvynolltflw <this file> after
-- replacing :case_id). Benefits rows are immutable evidence by trigger, so the triggers are
-- disabled for this one transaction and only rows belonging to the synthetic case are removed.
-- NEVER run this against production.
BEGIN;
DO $$
DECLARE v_case uuid := ':case_id';
BEGIN
  IF current_database() IS NULL THEN RAISE EXCEPTION 'no database'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.benefits_cases c JOIN public.residents r ON r.id = c.resident_id
                 WHERE c.id = v_case AND r.first_name LIKE 'Synthetic %') THEN
    RAISE EXCEPTION 'refusing: case % is not a synthetic-resident case', v_case;
  END IF;
  ALTER TABLE public.benefits_documents DISABLE TRIGGER benefits_document_immutable;
  ALTER TABLE public.benefits_collection_requests DISABLE TRIGGER benefits_collection_immutable;
  ALTER TABLE public.benefits_history DISABLE TRIGGER benefits_immutable;
  ALTER TABLE public.benefits_events DISABLE TRIGGER benefits_immutable;
  ALTER TABLE public.benefits_submissions DISABLE TRIGGER benefits_immutable;
  ALTER TABLE public.benefits_receipts DISABLE TRIGGER benefits_immutable;
  ALTER TABLE public.benefits_requests DISABLE TRIGGER benefits_immutable;
  DELETE FROM public.benefits_collection_requests WHERE case_id = v_case;
  DELETE FROM public.benefits_requests WHERE case_id = v_case;
  DELETE FROM public.benefits_receipts WHERE case_id = v_case;
  DELETE FROM public.benefits_submissions WHERE case_id = v_case;
  DELETE FROM public.benefits_events WHERE case_id = v_case;
  DELETE FROM public.benefits_history WHERE case_id = v_case;
  DELETE FROM public.benefits_requirements WHERE case_id = v_case;
  DELETE FROM public.benefits_documents WHERE case_id = v_case;
  DELETE FROM public.benefits_cases WHERE id = v_case;
  ALTER TABLE public.benefits_documents ENABLE TRIGGER benefits_document_immutable;
  ALTER TABLE public.benefits_collection_requests ENABLE TRIGGER benefits_collection_immutable;
  ALTER TABLE public.benefits_history ENABLE TRIGGER benefits_immutable;
  ALTER TABLE public.benefits_events ENABLE TRIGGER benefits_immutable;
  ALTER TABLE public.benefits_submissions ENABLE TRIGGER benefits_immutable;
  ALTER TABLE public.benefits_receipts ENABLE TRIGGER benefits_immutable;
  ALTER TABLE public.benefits_requests ENABLE TRIGGER benefits_immutable;
END $$;
-- Synthetic actors created by the smoke are banned + deactivated by the script; remove their
-- grant rows here so nothing references them.
ALTER TABLE public.benefits_access_history DISABLE TRIGGER benefits_immutable;
DELETE FROM public.benefits_access_history WHERE grant_id IN (SELECT g.id FROM public.benefits_access_grants g JOIN public.user_profiles p ON p.id = g.user_id WHERE p.email LIKE 'col504-%@example.invalid');
DELETE FROM public.benefits_access_grants g USING public.user_profiles p WHERE p.id = g.user_id AND p.email LIKE 'col504-%@example.invalid';
ALTER TABLE public.benefits_access_history ENABLE TRIGGER benefits_immutable;
-- Operating-rule rows recorded by the smoke carry a 'smoke ' reason prefix; retire them so staging rules stay meaningful.
ALTER TABLE public.benefits_rules DISABLE TRIGGER benefits_immutable;
DELETE FROM public.benefits_rules WHERE reason LIKE 'smoke %';
ALTER TABLE public.benefits_rules ENABLE TRIGGER benefits_immutable;
COMMIT;
