-- Stale app roles: give the Homewood floor accounts a profile and med_tech, and fold the
-- last retired role claims the way migration 468 did.
--
-- Spec: docs/specs/40-floor-tablet-and-kiosk.md section 9, item 3 (COL-677, run for COL-695).
-- Who runs it: Brian, by hand, against production. The build never runs it.
--
-- Background (spec section 2, production on 2026-09-23): the Homewood floor accounts were
-- invited with app_metadata.app_role = caregiver and never got a user_profiles row, so
-- migration 468, which folded roles on user_profiles, did not reach them. A floor tablet
-- lists a person only when their staff row is linked to a login with an active profile
-- in a roster role (med_tech by default), so without this none of them can unlock.
--
-- The mapping is migration 468's, unchanged: nurse and caregiver become med_tech,
-- dietary and dietary_aide become cook. The claim path is 468's too: the role goes into
-- auth.users.raw_app_meta_data (app_role) and into user_profiles.app_role, and the
-- profile's auth_claim_version moves forward so a token minted before the change stops
-- authorizing and the next token carries the new role (migration 326's token hook reads
-- the profile).
--
-- What it changes, per account in the Circle of Life organization:
--   * Retired claim (nurse, caregiver, dietary, dietary_aide): the claim is rewritten to
--     the target role. The target is the profile's role when the account has a current
--     profile that already holds a live role; otherwise 468's mapping.
--   * Profile holding a retired role: app_role is folded (the profile trigger advances
--     auth_claim_version, as it did in 468).
--   * Homewood account with no profile: a profile is created (organization, email and
--     full name from the login, falling back to the staff row for the name; target role;
--     active) with auth_claim_version 2, so a version-less token issued before it is
--     refused. Only when the account resolves to one active or on-leave Homewood staff
--     row. The same applies to a Homewood account whose claim is already med_tech or cook
--     but has no profile, so a second run finishes what a first run had to leave.
--   * Homewood staff row not linked to a login: linked (staff.user_id) only when exactly
--     one unlinked Homewood staff row has the login's email and no other account claims it.
--   * Homewood access: a user_facility_access grant for Homewood is added when missing
--     (the access trigger advances auth_claim_version again).
-- Anything that cannot be done safely (no staff row, two staff rows, an email another
-- profile already uses, no name, a terminated staff row, an account outside Homewood with
-- no profile) is listed under "manual review" and only its claim is folded.
--
-- Commands (from the repository root, in a checkout linked to production):
--
--   Dry run (read only; prints the report and changes nothing):
--     test "$(cat supabase/.temp/project-ref)" = "manfqmasfqppukpobpld" || { echo "WRONG LINK"; exit 1; }
--     supabase db query --linked -f scripts/floor/fix-stale-app-roles.sql
--
--   Apply (the same file with the apply switch set for this script only):
--     test "$(cat supabase/.temp/project-ref)" = "manfqmasfqppukpobpld" || { echo "WRONG LINK"; exit 1; }
--     { echo "SET haven.col695_apply = 'fix-stale-app-roles';"; cat scripts/floor/fix-stale-app-roles.sql; } > /tmp/col695-fix-stale-app-roles-apply.sql
--     supabase db query --linked -f /tmp/col695-fix-stale-app-roles-apply.sql
--
-- Plain SQL on purpose: `supabase db query` sends the file through the Management API,
-- which does not run psql meta-commands such as \if. `--db-url` is not a substitute: it
-- refuses a file with more than one statement; for a rehearsal use `psql -f` on a scratch
-- database. The apply switch is a session setting whose value must name this script.
-- The final statement is the report.
--
-- Safe to run twice: an account whose claim, profile, staff link and access are already
-- right is not selected again. The report prints user ids and roles, never names or
-- email addresses. Retired role names appear only in the old-to-new mapping.

DROP TABLE IF EXISTS pg_temp.col695_report;
CREATE TEMP TABLE col695_report (seq bigserial PRIMARY KEY, section text NOT NULL, item text NOT NULL, detail text);

BEGIN;

CREATE TEMP TABLE col695_role_fold (source text PRIMARY KEY, target text NOT NULL) ON COMMIT DROP;
INSERT INTO col695_role_fold VALUES ('nurse', 'med_tech'), ('caregiver', 'med_tech'), ('dietary', 'cook'), ('dietary_aide', 'cook');

DO $col695$
DECLARE
  c_script CONSTANT text := 'fix-stale-app-roles';
  c_org CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
  c_homewood CONSTANT uuid := '00000000-0000-0000-0002-000000000003';
  v_apply boolean := coalesce(current_setting('haven.col695_apply', true), '') = c_script;
  v_now CONSTANT timestamptz := now();
  v_n integer;
  v_fac_id uuid;
  r record;
BEGIN
  SELECT count(*) INTO v_n FROM public.facilities f
  WHERE f.organization_id = c_org AND f.name ILIKE 'Homewood Lodge%' AND f.deleted_at IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one Homewood Lodge facility in the Circle of Life organization, found %', v_n;
  END IF;
  SELECT f.id INTO STRICT v_fac_id FROM public.facilities f
  WHERE f.organization_id = c_org AND f.name ILIKE 'Homewood Lodge%' AND f.deleted_at IS NULL;
  IF v_fac_id <> c_homewood THEN
    RAISE EXCEPTION 'The Homewood Lodge facility found (%) is not the Homewood id the repository uses (%)', v_fac_id, c_homewood;
  END IF;

  -- Every account this script looks at, with what it knows about each.
  CREATE TEMP TABLE col695_accounts ON COMMIT DROP AS
  WITH base AS (
    SELECT
      u.id AS user_id,
      nullif(btrim(u.email), '') AS email,
      nullif(btrim(u.raw_app_meta_data ->> 'app_role'), '') AS claim_role,
      nullif(btrim(u.raw_user_meta_data ->> 'full_name'), '') AS login_name,
      p.id IS NOT NULL AS has_profile,
      p.deleted_at IS NOT NULL AS profile_deleted,
      p.app_role::text AS profile_role,
      EXISTS (SELECT 1 FROM public.staff s WHERE s.user_id = u.id AND s.facility_id = v_fac_id AND s.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM public.user_facility_access a WHERE a.user_id = u.id AND a.facility_id = v_fac_id AND a.revoked_at IS NULL)
        AS homewood,
      EXISTS (SELECT 1 FROM public.user_facility_access a WHERE a.user_id = u.id AND a.facility_id = v_fac_id AND a.revoked_at IS NULL)
        AS has_homewood_access,
      (SELECT count(*) FROM public.staff s WHERE s.user_id = u.id AND s.deleted_at IS NULL) AS linked_staff
    FROM auth.users u
    LEFT JOIN public.user_profiles p ON p.id = u.id
    WHERE u.deleted_at IS NULL
      AND (p.organization_id = c_org
        OR EXISTS (SELECT 1 FROM public.staff s WHERE s.user_id = u.id AND s.organization_id = c_org)
        OR EXISTS (SELECT 1 FROM public.user_facility_access a WHERE a.user_id = u.id AND a.organization_id = c_org)
        OR u.raw_app_meta_data ->> 'organization_id' = c_org::text)
  )
  SELECT b.*,
    CASE
      WHEN b.has_profile AND NOT b.profile_deleted AND b.profile_role NOT IN (SELECT source FROM col695_role_fold) THEN b.profile_role
      WHEN b.has_profile AND NOT b.profile_deleted THEN (SELECT f.target FROM col695_role_fold f WHERE f.source = b.profile_role)
      ELSE coalesce((SELECT f.target FROM col695_role_fold f WHERE f.source = b.claim_role), b.claim_role)
    END AS target_role,
    NULL::uuid AS staff_id,
    NULL::text AS staff_status,
    false AS link_staff,
    NULL::text AS full_name,
    false AS create_profile,
    false AS fold_profile,
    false AS grant_access,
    NULL::text AS review
  FROM base b
  WHERE b.claim_role IN (SELECT source FROM col695_role_fold)
     OR (b.has_profile AND b.profile_role IN (SELECT source FROM col695_role_fold))
     OR (NOT b.has_profile AND b.homewood AND b.claim_role IN ('med_tech', 'cook'));

  -- The Homewood staff row for each Homewood account: the linked one, or one unlinked
  -- row with the same email that no other login shares.
  UPDATE col695_accounts a SET staff_id = s.id, staff_status = s.employment_status::text
  FROM public.staff s
  WHERE a.homewood AND a.linked_staff = 1 AND s.user_id = a.user_id AND s.facility_id = v_fac_id AND s.deleted_at IS NULL;

  UPDATE col695_accounts a SET staff_id = m.staff_id, staff_status = m.staff_status, link_staff = true
  FROM (
    SELECT s.id AS staff_id, s.employment_status::text AS staff_status, u.id AS user_id
    FROM public.staff s
    JOIN auth.users u ON lower(btrim(u.email)) = lower(btrim(s.email)) AND u.deleted_at IS NULL
    WHERE s.facility_id = v_fac_id AND s.organization_id = c_org AND s.deleted_at IS NULL AND s.user_id IS NULL
      AND nullif(btrim(s.email), '') IS NOT NULL
      AND (SELECT count(*) FROM auth.users u2 WHERE lower(btrim(u2.email)) = lower(btrim(s.email)) AND u2.deleted_at IS NULL) = 1
      AND (SELECT count(*) FROM public.staff s2 WHERE lower(btrim(s2.email)) = lower(btrim(s.email)) AND s2.facility_id = v_fac_id
             AND s2.deleted_at IS NULL AND s2.user_id IS NULL) = 1
  ) m
  WHERE a.homewood AND a.linked_staff = 0 AND a.user_id = m.user_id;

  UPDATE col695_accounts a SET full_name = coalesce(a.login_name, nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), ''))
  FROM public.staff s WHERE s.id = a.staff_id;
  UPDATE col695_accounts a SET full_name = a.login_name WHERE a.staff_id IS NULL;

  -- Decide, and say why when the answer is "not safely".
  UPDATE col695_accounts a SET fold_profile = true
  WHERE a.has_profile AND NOT a.profile_deleted AND a.profile_role IN (SELECT source FROM col695_role_fold);

  UPDATE col695_accounts a SET review = CASE
      WHEN a.profile_deleted THEN 'profile was removed; claim folded only'
      WHEN NOT a.homewood THEN 'no profile and not a Homewood account; claim folded only. Add the person in User Management if they should sign in'
      WHEN a.target_role NOT IN ('med_tech', 'cook') THEN 'unexpected target role; claim folded only'
      WHEN a.linked_staff > 1 THEN 'login is linked to more than one staff row'
      WHEN a.staff_id IS NULL THEN 'no Homewood staff row is linked or matches by email'
      WHEN a.staff_status NOT IN ('active', 'on_leave') THEN 'staff row is ' || a.staff_status || '; no profile created'
      WHEN a.email IS NULL THEN 'login has no email'
      WHEN EXISTS (SELECT 1 FROM public.user_profiles p WHERE lower(p.email) = lower(a.email) AND p.deleted_at IS NULL) THEN 'another profile already uses this email'
      WHEN a.full_name IS NULL THEN 'no name on the login or the staff row'
    END
  WHERE NOT a.has_profile OR a.profile_deleted;

  UPDATE col695_accounts a SET create_profile = true WHERE NOT a.has_profile AND a.review IS NULL;
  UPDATE col695_accounts a SET link_staff = false WHERE a.link_staff AND NOT a.create_profile;
  UPDATE col695_accounts a SET grant_access = true
  WHERE a.homewood AND NOT a.has_homewood_access AND (a.create_profile OR (a.has_profile AND NOT a.profile_deleted));

  INSERT INTO col695_report (section, item, detail) VALUES
    ('mode', c_script, CASE WHEN v_apply THEN 'APPLY' ELSE 'DRY RUN (nothing is changed)' END),
    ('facility', 'Homewood id', v_fac_id::text),
    ('accounts', 'total', (SELECT count(*) FROM col695_accounts)::text);
  FOR r IN SELECT coalesce(claim_role, '(none)') AS claim_role, target_role, homewood, count(*) AS n FROM col695_accounts GROUP BY 1, 2, 3 ORDER BY 3 DESC, 1 LOOP
    INSERT INTO col695_report (section, item, detail)
      VALUES ('accounts', 'claim ' || r.claim_role || ' to ' || coalesce(r.target_role, '?') || CASE WHEN r.homewood THEN ', Homewood' ELSE ', other' END, r.n::text);
  END LOOP;
  INSERT INTO col695_report (section, item, detail) VALUES
    ('plan', 'claims to fold', (SELECT count(*) FROM col695_accounts WHERE claim_role IS DISTINCT FROM target_role)::text),
    ('plan', 'profiles to fold', (SELECT count(*) FROM col695_accounts WHERE fold_profile)::text),
    ('plan', 'profiles to create', (SELECT count(*) FROM col695_accounts WHERE create_profile)::text),
    ('plan', 'staff rows to link', (SELECT count(*) FROM col695_accounts WHERE link_staff)::text),
    ('plan', 'Homewood access to grant', (SELECT count(*) FROM col695_accounts WHERE grant_access)::text),
    ('plan', 'manual review', (SELECT count(*) FROM col695_accounts WHERE review IS NOT NULL)::text);
  FOR r IN SELECT * FROM col695_accounts ORDER BY homewood DESC, claim_role, user_id LOOP
    INSERT INTO col695_report (section, item, detail)
      VALUES (CASE WHEN r.review IS NULL THEN 'account' ELSE 'manual review' END, r.user_id::text,
        'claim ' || coalesce(r.claim_role, '(none)')
        || ', profile ' || CASE WHEN NOT r.has_profile THEN 'none' WHEN r.profile_deleted THEN 'removed' ELSE r.profile_role END
        || ', target ' || coalesce(r.target_role, '?')
        || CASE WHEN r.homewood THEN ', Homewood' ELSE '' END
        || CASE WHEN r.staff_id IS NOT NULL THEN ', staff ' || r.staff_id::text || ' (' || r.staff_status || CASE WHEN r.link_staff THEN ', to link' ELSE ', linked' END || ')' ELSE '' END
        || CASE WHEN r.create_profile THEN ', create profile' ELSE '' END
        || CASE WHEN r.fold_profile THEN ', fold profile' ELSE '' END
        || CASE WHEN r.grant_access THEN ', grant Homewood access' ELSE '' END
        || CASE WHEN r.review IS NOT NULL THEN '; ' || r.review ELSE '' END);
  END LOOP;

  IF NOT v_apply THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM col695_accounts WHERE target_role IS NULL
             OR target_role NOT IN (SELECT unnest(enum_range(NULL::public.app_role))::text)) THEN
    RAISE EXCEPTION 'An account has no valid target role; nothing applied';
  END IF;

  -- 1. Claims (468: raw_app_meta_data app_role).
  UPDATE auth.users u
  SET raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('app_role', a.target_role)
  FROM col695_accounts a
  WHERE u.id = a.user_id AND a.claim_role IS DISTINCT FROM a.target_role;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO col695_report (section, item, detail) VALUES ('applied', 'claims folded', v_n::text);

  -- 2. Profiles already holding a retired role (468: user_profiles.app_role; the trigger
  --    advances auth_claim_version).
  UPDATE public.user_profiles p
  SET app_role = a.target_role::public.app_role, updated_at = v_now
  FROM col695_accounts a
  WHERE p.id = a.user_id AND a.fold_profile AND p.app_role::text IN (SELECT source FROM col695_role_fold);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO col695_report (section, item, detail) VALUES ('applied', 'profiles folded', v_n::text);

  -- 3. Missing profiles, started at claim version 2 so an older token is refused.
  INSERT INTO public.user_profiles (id, organization_id, email, full_name, app_role, is_active, auth_claim_version)
  SELECT a.user_id, c_org, a.email, a.full_name, a.target_role::public.app_role, true, 2
  FROM col695_accounts a
  WHERE a.create_profile
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO col695_report (section, item, detail) VALUES ('applied', 'profiles created', v_n::text);

  -- 4. Staff rows linked to their login.
  UPDATE public.staff s
  SET user_id = a.user_id, updated_at = v_now
  FROM col695_accounts a
  WHERE s.id = a.staff_id AND a.link_staff AND s.user_id IS NULL AND s.facility_id = v_fac_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO col695_report (section, item, detail) VALUES ('applied', 'staff rows linked', v_n::text);

  -- 5. Homewood access (the access trigger advances auth_claim_version).
  INSERT INTO public.user_facility_access (user_id, facility_id, organization_id, is_primary)
  SELECT a.user_id, v_fac_id, c_org,
         NOT EXISTS (SELECT 1 FROM public.user_facility_access x WHERE x.user_id = a.user_id AND x.revoked_at IS NULL)
  FROM col695_accounts a
  WHERE a.grant_access
    AND NOT EXISTS (SELECT 1 FROM public.user_facility_access x WHERE x.user_id = a.user_id AND x.facility_id = v_fac_id AND x.revoked_at IS NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO col695_report (section, item, detail) VALUES ('applied', 'Homewood access granted', v_n::text);

  -- Check the result before the transaction commits.
  IF EXISTS (SELECT 1 FROM col695_accounts a JOIN auth.users u ON u.id = a.user_id
             WHERE nullif(btrim(u.raw_app_meta_data ->> 'app_role'), '') IN (SELECT source FROM col695_role_fold)) THEN
    RAISE EXCEPTION 'A retired role claim is still present; rolled back';
  END IF;
  IF EXISTS (SELECT 1 FROM col695_accounts a
             WHERE a.create_profile AND NOT EXISTS (
               SELECT 1 FROM public.user_profiles p JOIN public.staff s ON s.user_id = p.id AND s.facility_id = v_fac_id AND s.deleted_at IS NULL
               JOIN public.user_facility_access x ON x.user_id = p.id AND x.facility_id = v_fac_id AND x.revoked_at IS NULL
               WHERE p.id = a.user_id AND p.app_role::text = a.target_role AND p.is_active AND p.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'A Homewood account did not end with a profile, a linked staff row and Homewood access; rolled back';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_profiles p
             WHERE p.app_role::text IN (SELECT source FROM col695_role_fold) AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'A current profile still holds a retired role; rolled back';
  END IF;
  INSERT INTO col695_report (section, item, detail) VALUES ('applied', 'verified', 'no retired claims; every created profile is linked, active and has Homewood access');
END
$col695$;

COMMIT;

RESET haven.col695_apply;

SELECT section, item, detail FROM col695_report ORDER BY seq;
