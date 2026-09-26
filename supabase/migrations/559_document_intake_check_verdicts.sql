-- COL-771 (Jev full strength, Part 3): reviewers grade Jev at filing.
--
-- Each Jev check the current proposal flagged (source 'jev', result 'fail' or
-- 'unknown') gets a verdict from the reviewer: right, wrong or cant_tell. The
-- verdicts ride in p_destination.check_verdicts as {"<check_code>": verdict}
-- and are stored at document_intake_filings.reviewer_changes.checks, where the
-- Jev accuracy views read them. A verdict for a code that is not one of the
-- proposal's Jev checks, or any other value, is refused. When Jev ran, every
-- flagged check must have a verdict before the filing is reserved. Both
-- refusals happen before any write. The idempotency hash already covers
-- p_destination, so the verdicts are part of the request identity.
--
-- The body is 545's byte for byte apart from those additions; the proposal
-- is loaded right after the item lock instead of just before the changes
-- block (same row, same lock, no other effect).
BEGIN;

CREATE OR REPLACE FUNCTION public.document_intake_prepare_filing(p_item uuid, p_request_key uuid, p_expected_revision uuid, p_destination jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a jsonb := haven.document_intake_actor(); org uuid := (a->>'org')::uuid; me uuid := (a->>'id')::uuid; role text := a->>'role';
  h text := haven.document_intake_hash(jsonb_build_object('item', p_item, 'rev', p_expected_revision, 'destination', p_destination));
  prior jsonb; i public.document_intake_items; c public.document_intake_catalog; subject uuid; title text; f public.document_intake_filings;
  bucket text; path text; q public.employee_file_requirements; record_id uuid := gen_random_uuid(); ext text; p public.document_intake_proposals;
  changes jsonb := '{}'::jsonb; result jsonb;
  verdicts jsonb := p_destination->'check_verdicts'; jev_codes text[]; flagged text[];
BEGIN
  prior := haven.document_intake_replay(org, p_request_key, me, 'prepare_filing', h);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  i := haven.document_intake_lock_item(p_item, p_expected_revision);
  IF i.status NOT IN ('pending_review','held','needs_attention') THEN RAISE EXCEPTION 'This document is not waiting for review' USING ERRCODE = '55000'; END IF;
  IF i.verified_sha256 IS NULL THEN RAISE EXCEPTION 'The original has not been verified' USING ERRCODE = '55000'; END IF;
  IF i.claimed_by IS NOT NULL AND i.claimed_by <> me AND i.claim_expires_at > now() THEN
    RAISE EXCEPTION 'Someone else is reviewing this document' USING ERRCODE = '40001';
  END IF;
  -- 559: the reviewer's Right / Wrong / Can't tell on each flagged Jev check of the current proposal.
  SELECT * INTO p FROM public.document_intake_proposals WHERE id = i.current_proposal_id;
  IF verdicts IS NOT NULL AND jsonb_typeof(verdicts) <> 'object' THEN RAISE EXCEPTION 'Unknown check verdict' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(array_agg(x->>'code'), '{}'), coalesce(array_agg(x->>'code') FILTER (WHERE x->>'result' IN ('fail','unknown')), '{}')
    INTO jev_codes, flagged FROM jsonb_array_elements(coalesce(p.checks, '[]'::jsonb)) x WHERE x->>'source' = 'jev';
  IF EXISTS (SELECT 1 FROM jsonb_each(coalesce(verdicts, '{}'::jsonb)) v
    WHERE NOT (v.key = ANY (jev_codes)) OR jsonb_typeof(v.value) <> 'string' OR v.value #>> '{}' NOT IN ('right','wrong','cant_tell')) THEN
    RAISE EXCEPTION 'Unknown check verdict' USING ERRCODE = '22023';
  END IF;
  IF p.stage_status->'jev'->>'state' = 'ran' AND EXISTS (SELECT 1 FROM unnest(flagged) fc WHERE NOT coalesce(verdicts, '{}'::jsonb) ? fc) THEN
    RAISE EXCEPTION 'Tell us whether Jev was right on each flagged check' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.document_intake_catalog WHERE organization_id = org AND code = p_destination->>'catalog_code';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pick a document type' USING ERRCODE = '22023'; END IF;
  subject := CASE WHEN c.destination_kind = 'facility_document' THEN i.facility_id ELSE (p_destination->>'subject_id')::uuid END;
  IF subject IS NULL THEN RAISE EXCEPTION 'Pick who or what this document is about' USING ERRCODE = '22023'; END IF;
  PERFORM haven.document_intake_assert_destination(i, c, subject, role);
  title := btrim(coalesce(p_destination->>'title', i.display_title, ''));
  IF length(title) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Give the document a title' USING ERRCODE = '22023'; END IF;
  IF c.destination_kind = 'benefits_document' AND (i.verified_mime NOT IN ('application/pdf','image/jpeg','image/png') OR i.declared_size_bytes > 15728640) THEN
    RAISE EXCEPTION 'Medicaid case documents must be PDF, JPEG or PNG under 15 MB' USING ERRCODE = '22023';
  END IF;
  IF c.destination_kind = 'resident_document' AND i.verified_mime NOT IN ('application/pdf','image/jpeg','image/png') THEN
    RAISE EXCEPTION 'Resident documents must be PDF, JPEG or PNG' USING ERRCODE = '22023';
  END IF;
  IF c.destination_kind = 'employee_file' THEN
    q := haven.document_intake_employee_requirement(org, i.facility_id, c.destination_category, (p_destination->>'requirement_id')::uuid);
    IF q.id IS NULL THEN RAISE EXCEPTION 'No staff file requirement of this kind exists for the facility' USING ERRCODE = '22023'; END IF;
  END IF;
  ext := CASE i.verified_mime WHEN 'application/pdf' THEN 'pdf' WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png'
    WHEN 'image/webp' THEN 'webp' WHEN 'image/tiff' THEN 'tif' ELSE 'heic' END;
  CASE c.destination_kind
  WHEN 'resident_document' THEN bucket := 'resident-documents'; path := format('intake/%s/%s/%s.%s', i.facility_id, subject, record_id, ext);
  WHEN 'benefits_document' THEN bucket := 'benefits-documents'; path := format('%s/intake-%s.%s', subject, record_id, ext);
  WHEN 'employee_file' THEN bucket := CASE WHEN q.category = 'medical' THEN 'employee-medical' ELSE 'employee-personnel' END;
    path := format('%s/intake.%s', record_id, ext);
  WHEN 'facility_document' THEN bucket := 'facility-documents'; path := format('%s/%s/%s.%s', i.facility_id, record_id, 'intake', ext);
  END CASE;
  IF p.id IS NOT NULL THEN
    changes := jsonb_strip_nulls(jsonb_build_object(
      'catalog_code', CASE WHEN p.catalog_code IS DISTINCT FROM c.code THEN jsonb_build_object('proposed', p.catalog_code, 'chosen', c.code) END,
      'title', CASE WHEN p.suggested_title IS DISTINCT FROM title THEN jsonb_build_object('proposed', p.suggested_title, 'chosen', title) END,
      'subject', CASE WHEN p.proposed_candidate IS NULL OR (p.candidates->p.proposed_candidate->>'subject_id')::uuid IS DISTINCT FROM subject
        THEN jsonb_build_object('proposed', p.candidates->p.proposed_candidate->>'subject_id', 'chosen', subject) END));
  END IF;
  IF verdicts IS NOT NULL AND verdicts <> '{}'::jsonb THEN changes := changes || jsonb_build_object('checks', verdicts); END IF;
  BEGIN
    INSERT INTO public.document_intake_filings (id, organization_id, facility_id, item_id, proposal_id, request_key, catalog_code, destination_kind,
      destination_category, subject_id, title, document_date, expiration_date, target_bucket, target_path, reviewer_changes, approved_by, expected_item_revision)
    VALUES (record_id, org, i.facility_id, i.id, i.current_proposal_id, p_request_key, c.code, c.destination_kind,
      CASE WHEN c.destination_kind = 'employee_file' THEN q.id::text ELSE c.destination_category END, subject, title,
      (p_destination->>'document_date')::date, (p_destination->>'expiration_date')::date, bucket, path, changes, me, i.revision)
    RETURNING * INTO f;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Another filing of this document is already in progress' USING ERRCODE = '40001';
  END;
  UPDATE public.document_intake_items SET claimed_by = me, claim_expires_at = now() + interval '10 minutes' WHERE id = i.id;
  PERFORM haven.document_intake_event(i, 'filing_prepared', me, 'person', jsonb_build_object('filing_id', f.id, 'catalog_code', c.code, 'destination_kind', c.destination_kind));
  result := jsonb_build_object('filing_id', f.id, 'bucket', bucket, 'path', path, 'source_path', i.storage_path, 'sha256', i.verified_sha256, 'mime', i.verified_mime);
  RETURN haven.document_intake_remember(org, p_request_key, me, 'prepare_filing', h, result);
END $$;

COMMENT ON FUNCTION public.document_intake_prepare_filing(uuid,uuid,uuid,jsonb) IS 'COL-771. COL-37 ruling: definer required; checks catalog reviewer role and the destination domain authority (resident facility, benefits write grant, employee manager) before reserving one live filing per item. Refuses unknown check verdicts and, when Jev ran, a filing with any flagged Jev check left ungraded; stores the verdicts in reviewer_changes.checks.';

REVOKE ALL ON FUNCTION public.document_intake_prepare_filing(uuid,uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_intake_prepare_filing(uuid,uuid,uuid,jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
