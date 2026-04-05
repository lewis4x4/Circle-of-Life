-- Phase 3.5-A: platform-search-index
-- Hybrid lexical search. Enable pgvector on Supabase project for embedding columns later (stock Postgres CI has no vector).

CREATE TABLE search_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  facility_id uuid REFERENCES facilities (id),
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  search_tsv tsvector,
  label text,
  updated_at timestamptz NOT NULL DEFAULT now (),
  deleted_at timestamptz,
  CONSTRAINT search_documents_source_unique UNIQUE (source_table, source_id)
);

CREATE INDEX idx_search_documents_tsv ON search_documents USING gin (search_tsv)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_search_documents_org ON search_documents (organization_id)
WHERE
  deleted_at IS NULL;

CREATE INDEX idx_search_documents_facility ON search_documents (facility_id)
WHERE
  deleted_at IS NULL;

ALTER TABLE search_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY search_documents_select ON search_documents
  FOR SELECT
  USING (
    organization_id = haven.organization_id ()
    AND deleted_at IS NULL
    AND (
      facility_id IS NULL
      OR facility_id IN (
        SELECT
          haven.accessible_facility_ids ())));

CREATE POLICY search_documents_service ON search_documents
  FOR ALL
  USING (FALSE);

-- Maintain from app/trigger jobs; service role bypasses RLS for batch refresh.
COMMENT ON TABLE search_documents IS 'Lexical index rows; optional pgvector on Supabase for embeddings.';

CREATE OR REPLACE FUNCTION public.haven_search_refresh_resident ()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $func$
BEGIN
  INSERT INTO search_documents (organization_id, facility_id, source_table, source_id, search_tsv, label, deleted_at)
    VALUES (NEW.organization_id, NEW.facility_id, 'residents', NEW.id, to_tsvector('english', coalesce(NEW.first_name, '') || ' ' || coalesce(NEW.last_name, '') || ' ' || coalesce(NEW.preferred_name, '')), NEW.last_name || ', ' || NEW.first_name, NEW.deleted_at)
  ON CONFLICT (source_table, source_id)
    DO UPDATE SET
      search_tsv = EXCLUDED.search_tsv,
      label = EXCLUDED.label,
      deleted_at = EXCLUDED.deleted_at,
      updated_at = now();
  RETURN NEW;
END;
$func$;

CREATE TRIGGER tr_residents_search_documents
  AFTER INSERT OR UPDATE OF first_name, last_name, preferred_name, deleted_at, facility_id, organization_id ON residents
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_search_refresh_resident ();
