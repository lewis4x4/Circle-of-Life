-- COL-391 (child of COL-37), pass 2: the referral family. Fifteen of the
-- remaining 44 signed-in-callable SECURITY DEFINER functions, one ruling each,
-- recorded as a COMMENT carrying the marker 'COL-37 ruling:' that section 7 of
-- supabase/tests/review_col37_security_advisor.sql looks for.
--
-- Thirteen keep their definer rights and two are incidental. The reason the
-- ratio runs the other way from pass 1 is that 379 (COL-328 / REF-01) made the
-- referral module RPC-only on purpose, and said so: it revoked direct table
-- access from `authenticated` and left the RLS policies standing behind the
-- missing grant as a second lock. Measured on production 2026-09-15:
--
--   referral_leads          authenticated holds column-level SELECT on 48
--                           columns and nothing else -- no INSERT, UPDATE or
--                           DELETE at all, and no SELECT on phone, email,
--                           notes, date_of_birth, external_reference,
--                           closure_note, competitor_chosen or
--                           satisfaction_rating.
--   referral_triage_inbox   REVOKE ALL FROM PUBLIC, anon, authenticated (379).
--   referral_episode_events no grant to any request role (380).
--   referral_people,        no grant to any request role (380).
--   referral_opportunities,
--   referral_contacts,
--   referral_person_contacts,
--   referral_contact_permissions,
--   referral_facility_considerations
--
-- That boundary is a *column* grant, which is the one thing row-level security
-- cannot express: RLS chooses rows, not columns. So the sensitive-field split
-- these RPCs implement -- returning phone/email/notes only when the caller has
-- haven.referral_capability('clinical_read') and the lead is clinical_precheck
-- -- is definer work by construction, not by accident. Every one of them checks
-- the caller itself first through haven.referral_capability(), which is granted
-- to authenticated and resolves through haven.current_authorized_actor().
--
-- Several also call haven helpers that authenticated deliberately cannot
-- execute -- haven.lock_referral_episode(), haven.activate_referral_command(),
-- haven.referral_empty_revision() -- so they would fail at the first statement
-- as invokers. Those are the "invoker wrappers" COL-18-BASELINE warns against
-- revoking on sight.

BEGIN;

-- ---------------------------------------------------------------------------
-- Incidental definers -> SECURITY INVOKER
-- ---------------------------------------------------------------------------
-- referral_sources is the one referral table 379 left writable: it holds
-- GRANT SELECT, INSERT, UPDATE ON public.referral_sources TO authenticated plus
-- the referral_sources_insert policy
--
--   organization_id = haven.organization_id()
--   AND haven.referral_capability('source_manage')
--   AND (facility_id IS NULL OR haven.has_facility_access(facility_id))
--
-- which is referral_source_create's own guard restated. The function is in fact
-- stricter -- it demands has_facility_access(p_facility_id) even when
-- p_facility_only is false and the row lands with facility_id NULL -- so every
-- call it admits, the policy admits too. RETURNING id is covered by
-- referral_sources_select, which asks for 'lead_read'; 'source_manage' is
-- owner/org_admin and both hold 'lead_read'. The BEFORE trigger
-- haven.guard_referral_source_authority() re-asserts organization, capability
-- and facility on the row itself and stamps created_by/updated_by; it is a
-- definer and fires on the table owner's authority either way, so switching the
-- caller changes nothing it sees. Net effect of this line: one more lock, the
-- same admitted set.
ALTER FUNCTION public.referral_source_create(uuid, text, text, boolean)
  SECURITY INVOKER;

-- referral_leads_authorized_export touches no table at all. It checks
-- haven.referral_capability('lead_export'), validates the page bounds, and
-- returns what public.referral_leads_authorized_read gives it -- and
-- authenticated may execute both of those. The definer bit was doing nothing.
ALTER FUNCTION public.referral_leads_authorized_export(
  uuid, referral_lead_status, integer, integer
) SECURITY INVOKER;

COMMENT ON FUNCTION public.referral_source_create(uuid, text, text, boolean) IS
  'Creates a referral source, organization-wide or facility-scoped. COL-37 ruling: incidental definer, switched to SECURITY INVOKER in 399 -- referral_sources is the one referral table 379 left granted to authenticated, and the referral_sources_insert policy restates this function''s own guard (organization, source_manage, facility access). The function is stricter than the policy, so the admitted set is unchanged. Keep it invoker.';

COMMENT ON FUNCTION public.referral_leads_authorized_export(uuid, referral_lead_status, integer, integer) IS
  'Bounded export projection over referral_leads_authorized_read, gated on the lead_export capability. COL-37 ruling: incidental definer, switched to SECURITY INVOKER in 399 -- it reads no table itself, and authenticated may execute both haven.referral_capability() and referral_leads_authorized_read(). Keep it invoker.';

-- ---------------------------------------------------------------------------
-- Definers that are doing authorization work RLS cannot
-- ---------------------------------------------------------------------------

-- The sensitive-column boundary. This is the projection 379 built the column
-- grants around, and the reason the grants are column-level in the first place.
COMMENT ON FUNCTION public.referral_leads_authorized_read(uuid, uuid, referral_lead_status, integer, integer) IS
  'Current-authority referral projection. Clinical and free-text fields are NULL unless the current role has clinical_read and the lead is clinical_precheck. COL-37 ruling: definer required -- it returns phone, email, notes, date_of_birth, external_reference, closure_note and competitor_chosen, and 379 revoked SELECT on exactly those columns from authenticated while leaving the other 48. A column grant is not something row-level security can express, so no policy can replace this. The body checks haven.referral_capability(''lead_read'') and haven.has_facility_access() itself.';

COMMENT ON FUNCTION public.referral_duplicate_candidates(uuid) IS
  'Lists possible duplicate leads for a clinical-precheck lead. COL-37 ruling: definer required -- every column it returns is one authenticated may select, but it matches on phone and date_of_birth, which 379 revoked. The predicate needs the columns, not the output. Gated on the duplicate_review capability, scoped to the caller''s organization and accessible facilities.';

COMMENT ON FUNCTION public.referral_triage_authorized_read(integer, integer) IS
  'Reads the referral triage inbox for the caller''s organization. COL-37 ruling: definer required -- 379 ran REVOKE ALL ON public.referral_triage_inbox FROM PUBLIC, anon, authenticated, so no request role can read the table by any path; the standing select policy is the second lock behind the missing grant. Gated on the triage_read capability, which is owner/org_admin only.';

COMMENT ON FUNCTION public.referral_triage_submit(text, text, text, text, text, timestamp with time zone) IS
  'Records an untriaged referral enquiry. COL-37 ruling: definer required -- referral_triage_inbox has no grant to any request role and carries no INSERT policy at all, so an invoker write has nothing to pass. Gated on the triage_submit capability; organization and created_by come from haven.organization_id() and haven.authorized_user_id(), never from the caller.';

COMMENT ON FUNCTION public.referral_episode_model_read(uuid) IS
  'Assembles the full referral episode read model. COL-37 ruling: definer required -- it reads referral_people, referral_contacts, referral_person_contacts, referral_contact_permissions and referral_facility_considerations, none of which 380 granted to any request role, plus the sensitive referral_leads columns 379 revoked. Gated on lead_read, with contact and clinical fields masked per capability inside the projection.';

COMMENT ON FUNCTION public.referral_episode_history_read(uuid, integer, integer) IS
  'Pages the referral episode event log. COL-37 ruling: definer required -- referral_episode_events has no grant to any request role (380). Gated on lead_read; each event''s details and source_reference are masked by clinical_read, duplicate_review, contact_read and source_manage, so the definer is what makes the per-field split possible.';

COMMENT ON FUNCTION public.referral_episode_capture(text, text, jsonb) IS
  'Captures a new referral episode, idempotent on the request key. COL-37 ruling: definer required -- authenticated holds no INSERT on referral_leads and no grant at all on referral_episode_events, referral_people, referral_opportunities or referral_facility_considerations, and the body calls haven helpers (referral_request_lock, write_referral_episode_event, lock_referral_actor_authority) that authenticated cannot execute. It checks haven.referral_capability(''lead_write'') and the facility itself before writing.';

COMMENT ON FUNCTION public.referral_episode_command(uuid, text, text, text, jsonb) IS
  'The referral episode command surface: assign, wait, review, close, merge, contact and interest transitions. COL-37 ruling: definer required -- it writes eight referral tables directly (referral_leads, referral_people, referral_opportunities, referral_contacts, referral_person_contacts, referral_contact_permissions, referral_facility_considerations, referral_identity_corrections) and the event log through haven.write_referral_episode_event(), and authenticated may write none of them or execute that helper. It re-checks haven.referral_capability() six times across the command set rather than once at the door, and allowlists the payload keys per command before anything is touched.';

COMMENT ON FUNCTION public.referral_episode_downstream_review(uuid) IS
  'Reports what a referral episode would disturb downstream before an identity merge. COL-37 ruling: definer required -- it calls haven.lock_referral_episode(), which authenticated cannot execute, and reads admission_cases, workflow_events and referral_hl7_inbound together. Gated on the duplicate_review capability.';

COMMENT ON FUNCTION public.referral_lead_create(uuid, text, text, uuid, text, text, referral_lead_preferred_contact, date) IS
  'Compatibility door: creates a lead through referral_episode_capture. COL-37 ruling: definer required -- it calls haven.activate_referral_command(), which authenticated cannot execute, and the capture it delegates to writes tables authenticated cannot write. Authority is checked inside referral_episode_capture, not here.';

COMMENT ON FUNCTION public.referral_lead_update(uuid, timestamp with time zone, jsonb) IS
  'Compatibility door: patches status and tour fields through referral_episode_command, with an updated_at precondition. COL-37 ruling: definer required -- it calls haven.lock_referral_episode() and haven.activate_referral_command(), neither of which authenticated can execute, and authenticated holds no UPDATE on referral_leads. The patch keys are allowlisted to status, tour_scheduled_for and tour_completed_at before the lock is taken.';

COMMENT ON FUNCTION public.referral_lead_create_from_hl7(uuid) IS
  'Creates a referral episode from a processed HL7 inbound row and links the two. COL-37 ruling: definer required -- it locks referral_hl7_inbound FOR UPDATE, calls haven.activate_referral_command(), and writes referral_leads, none of which authenticated may do. It checks haven.referral_capability(''lead_write'') both before and after taking the lock, so an authority that changes underneath the transaction is refused.';

COMMENT ON FUNCTION public.referral_episode_initial_revision() IS
  'Returns the sentinel revision an episode has before its first event: 64 zeroes. COL-37 ruling: definer required, narrowly -- it wraps haven.referral_empty_revision(), which authenticated cannot execute, so as an invoker it would raise permission denied. It takes no arguments, reads nothing, and returns a constant, so the grant discloses nothing. This is the invoker-wrapper case COL-18-BASELINE warns against revoking on sight; revoke it only together with the callers that need the sentinel.';

-- Two functions changed security mode and fifteen changed comments, so
-- PostgREST's cached view of the API is stale.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- Rollback must be a separately reviewed forward migration. Restoring SECURITY
-- DEFINER on referral_source_create or referral_leads_authorized_export needs a
-- reason recorded in their comments, and section 8 of the COL-37 probe fails
-- until it is.
