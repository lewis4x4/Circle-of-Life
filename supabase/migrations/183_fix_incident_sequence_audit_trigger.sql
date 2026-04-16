-- incident_sequences is an internal allocator table without an `id` column.
-- The generic audit trigger assumes NEW.id / OLD.id, so incident number allocation
-- fails before caregiver or admin incident forms can insert the real incident row.

DROP TRIGGER IF EXISTS tr_incident_sequences_audit ON public.incident_sequences;
