-- NAV-003/NAV-009: resident indexing follows the authoritative source immediately.
BEGIN;
CREATE OR REPLACE FUNCTION public.haven_search_refresh_resident()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.search_documents(organization_id,facility_id,source_table,source_id,search_tsv,label,deleted_at)
 VALUES(NEW.organization_id,NEW.facility_id,'residents',NEW.id,
  to_tsvector('english',coalesce(NEW.first_name,'')||' '||coalesce(NEW.last_name,'')||' '||coalesce(NEW.preferred_name,'')),
  NEW.last_name||', '||NEW.first_name,NEW.deleted_at)
 ON CONFLICT(source_table,source_id) DO UPDATE SET
  organization_id=EXCLUDED.organization_id,facility_id=EXCLUDED.facility_id,
  search_tsv=EXCLUDED.search_tsv,label=EXCLUDED.label,deleted_at=EXCLUDED.deleted_at,updated_at=now();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.haven_search_refresh_resident() FROM PUBLIC,anon,authenticated,service_role;

-- The index is not authorization authority. Recheck the resident's live row
-- through caller RLS, including family linkage, even if an external writer is stale.
ALTER POLICY search_documents_select ON public.search_documents USING(
 organization_id=(SELECT haven.organization_id()) AND deleted_at IS NULL
 AND (facility_id IS NULL OR facility_id IN(SELECT haven.accessible_facility_ids()))
 AND (source_table<>'residents' OR EXISTS(
  SELECT 1 FROM public.residents r WHERE r.id=search_documents.source_id
   AND r.organization_id=search_documents.organization_id
   AND r.facility_id=search_documents.facility_id AND r.deleted_at IS NULL
 ))
);

-- Reconcile existing stale rows and residents inserted before indexing existed.
-- Only the implemented resident source is rebuilt; other source rows are retained.
INSERT INTO public.search_documents(organization_id,facility_id,source_table,source_id,search_tsv,label,deleted_at)
SELECT r.organization_id,r.facility_id,'residents',r.id,
 to_tsvector('english',coalesce(r.first_name,'')||' '||coalesce(r.last_name,'')||' '||coalesce(r.preferred_name,'')),
 r.last_name||', '||r.first_name,r.deleted_at FROM public.residents r
ON CONFLICT(source_table,source_id) DO UPDATE SET
 organization_id=EXCLUDED.organization_id,facility_id=EXCLUDED.facility_id,
 search_tsv=EXCLUDED.search_tsv,label=EXCLUDED.label,deleted_at=EXCLUDED.deleted_at,updated_at=now()
WHERE (search_documents.organization_id,search_documents.facility_id,search_documents.search_tsv,search_documents.label,search_documents.deleted_at)
 IS DISTINCT FROM (EXCLUDED.organization_id,EXCLUDED.facility_id,EXCLUDED.search_tsv,EXCLUDED.label,EXCLUDED.deleted_at);
UPDATE public.search_documents d SET deleted_at=now(),updated_at=now()
WHERE d.source_table='residents' AND d.deleted_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM public.residents r WHERE r.id=d.source_id);
COMMIT;
-- Rollback requires a reviewed forward migration preserving current source checks.
-- Do not restore stale facility/organization upserts or remove repaired index rows.
