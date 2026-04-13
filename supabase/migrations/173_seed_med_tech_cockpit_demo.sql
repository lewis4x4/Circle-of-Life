-- Migration 173: Seed realistic demo data for the Med-Tech Shift Cockpit
--
-- Creates an active shift for Maria Ochoa (med_tech) at Oakridge ALF,
-- assigns 7 active residents, seeds med passes from existing medications,
-- populates shift tape events, and creates one pre-pass hold (BP scenario).
--
-- Uses CURRENT_DATE for shift window so demo is always "today".

DO $$
DECLARE
  org  uuid := '00000000-0000-0000-0000-000000000001';
  fac  uuid := '00000000-0000-0000-0002-000000000001';
  mt   uuid := 'a0000000-0000-0000-0000-000000000012'; -- Maria Ochoa, med_tech
  nurse_id uuid := 'a0000000-0000-0000-0000-000000000003'; -- Sarah Williams, nurse
  sid  uuid := 'e0000000-0000-0000-0000-000000000001'; -- shift ID
  ts   timestamptz := now();
  today date := CURRENT_DATE;
BEGIN

  -- ============================================================
  -- 1. ACTIVE SHIFT for Maria Ochoa — AM shift 07:00–15:00
  -- ============================================================
  INSERT INTO med_tech_shifts (
    id, organization_id, facility_id, user_id,
    shift_start, shift_end, clocked_in_at, device_id, status,
    created_at, updated_at, created_by
  ) VALUES (
    sid, org, fac, mt,
    (today + '07:00'::time) AT TIME ZONE 'America/New_York',
    (today + '15:00'::time) AT TIME ZONE 'America/New_York',
    (today + '07:02'::time) AT TIME ZONE 'America/New_York',
    'Cart-07 · Tablet-A',
    'active',
    ts, ts, mt
  ) ON CONFLICT (id) DO UPDATE SET
    status = 'active',
    clocked_in_at = EXCLUDED.clocked_in_at,
    updated_at = now();

  -- ============================================================
  -- 2. SHIFT RESIDENTS — 7 active residents at Oakridge
  -- ============================================================
  INSERT INTO med_tech_shift_residents (id, shift_id, resident_id, organization_id, facility_id, priority) VALUES
    ('e1000000-0000-0000-0000-000000000001', sid, 'c0000000-0000-0000-0000-000000000001', org, fac, 1),  -- Margaret Sullivan
    ('e1000000-0000-0000-0000-000000000002', sid, 'c0000000-0000-0000-0000-000000000002', org, fac, 2),  -- Harold Chen
    ('e1000000-0000-0000-0000-000000000003', sid, 'c0000000-0000-0000-0000-000000000003', org, fac, 3),  -- Dorothy Williams
    ('e1000000-0000-0000-0000-000000000004', sid, 'c0000000-0000-0000-0000-000000000004', org, fac, 4),  -- Arthur Pennington
    ('e1000000-0000-0000-0000-000000000005', sid, 'c0000000-0000-0000-0000-000000000005', org, fac, 5),  -- Ruth Anderson
    ('e1000000-0000-0000-0000-000000000006', sid, 'c0000000-0000-0000-0000-000000000006', org, fac, 6),  -- Frank Martinez
    ('e1000000-0000-0000-0000-000000000007', sid, 'c0000000-0000-0000-0000-000000000007', org, fac, 7)   -- Virginia Taylor
  ON CONFLICT (shift_id, resident_id) DO NOTHING;

  -- ============================================================
  -- 3. MED PASSES — real medications, various statuses
  -- ============================================================

  -- Sullivan: Lisinopril 10mg @ 08:00 — OVERDUE (given late scenario)
  INSERT INTO med_passes (
    id, organization_id, facility_id, shift_id, resident_id,
    resident_medication_id, scheduled_time, status,
    controlled_substance, witness_required, administered_by
  ) VALUES (
    'e2000000-0000-0000-0000-000000000001', org, fac, sid,
    'c0000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000003', -- Lisinopril
    (today + '08:00'::time) AT TIME ZONE 'America/New_York',
    'overdue', false, false, mt
  ) ON CONFLICT (id) DO NOTHING;

  -- Sullivan: Metformin 500mg @ 08:00 — GIVEN (completed earlier)
  INSERT INTO med_passes (
    id, organization_id, facility_id, shift_id, resident_id,
    resident_medication_id, scheduled_time, administered_time, status,
    controlled_substance, witness_required, administered_by,
    barcode_scan_verified, wristband_scan_verified
  ) VALUES (
    'e2000000-0000-0000-0000-000000000002', org, fac, sid,
    'c0000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000002', -- Metformin
    (today + '08:00'::time) AT TIME ZONE 'America/New_York',
    (today + '08:05'::time) AT TIME ZONE 'America/New_York',
    'given', false, false, mt, true, true
  ) ON CONFLICT (id) DO NOTHING;

  -- Chen: Spiriva @ 08:00 — DUE NOW
  INSERT INTO med_passes (
    id, organization_id, facility_id, shift_id, resident_id,
    resident_medication_id, scheduled_time, status,
    controlled_substance, witness_required, administered_by
  ) VALUES (
    'e2000000-0000-0000-0000-000000000003', org, fac, sid,
    'c0000000-0000-0000-0000-000000000002',
    '70000000-0000-0000-0000-000000000004', -- Spiriva
    (today + '09:00'::time) AT TIME ZONE 'America/New_York',
    'pending', false, false, mt
  ) ON CONFLICT (id) DO NOTHING;

  -- Chen: Eliquis 5mg @ 08:00 — HOLD (low BP scenario)
  INSERT INTO med_passes (
    id, organization_id, facility_id, shift_id, resident_id,
    resident_medication_id, scheduled_time, status,
    hold_reason,
    controlled_substance, witness_required, administered_by
  ) VALUES (
    'e2000000-0000-0000-0000-000000000004', org, fac, sid,
    'c0000000-0000-0000-0000-000000000002',
    '70000000-0000-0000-0000-000000000005', -- Eliquis
    (today + '08:00'::time) AT TIME ZONE 'America/New_York',
    'held',
    'BP 88/52 at 07:45 · Nurse paged',
    false, false, mt
  ) ON CONFLICT (id) DO NOTHING;

  -- Anderson: Sinemet @ 07:00 — GIVEN (first dose, completed)
  INSERT INTO med_passes (
    id, organization_id, facility_id, shift_id, resident_id,
    resident_medication_id, scheduled_time, administered_time, status,
    controlled_substance, witness_required, administered_by,
    barcode_scan_verified, wristband_scan_verified
  ) VALUES (
    'e2000000-0000-0000-0000-000000000005', org, fac, sid,
    'c0000000-0000-0000-0000-000000000005',
    '70000000-0000-0000-0000-000000000006', -- Sinemet
    (today + '07:00'::time) AT TIME ZONE 'America/New_York',
    (today + '07:08'::time) AT TIME ZONE 'America/New_York',
    'given', false, false, mt, true, true
  ) ON CONFLICT (id) DO NOTHING;

  -- Anderson: Sinemet @ 13:00 — UPCOMING
  INSERT INTO med_passes (
    id, organization_id, facility_id, shift_id, resident_id,
    resident_medication_id, scheduled_time, status,
    controlled_substance, witness_required, administered_by
  ) VALUES (
    'e2000000-0000-0000-0000-000000000006', org, fac, sid,
    'c0000000-0000-0000-0000-000000000005',
    '70000000-0000-0000-0000-000000000006', -- Sinemet
    (today + '13:00'::time) AT TIME ZONE 'America/New_York',
    'pending', false, false, mt
  ) ON CONFLICT (id) DO NOTHING;

  -- Taylor: Lasix 40mg @ 08:00 — GIVEN
  INSERT INTO med_passes (
    id, organization_id, facility_id, shift_id, resident_id,
    resident_medication_id, scheduled_time, administered_time, status,
    controlled_substance, witness_required, administered_by,
    barcode_scan_verified, wristband_scan_verified
  ) VALUES (
    'e2000000-0000-0000-0000-000000000007', org, fac, sid,
    'c0000000-0000-0000-0000-000000000007',
    '70000000-0000-0000-0000-000000000007', -- Lasix
    (today + '08:00'::time) AT TIME ZONE 'America/New_York',
    (today + '08:12'::time) AT TIME ZONE 'America/New_York',
    'given', false, false, mt, true, true
  ) ON CONFLICT (id) DO NOTHING;

  -- Taylor: Coreg 12.5mg @ 08:00 — GIVEN
  INSERT INTO med_passes (
    id, organization_id, facility_id, shift_id, resident_id,
    resident_medication_id, scheduled_time, administered_time, status,
    controlled_substance, witness_required, administered_by,
    barcode_scan_verified, wristband_scan_verified
  ) VALUES (
    'e2000000-0000-0000-0000-000000000008', org, fac, sid,
    'c0000000-0000-0000-0000-000000000007',
    '70000000-0000-0000-0000-000000000008', -- Coreg
    (today + '08:00'::time) AT TIME ZONE 'America/New_York',
    (today + '08:14'::time) AT TIME ZONE 'America/New_York',
    'given', false, false, mt, true, true
  ) ON CONFLICT (id) DO NOTHING;

  -- Pennington: Lisinopril (hypothetical — using Sullivan's med ID for demo)
  -- In production would have own medication record — skip for now

  -- ============================================================
  -- 4. PRE-PASS HOLD — Chen, Eliquis held for low BP
  -- ============================================================
  INSERT INTO pre_pass_holds (
    id, organization_id, facility_id, resident_id,
    resident_medication_id, hold_type, reason, triggered_by, source_ref, active
  ) VALUES (
    'e3000000-0000-0000-0000-000000000001', org, fac,
    'c0000000-0000-0000-0000-000000000002', -- Harold Chen
    '70000000-0000-0000-0000-000000000005', -- Eliquis
    'vitals_ooR',
    'BP 88/52 recorded at 07:45. Below threshold for anticoagulant.',
    'pre-pass-sweep',
    '{"vital_type":"bp_systolic","value":88,"threshold":90,"daily_log_id":"80000000-0000-0000-0000-000000000002"}'::jsonb,
    true
  ) ON CONFLICT (id) DO NOTHING;

  -- ============================================================
  -- 5. SHIFT TAPE EVENTS — realistic timeline
  -- ============================================================
  INSERT INTO shift_tape_events (id, organization_id, facility_id, shift_id, resident_id, event_type, summary, occurred_at) VALUES
    ('e4000000-0000-0000-0000-000000000001', org, fac, sid, NULL,
     'shift_clock_in', 'Clocked in · 7 residents assigned',
     (today + '07:02'::time) AT TIME ZONE 'America/New_York'),

    ('e4000000-0000-0000-0000-000000000002', org, fac, sid, 'c0000000-0000-0000-0000-000000000005',
     'med_pass_given', 'Anderson, R. · Sinemet 25/100mg · given',
     (today + '07:08'::time) AT TIME ZONE 'America/New_York'),

    ('e4000000-0000-0000-0000-000000000003', org, fac, sid, 'c0000000-0000-0000-0000-000000000002',
     'vitals_flagged', 'Chen, H. · BP 88/52 · flagged',
     (today + '07:45'::time) AT TIME ZONE 'America/New_York'),

    ('e4000000-0000-0000-0000-000000000004', org, fac, sid, 'c0000000-0000-0000-0000-000000000002',
     'hold_placed', 'Hold placed · Chen, H. · Eliquis · low BP',
     (today + '07:46'::time) AT TIME ZONE 'America/New_York'),

    ('e4000000-0000-0000-0000-000000000005', org, fac, sid, 'c0000000-0000-0000-0000-000000000002',
     'nurse_paged', 'Nurse paged · Chen, H. · low BP',
     (today + '07:47'::time) AT TIME ZONE 'America/New_York'),

    ('e4000000-0000-0000-0000-000000000006', org, fac, sid, 'c0000000-0000-0000-0000-000000000001',
     'med_pass_given', 'Sullivan, M. · Metformin 500mg · given',
     (today + '08:05'::time) AT TIME ZONE 'America/New_York'),

    ('e4000000-0000-0000-0000-000000000007', org, fac, sid, 'c0000000-0000-0000-0000-000000000007',
     'med_pass_given', 'Taylor, V. · Lasix 40mg · given',
     (today + '08:12'::time) AT TIME ZONE 'America/New_York'),

    ('e4000000-0000-0000-0000-000000000008', org, fac, sid, 'c0000000-0000-0000-0000-000000000007',
     'med_pass_given', 'Taylor, V. · Coreg 12.5mg · given',
     (today + '08:14'::time) AT TIME ZONE 'America/New_York'),

    ('e4000000-0000-0000-0000-000000000009', org, fac, sid, 'c0000000-0000-0000-0000-000000000001',
     'med_pass_overdue', 'Sullivan, M. · Lisinopril 10mg · OVERDUE',
     (today + '09:00'::time) AT TIME ZONE 'America/New_York')
  ON CONFLICT (id) DO NOTHING;

END $$;
