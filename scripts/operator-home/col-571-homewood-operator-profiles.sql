-- COL-571 / DEC-2026-09-22-02: one permission set for Administrator,
-- Assistant Administrator and Manager at Homewood.
--
-- Finding (2026-09-22, production): the Assistant Administrator's Haven login
-- already carries app_role = facility_admin in its JWT metadata and has
-- Homewood access, but has NO user_profiles row and has never signed in. Every
-- profile-backed surface (greeting, staff lists, the actor state migration 326
-- reads) therefore cannot see her. No role changes; the fix is the missing
-- profile row, shaped exactly as POST /api/admin/users would have written it.
--
-- Run by hand on the hosted project (production, then confirm on staging if
-- the same auth user exists there). Idempotent. User ids, not names, are the
-- keys; the display name is what colleagues call her (Linear COL-571).
--
--   test "$(cat supabase/.temp/project-ref)" = "manfqmasfqppukpobpld" || exit 1
--   supabase db query --linked -f scripts/operator-home/col-571-homewood-operator-profiles.sql

insert into public.user_profiles (id, organization_id, email, full_name, app_role, is_active, job_title)
select u.id,
       '00000000-0000-0000-0000-000000000001',
       u.email,
       'Mindy Gaskins',
       'facility_admin'::public.app_role,
       true,
       'Assistant Administrator'
from auth.users u
where u.id = '26d194ca-fae0-49b5-9a15-db1c385f3d77'
  and not exists (select 1 from public.user_profiles p where p.id = u.id);

-- Verify: both Homewood operator titles resolve to the same app_role.
select p.id, p.full_name, p.job_title, p.app_role::text,
       (select string_agg(f.name, ', ') from public.user_facility_access a join public.facilities f on f.id = a.facility_id
         where a.user_id = p.id and a.revoked_at is null) as facilities
  from public.user_profiles p
 where p.id in ('47060e71-0a0d-4436-84f0-b8a153204e11', '26d194ca-fae0-49b5-9a15-db1c385f3d77')
 order by p.job_title;
