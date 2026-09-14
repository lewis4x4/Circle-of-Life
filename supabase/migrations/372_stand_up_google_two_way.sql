-- Make the hosted Google bridge bidirectional without weakening its three-way
-- conflict boundary. Pending writes are durable before Drive is called and a
-- baseline advances only after exact provider readback.
BEGIN;

CREATE TABLE haven.stand_up_google_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  workbook_id text NOT NULL CHECK (length(workbook_id) BETWEEN 10 AND 256 AND workbook_id !~ '[[:space:]]'),
  week_start date NOT NULL CHECK (extract(isodow FROM week_start)=1),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','completed','abandoned')),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_drive_metadata jsonb NOT NULL,
  items jsonb NOT NULL CHECK (jsonb_typeof(items)='array' AND jsonb_array_length(items) BETWEEN 1 AND 5),
  output_sha256 text CHECK (output_sha256 IS NULL OR output_sha256 ~ '^[0-9a-f]{64}$'),
  output_drive_metadata jsonb,
  abandon_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CHECK ((state='completed')=(completed_at IS NOT NULL)),
  CHECK ((state='completed')=(output_sha256 IS NOT NULL)),
  CHECK ((state='completed')=(output_drive_metadata IS NOT NULL)),
  CHECK (state<>'abandoned' OR abandon_reason IS NOT NULL)
);
CREATE UNIQUE INDEX stand_up_google_one_pending_export
  ON haven.stand_up_google_exports(organization_id,workbook_id,week_start)
  WHERE state='pending';
ALTER TABLE haven.stand_up_google_exports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE haven.stand_up_google_exports FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.stand_up_google_export_bridge(p_action text,p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  s haven.stand_up_google_state%ROWTYPE;
  pending haven.stand_up_google_exports%ROWTYPE;
  baseline haven.stand_up_google_baselines%ROWTYPE;
  report public.stand_up_reports%ROWTYPE;
  org uuid; workbook text; week date; source_hash text; output_hash text;
  drive jsonb; output_drive jsonb; records jsonb; observed timestamptz;
  mapping jsonb; row jsonb; item jsonb; items jsonb:='[]'::jsonb;
  incoming jsonb; empty_values jsonb; facility uuid; run_id uuid;
  google_changed boolean:=false; matches_pending boolean:=true;
BEGIN
  IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role'
     OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Stand Up Google export access denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT s FROM haven.stand_up_google_state WHERE singleton FOR UPDATE;
  org:=s.organization_id;
  workbook:=p_payload->>'workbook_id';
  week:=(p_payload->>'week_start')::date;
  IF NOT s.enabled THEN RETURN jsonb_build_object('state','disabled','generation',s.generation); END IF;
  IF workbook IS NULL OR workbook IS DISTINCT FROM s.workbook_id
     OR week IS DISTINCT FROM haven.stand_up_week() THEN
    RAISE EXCEPTION 'Stand Up Google export scope denied' USING ERRCODE='42501';
  END IF;
  mapping:=haven.stand_up_exact_facility_map(org);
  empty_values:=(SELECT jsonb_object_agg(k,'null'::jsonb) FROM unnest(haven.stand_up_keys()) k);

  IF p_action='abandon_export' THEN
    SELECT * INTO pending FROM haven.stand_up_google_exports
      WHERE id=(p_payload->>'export_id')::uuid AND organization_id=org
        AND workbook_id=workbook AND week_start=week FOR UPDATE;
    IF pending.id IS NULL OR pending.state<>'pending'
       OR p_payload->>'reason' NOT IN ('provider_rejected','provider_content_changed','readback_mismatch') THEN
      RAISE EXCEPTION 'Invalid Stand Up Google export abandonment';
    END IF;
    UPDATE haven.stand_up_google_exports SET state='abandoned',abandon_reason=p_payload->>'reason'
      WHERE id=pending.id;
    RETURN jsonb_build_object('state','abandoned','export_id',pending.id);
  END IF;
  IF p_action<>'prepare_export' THEN
    RAISE EXCEPTION 'Unsupported Stand Up Google export action';
  END IF;

  source_hash:=p_payload->>'source_sha256';
  drive:=p_payload->'drive';
  records:=p_payload->'records';
  observed:=(p_payload->>'observed_at')::timestamptz;
  IF source_hash !~ '^[0-9a-f]{64}$' OR jsonb_typeof(drive) IS DISTINCT FROM 'object'
     OR jsonb_typeof(records) IS DISTINCT FROM 'array' OR observed IS NULL
     OR observed>clock_timestamp()+interval '5 minutes'
     OR drive->>'etag' !~ '^"[^"]+"$' OR drive->>'version' !~ '^[0-9]+$'
     OR drive->>'md5_checksum' !~ '^[0-9a-f]{32}$'
     OR (drive->>'file_size')::bigint NOT BETWEEN 1 AND 20971520
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(records) x
       WHERE (x->>'facility_id')::uuid NOT IN (SELECT (value#>>'{}')::uuid FROM jsonb_each(mapping))
          OR x->>'week_start' IS DISTINCT FROM week::text)
     OR (SELECT count(DISTINCT x->>'facility_id') FROM jsonb_array_elements(records) x)
        <>(SELECT count(*) FROM jsonb_array_elements(records)) THEN
    RAISE EXCEPTION 'Invalid Stand Up Google export snapshot';
  END IF;

  SELECT * INTO pending FROM haven.stand_up_google_exports
    WHERE organization_id=org AND workbook_id=workbook AND week_start=week AND state='pending'
    FOR UPDATE;
  IF pending.id IS NOT NULL THEN
    IF source_hash=pending.source_sha256 THEN
      RETURN jsonb_build_object('state','export_required','export_id',pending.id,'updates',
        (SELECT jsonb_object_agg((x->>'facility_id')||':'||week::text,x->'values') FROM jsonb_array_elements(pending.items) x));
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(pending.items) LOOP
      SELECT value INTO row FROM jsonb_array_elements(records) x(value)
        WHERE value->>'facility_id'=item->>'facility_id';
      incoming:=coalesce(row->'values',empty_values);
      IF incoming IS DISTINCT FROM item->'values' THEN matches_pending:=false; END IF;
    END LOOP;
    IF matches_pending THEN
      RETURN jsonb_build_object('state','export_applied','export_id',pending.id);
    END IF;
    UPDATE haven.stand_up_google_exports SET state='abandoned',abandon_reason='provider_content_changed'
      WHERE id=pending.id;
    RETURN jsonb_build_object('state','review_required','code','provider_content_changed');
  END IF;

  FOR facility IN SELECT (value#>>'{}')::uuid FROM jsonb_each(mapping) LOOP
    SELECT value INTO row FROM jsonb_array_elements(records) x(value)
      WHERE (value->>'facility_id')::uuid=facility;
    incoming:=coalesce(row->'values',empty_values);
    PERFORM haven.stand_up_validate(incoming);
    SELECT * INTO baseline FROM haven.stand_up_google_baselines b
      WHERE b.organization_id=org AND b.facility_id=facility AND b.week_start=week FOR UPDATE;
    SELECT * INTO report FROM public.stand_up_reports r
      WHERE r.organization_id=org AND r.facility_id=facility AND r.week_start=week FOR UPDATE;
    IF baseline.facility_id IS NULL OR report.id IS NULL
       OR incoming IS DISTINCT FROM baseline.file_values THEN
      google_changed:=true;
    ELSIF report.revision_id IS DISTINCT FROM baseline.baseline_revision_id THEN
      PERFORM haven.stand_up_validate(report.values);
      items:=items||jsonb_build_array(jsonb_build_object(
        'facility_id',facility,'revision_id',report.revision_id,'values',report.values));
    END IF;
  END LOOP;
  IF google_changed OR jsonb_array_length(items)=0 THEN
    RETURN jsonb_build_object('state','no_export');
  END IF;
  INSERT INTO haven.stand_up_google_exports(
    organization_id,workbook_id,week_start,source_sha256,source_drive_metadata,items)
  VALUES(org,workbook,week,source_hash,drive,items) RETURNING * INTO pending;
  RETURN jsonb_build_object('state','export_required','export_id',pending.id,'updates',
    (SELECT jsonb_object_agg((x->>'facility_id')||':'||week::text,x->'values') FROM jsonb_array_elements(items) x));
END $$;

-- Completion is separate so a network timeout cannot advance a baseline.
CREATE FUNCTION public.stand_up_google_complete_export(p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  s haven.stand_up_google_state%ROWTYPE;
  pending haven.stand_up_google_exports%ROWTYPE;
  org uuid; workbook text; week date; output_hash text; output_drive jsonb;
  records jsonb; observed timestamptz; item jsonb; row jsonb; incoming jsonb;
  empty_values jsonb; run_id uuid;
BEGIN
  IF auth.jwt()->>'role' IS DISTINCT FROM 'service_role'
     OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Stand Up Google export completion denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO STRICT s FROM haven.stand_up_google_state WHERE singleton FOR UPDATE;
  org:=s.organization_id; workbook:=p_payload->>'workbook_id'; week:=(p_payload->>'week_start')::date;
  output_hash:=p_payload->>'source_sha256'; output_drive:=p_payload->'drive'; records:=p_payload->'records';
  observed:=(p_payload->>'observed_at')::timestamptz;
  IF NOT s.enabled OR workbook IS DISTINCT FROM s.workbook_id OR week IS DISTINCT FROM haven.stand_up_week()
     OR output_hash !~ '^[0-9a-f]{64}$' OR jsonb_typeof(output_drive) IS DISTINCT FROM 'object'
     OR jsonb_typeof(records) IS DISTINCT FROM 'array' OR observed IS NULL
     OR output_drive->>'etag' !~ '^"[^"]+"$' OR output_drive->>'version' !~ '^[0-9]+$'
     OR output_drive->>'md5_checksum' !~ '^[0-9a-f]{32}$'
     OR (output_drive->>'file_size')::bigint NOT BETWEEN 1 AND 20971520 THEN
    RAISE EXCEPTION 'Invalid Stand Up Google export completion';
  END IF;
  SELECT * INTO pending FROM haven.stand_up_google_exports
    WHERE id=(p_payload->>'export_id')::uuid AND organization_id=org
      AND workbook_id=workbook AND week_start=week FOR UPDATE;
  IF pending.id IS NULL THEN RAISE EXCEPTION 'Unknown Stand Up Google export'; END IF;
  IF pending.state='completed' THEN
    IF pending.output_sha256 IS DISTINCT FROM output_hash THEN
      RAISE EXCEPTION 'Stand Up Google export replay differs';
    END IF;
    RETURN jsonb_build_object('state','synchronized','export_id',pending.id,'replayed',true);
  END IF;
  IF pending.state<>'pending' THEN RAISE EXCEPTION 'Stand Up Google export is not pending'; END IF;
  empty_values:=(SELECT jsonb_object_agg(k,'null'::jsonb) FROM unnest(haven.stand_up_keys()) k);
  FOR item IN SELECT value FROM jsonb_array_elements(pending.items) LOOP
    SELECT value INTO row FROM jsonb_array_elements(records) x(value)
      WHERE value->>'facility_id'=item->>'facility_id';
    incoming:=coalesce(row->'values',empty_values);
    IF incoming IS DISTINCT FROM item->'values' THEN
      RAISE EXCEPTION 'Stand Up Google export readback differs';
    END IF;
    UPDATE haven.stand_up_google_baselines SET
      baseline_revision_id=(item->>'revision_id')::uuid,
      file_values=item->'values',source_sha256=output_hash,updated_at=clock_timestamp()
      WHERE organization_id=org AND facility_id=(item->>'facility_id')::uuid AND week_start=week;
    IF NOT FOUND THEN RAISE EXCEPTION 'Stand Up Google export baseline disappeared'; END IF;
  END LOOP;
  UPDATE haven.stand_up_google_baselines SET source_sha256=output_hash,updated_at=clock_timestamp()
    WHERE organization_id=org AND week_start=week;
  UPDATE haven.stand_up_google_exports SET state='completed',output_sha256=output_hash,
    output_drive_metadata=output_drive,completed_at=clock_timestamp() WHERE id=pending.id;
  INSERT INTO haven.stand_up_google_runs(
    organization_id,workbook_id,week_start,state,source_sha256,drive_metadata,detail,observed_at)
  VALUES(org,workbook,week,'synchronized',output_hash,output_drive,
    jsonb_build_object('direction','haven_to_google','export_id',pending.id,
      'facility_count',jsonb_array_length(pending.items)),observed) RETURNING id INTO run_id;
  UPDATE haven.stand_up_google_state SET last_snapshot_sha256=output_hash,last_drive_metadata=output_drive,
    last_completed_at=clock_timestamp(),last_outcome='synchronized',last_error_code=NULL,
    consecutive_failures=0,updated_at=clock_timestamp() WHERE singleton;
  RETURN jsonb_build_object('state','synchronized','run_id',run_id,'export_id',pending.id,'replayed',false);
END $$;

REVOKE ALL ON FUNCTION public.stand_up_google_export_bridge(text,jsonb),
  public.stand_up_google_complete_export(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.stand_up_google_export_bridge(text,jsonb),
  public.stand_up_google_complete_export(jsonb) TO service_role;

COMMIT;
