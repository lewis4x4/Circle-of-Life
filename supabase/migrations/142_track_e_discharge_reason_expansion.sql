-- Track E — E8: Discharge reason enum parity with handoff DischargeType

ALTER TYPE discharge_reason ADD VALUE IF NOT EXISTS 'resident_voluntary';
ALTER TYPE discharge_reason ADD VALUE IF NOT EXISTS 'facility_with_cause';
ALTER TYPE discharge_reason ADD VALUE IF NOT EXISTS 'facility_immediate';
ALTER TYPE discharge_reason ADD VALUE IF NOT EXISTS 'medicaid_relocation';
