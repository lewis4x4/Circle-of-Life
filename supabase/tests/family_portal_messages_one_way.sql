-- Post-migration assertions: family_portal_messages is one-way (Haven → family).
-- Run after all migrations via scripts/pg-verify-migrations.mjs.

DO $$
DECLARE
  family_insert_policy_count integer;
  staff_policy_check text;
BEGIN
  SELECT
    count(*) INTO family_insert_policy_count
  FROM
    pg_policies
  WHERE
    schemaname = 'public'
    AND tablename = 'family_portal_messages'
    AND cmd = 'INSERT'
    AND policyname = 'family_send_messages_for_linked_residents';

  IF family_insert_policy_count > 0 THEN
    RAISE EXCEPTION 'family_portal_one_way: family_send_messages_for_linked_residents still exists';
  END IF;

  SELECT
    with_check::text INTO staff_policy_check
  FROM
    pg_policies
  WHERE
    schemaname = 'public'
    AND tablename = 'family_portal_messages'
    AND cmd = 'INSERT'
    AND policyname = 'staff_send_family_portal_messages';

  IF staff_policy_check IS NULL THEN
    RAISE EXCEPTION 'family_portal_one_way: staff_send_family_portal_messages missing';
  END IF;

  IF staff_policy_check NOT LIKE '%author_kind = ''staff''::family_message_author%' THEN
    RAISE EXCEPTION 'family_portal_one_way: staff insert must require author_kind = staff';
  END IF;

  IF staff_policy_check NOT LIKE '%facility_admin%' OR staff_policy_check NOT LIKE '%admin_assistant%' THEN
    RAISE EXCEPTION 'family_portal_one_way: staff insert must allow facility_admin and admin_assistant';
  END IF;

  IF staff_policy_check LIKE '%''family''%' THEN
    RAISE EXCEPTION 'family_portal_one_way: staff insert policy must not reference family role';
  END IF;
END;
$$;
