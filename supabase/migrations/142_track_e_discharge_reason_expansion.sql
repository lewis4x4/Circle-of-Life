-- Track E — E8: Discharge reason enum parity with handoff DischargeType

ALTER TYPE discharge_reason
ADD VALUE 'resident_voluntary';

ALTER TYPE discharge_reason
ADD VALUE 'facility_with_cause';

ALTER TYPE discharge_reason
ADD VALUE 'facility_immediate';

ALTER TYPE discharge_reason
ADD VALUE 'medicaid_relocation';
