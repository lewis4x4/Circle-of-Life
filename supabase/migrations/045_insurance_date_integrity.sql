-- Module 18 follow-up: date range integrity (prevents inverted periods at rest)

ALTER TABLE insurance_policies
  ADD CONSTRAINT insurance_policies_dates_chk CHECK (expiration_date >= effective_date);

ALTER TABLE certificates_of_insurance
  ADD CONSTRAINT certificates_of_insurance_dates_chk CHECK (expiration_date >= effective_date);

ALTER TABLE renewal_data_packages
  ADD CONSTRAINT renewal_data_packages_period_chk CHECK (period_end >= period_start);

ALTER TABLE premium_allocations
  ADD CONSTRAINT premium_allocations_period_chk CHECK (period_end >= period_start);

ALTER TABLE loss_runs
  ADD CONSTRAINT loss_runs_period_chk CHECK (period_end >= period_start);

ALTER TABLE insurance_renewals
  ADD CONSTRAINT insurance_renewals_modified_duty_chk CHECK (
    modified_duty_start IS NULL
    OR modified_duty_end IS NULL
    OR modified_duty_end >= modified_duty_start
  );
