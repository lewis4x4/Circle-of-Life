-- FL-012: every write retaining complete status must retain required evidence.
-- Explicitly reopen to draft before removing evidence; existing audit history remains.
CREATE OR REPLACE FUNCTION public.require_complete_discharge_reconciliation()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status='complete' THEN
  IF NEW.pharmacist_reviewed_at IS NULL OR coalesce(NEW.pharmacist_npi,'') !~ '^[0-9]{10}$' OR nullif(trim(NEW.pharmacist_notes),'') IS NULL THEN RAISE EXCEPTION 'Pharmacist review evidence is required'; END IF;
  IF NEW.med_snapshot_json IS NULL OR jsonb_typeof(NEW.med_snapshot_json->'medications') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'A medication reconciliation snapshot is required'; END IF;
  IF jsonb_array_length(NEW.med_snapshot_json->'medications')=0 AND NOT coalesce((NEW.med_snapshot_json->>'no_medications_confirmed')::boolean,false) THEN RAISE EXCEPTION 'Confirm that there are no medications to reconcile'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.med_snapshot_json->'medications') m WHERE coalesce(m->>'decision','') NOT IN('continue','change','stop') OR nullif(trim(m->>'plan'),'') IS NULL) THEN RAISE EXCEPTION 'Every medication requires a decision and transition instructions'; END IF;
 END IF;
 RETURN NEW;
END $$;

-- Rollback: restore require_complete_discharge_reconciliation() from migration 321
-- in a new forward migration only. This reopens the evidence-erasure defect.
