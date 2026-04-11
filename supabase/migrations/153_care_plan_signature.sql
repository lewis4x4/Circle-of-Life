-- Migration 130: Add signature_data column to care_plans for digital signature storage
-- This enables the "Review & Sign" workflow for care plan approval

-- Add signature_data column to store base64-encoded signature images
ALTER TABLE care_plans
ADD COLUMN IF NOT EXISTS signature_data text;

-- Add comment for documentation
COMMENT ON COLUMN care_plans.signature_data IS 'Base64-encoded PNG signature image captured during care plan approval';

-- The column is nullable to preserve existing records without signatures
-- It will be populated only when a care plan is approved via the digital signature workflow

-- No RLS changes needed - the existing policies on care_plans will cover this column
-- The column is read-only for most users (updated only via the approve API route)
