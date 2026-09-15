-- External PHI processing requires a recorded Business Associate Agreement.
--
-- Four paths read ai_invocation_policies.allow_phi before sending resident data
-- to an external model: the resident-intake parser, the AI tool router,
-- rounding insights, and the resident-assurance edge function. Each gates on
-- allow_phi alone, so the only thing between a chart and the provider is a
-- missing API key. This migration makes the data itself carry the gate: a row
-- may not allow PHI unless it records which BAA covers it, who verified it,
-- and when. Rows that allowed PHI without one are flipped to false — the
-- manual review path stays available; re-enable by recording the BAA.

-- tr_ai_invocation_policies_set_updated_at (068) runs haven_set_updated_at, which
-- assigns NEW.updated_by — a column this table never had, so every UPDATE has
-- raised 'record "new" has no field "updated_by"' since the table was created.
-- The column has to exist before the data change below can run.
ALTER TABLE public.ai_invocation_policies
  ADD COLUMN updated_by uuid REFERENCES auth.users (id),
  ADD COLUMN baa_reference text,
  ADD COLUMN baa_verified_at timestamptz,
  ADD COLUMN baa_verified_by uuid REFERENCES public.user_profiles (id);

COMMENT ON COLUMN public.ai_invocation_policies.baa_reference IS
  'Identifier of the executed Business Associate Agreement covering default_provider (document vault id, contract number, or filename). Required while allow_phi is true.';
COMMENT ON COLUMN public.ai_invocation_policies.baa_verified_at IS
  'When an authorized person confirmed the BAA is executed and in force. allow_phi cannot be true without it.';
COMMENT ON COLUMN public.ai_invocation_policies.baa_verified_by IS
  'user_profiles.id of the person who verified the BAA.';

UPDATE public.ai_invocation_policies
SET allow_phi = false,
    updated_at = now()
WHERE allow_phi = true
  AND baa_verified_at IS NULL;

ALTER TABLE public.ai_invocation_policies
  ADD CONSTRAINT ai_invocation_policies_phi_requires_baa CHECK (
    allow_phi = false
    OR (
      baa_verified_at IS NOT NULL
      AND baa_verified_by IS NOT NULL
      AND baa_reference IS NOT NULL
      AND length(btrim(baa_reference)) > 0
    )
  );

NOTIFY pgrst, 'reload schema';
