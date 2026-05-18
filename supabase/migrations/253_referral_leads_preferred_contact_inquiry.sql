-- Referral leads: preferred contact channel + inquiry date (new-lead form)

CREATE TYPE referral_lead_preferred_contact AS ENUM ('phone', 'email', 'either');

ALTER TABLE referral_leads
  ADD COLUMN preferred_contact referral_lead_preferred_contact NOT NULL DEFAULT 'either';

ALTER TABLE referral_leads
  ADD COLUMN inquiry_date date;

UPDATE referral_leads
SET
  inquiry_date = (created_at AT TIME ZONE 'America/New_York')::date
WHERE
  inquiry_date IS NULL;

ALTER TABLE referral_leads
  ALTER COLUMN inquiry_date SET NOT NULL;

ALTER TABLE referral_leads
  ALTER COLUMN inquiry_date SET DEFAULT ((now() AT TIME ZONE 'America/New_York'))::date;

COMMENT ON COLUMN referral_leads.preferred_contact IS 'Lead preferred outreach channel.';
COMMENT ON COLUMN referral_leads.inquiry_date IS 'Date of inquiry (operator timezone context; default Eastern for COL).';
