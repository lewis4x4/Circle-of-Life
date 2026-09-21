-- COL-367: a bed's status follows who actually holds it.
-- Local disposable replay only: every fixture rolls back.
BEGIN;

CREATE TEMP TABLE bo AS SELECT
  gen_random_uuid() org, gen_random_uuid() ent, gen_random_uuid() fac,
  gen_random_uuid() room, gen_random_uuid() bed_a, gen_random_uuid() bed_b,
  gen_random_uuid() bed_hold, gen_random_uuid() bed_maint,
  gen_random_uuid() res;

INSERT INTO organizations(id,name) SELECT org,'Bed occupancy review' FROM bo;
INSERT INTO entities(id,organization_id,name) SELECT ent,org,'Review Entity' FROM bo;
INSERT INTO facilities(id,entity_id,organization_id,name,address_line_1,city,zip,total_licensed_beds)
  SELECT fac,ent,org,'Review Facility','1 Way','Town','00000',4 FROM bo;
INSERT INTO rooms(id,facility_id,organization_id,room_number) SELECT room,fac,org,'101' FROM bo;
INSERT INTO beds(id,room_id,facility_id,organization_id,bed_label,status)
  SELECT bed_a,room,fac,org,'A','available'::bed_status FROM bo
  UNION ALL SELECT bed_b,room,fac,org,'B','available'::bed_status FROM bo
  UNION ALL SELECT bed_hold,room,fac,org,'H','hold'::bed_status FROM bo
  UNION ALL SELECT bed_maint,room,fac,org,'M','maintenance'::bed_status FROM bo;

-- Admitting someone claims the bed.
INSERT INTO residents(id,facility_id,organization_id,first_name,last_name,gender,status,bed_id)
  SELECT res,fac,org,'Review','Resident','prefer_not_to_say'::gender,'active'::resident_status,bed_a FROM bo;
DO $$ BEGIN
  IF (SELECT status FROM beds WHERE id=(SELECT bed_a FROM bo)) <> 'occupied'::bed_status THEN
    RAISE EXCEPTION 'admitting a resident did not occupy the bed'; END IF;
END $$;

-- Temporarily out is still their bed: hospital_hold and loa must not release it.
UPDATE residents SET status='hospital_hold'::resident_status WHERE id=(SELECT res FROM bo);
DO $$ BEGIN
  IF (SELECT status FROM beds WHERE id=(SELECT bed_a FROM bo)) <> 'occupied'::bed_status THEN
    RAISE EXCEPTION 'hospital_hold released a bed the resident is coming back to'; END IF;
END $$;
UPDATE residents SET status='loa'::resident_status WHERE id=(SELECT res FROM bo);
DO $$ BEGIN
  IF (SELECT status FROM beds WHERE id=(SELECT bed_a FROM bo)) <> 'occupied'::bed_status THEN
    RAISE EXCEPTION 'loa released a bed the resident is coming back to'; END IF;
END $$;

-- Moving rooms frees the old bed and claims the new one.
UPDATE residents SET status='active'::resident_status, bed_id=(SELECT bed_b FROM bo) WHERE id=(SELECT res FROM bo);
DO $$ BEGIN
  IF (SELECT status FROM beds WHERE id=(SELECT bed_a FROM bo)) <> 'available'::bed_status THEN
    RAISE EXCEPTION 'moving out did not free the old bed'; END IF;
  IF (SELECT status FROM beds WHERE id=(SELECT bed_b FROM bo)) <> 'occupied'::bed_status THEN
    RAISE EXCEPTION 'moving in did not claim the new bed'; END IF;
END $$;

-- The original defect: discharge left the bed occupied with nobody in it.
UPDATE residents SET status='discharged'::resident_status, bed_id=NULL WHERE id=(SELECT res FROM bo);
DO $$ BEGIN
  IF (SELECT status FROM beds WHERE id=(SELECT bed_b FROM bo)) <> 'available'::bed_status THEN
    RAISE EXCEPTION 'discharge left the bed occupied'; END IF;
END $$;

-- Deceased releases the bed too.
UPDATE residents SET status='active'::resident_status, bed_id=(SELECT bed_a FROM bo) WHERE id=(SELECT res FROM bo);
UPDATE residents SET status='deceased'::resident_status WHERE id=(SELECT res FROM bo);
DO $$ BEGIN
  IF (SELECT status FROM beds WHERE id=(SELECT bed_a FROM bo)) <> 'available'::bed_status THEN
    RAISE EXCEPTION 'deceased left the bed occupied'; END IF;
END $$;

-- Soft-deleting a resident frees their bed.
UPDATE residents SET status='active'::resident_status, bed_id=(SELECT bed_a FROM bo) WHERE id=(SELECT res FROM bo);
UPDATE residents SET deleted_at=now() WHERE id=(SELECT res FROM bo);
DO $$ BEGIN
  IF (SELECT status FROM beds WHERE id=(SELECT bed_a FROM bo)) <> 'available'::bed_status THEN
    RAISE EXCEPTION 'soft-deleting a resident left the bed occupied'; END IF;
END $$;

-- Deliberate operational states are decisions, not occupancy, and survive.
DO $$ BEGIN
  IF (SELECT status FROM beds WHERE id=(SELECT bed_hold FROM bo)) <> 'hold'::bed_status THEN
    RAISE EXCEPTION 'a deliberate hold was overwritten'; END IF;
  IF (SELECT status FROM beds WHERE id=(SELECT bed_maint FROM bo)) <> 'maintenance'::bed_status THEN
    RAISE EXCEPTION 'a maintenance bed was overwritten'; END IF;
END $$;

-- New assignments to maintenance are rejected; a subsequent operational
-- decision on an occupied bed is preserved when its resident leaves.
DO $$ BEGIN
  BEGIN
    UPDATE residents SET deleted_at=NULL, status='active', bed_id=(SELECT bed_maint FROM bo) WHERE id=(SELECT res FROM bo);
    RAISE EXCEPTION 'maintenance assignment unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
UPDATE residents SET deleted_at=NULL,status='active',bed_id=(SELECT bed_a FROM bo) WHERE id=(SELECT res FROM bo);
UPDATE beds SET status='maintenance' WHERE id=(SELECT bed_a FROM bo);
UPDATE residents SET status='discharged',bed_id=NULL WHERE id=(SELECT res FROM bo);
DO $$ BEGIN
  IF (SELECT status FROM beds WHERE id=(SELECT bed_a FROM bo)) <> 'maintenance'::bed_status
    OR (SELECT current_resident_id FROM beds WHERE id=(SELECT bed_a FROM bo)) IS NOT NULL THEN
    RAISE EXCEPTION 'releasing a resident lost maintenance state or retained its pointer'; END IF;
END $$;

UPDATE residents SET status='active',bed_id=(SELECT bed_b FROM bo) WHERE id=(SELECT res FROM bo);
UPDATE beds SET status='offline' WHERE id=(SELECT bed_b FROM bo);
UPDATE residents SET status='discharged',bed_id=NULL WHERE id=(SELECT res FROM bo);
DO $$ BEGIN
  IF (SELECT status FROM beds WHERE id=(SELECT bed_b FROM bo)) <> 'offline'::bed_status
    OR (SELECT current_resident_id FROM beds WHERE id=(SELECT bed_b FROM bo)) IS NOT NULL THEN
    RAISE EXCEPTION 'releasing a resident lost offline state or retained its pointer'; END IF;
END $$;

-- No bed anywhere is left occupied with nobody holding it.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM beds b WHERE b.deleted_at IS NULL AND b.status='occupied'
      AND NOT EXISTS (SELECT 1 FROM residents r WHERE r.bed_id=b.id AND r.deleted_at IS NULL
                        AND haven.resident_status_holds_bed(r.status))
  ) THEN RAISE EXCEPTION 'an occupied bed has nobody in it'; END IF;
END $$;

ROLLBACK;
