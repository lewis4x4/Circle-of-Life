# Runbook — Super Admin user provisioning

Who this is for: an owner or org admin creating staff accounts in
**Admin → Settings → Users**, and whoever gets called when one goes wrong.

Related: [COL-362 QA](../reviews/2026-09-16-col-362-super-admin-users-qa.md).

---

## 1. Creating a user

`POST /api/admin/users` does three things in order — Supabase Auth user,
`user_profiles` row, `user_facility_access` grants. It is **all-or-nothing**: if any
step fails, everything the request wrote is undone before the error comes back.

### What the response tells you

| Field | Meaning |
|---|---|
| `invitation_sent: true` | An email really went out. Never set optimistically. |
| `provision_method: "invite_email"` | New Auth user, invite dispatched. |
| `provision_method: "temporary_password"` | No email. **You must hand the password over yourself.** |
| `provision_method: "password_reset_email"` | The person already had a working account; they got a reset link instead. |
| `temporary_password` | Shown **once**. It is never logged, never audited, never recoverable. |
| `temporary_password_expires_at` | 72 hours out. After this they cannot use it — reissue. |

**If you see `temporary_password`, the person is not going to get an email.** Read it to
them or send it over a channel you trust, and tell them it expires in 72 hours.

### Why an existing person sometimes gets a temporary password

If someone was invited before and never accepted, their Auth user exists but is
unconfirmed. Re-inviting does nothing useful, so the system confirms the account and
issues a temporary password instead, and reports `invitation_sent: false`. This is the
case that broke on 2026-09-15 — the old code silently did neither.

---

## 2. When a create fails

The error body tells you whether anything survived:

| `rollback` | What it means | What to do |
|---|---|---|
| `"complete"` | Nothing was saved. | Fix the details and try again. No cleanup needed. |
| `"partial"` | Cleanup itself failed; `user_id` names the leftover. | Follow §3 before retrying. |

A `409` with `code: "profile_email_exists"` means the person already has a Haven
profile. Do not create a second one — open them in User Management and edit their
facility access or reset their password.

A `422` on `facilities` means the same facility was listed twice. Remove the duplicate.

---

## 3. Diagnosing a half-created user

Read-only. Run against the project you are actually investigating.

```sql
-- Auth users with no Haven profile
select u.id, u.email, u.invited_at, u.email_confirmed_at, u.last_sign_in_at
from auth.users u
where not exists (select 1 from public.user_profiles p where p.id = u.id)
order by u.created_at desc;

-- Profiles with no active facility access
select p.id, p.email, p.full_name, p.app_role
from public.user_profiles p
where p.deleted_at is null
  and not exists (
    select 1 from public.user_facility_access a
    where a.user_id = p.id and a.revoked_at is null
  );

-- One person's full picture
select p.email, p.app_role, p.settings,
       u.email_confirmed_at, u.last_sign_in_at, u.invited_at,
       a.facility_id, a.is_primary, a.granted_at, a.revoked_at
from public.user_profiles p
left join auth.users u on u.id = p.id
left join public.user_facility_access a on a.user_id = p.id
where p.email = :email;
```

Owners and org admins legitimately have **no** `user_facility_access` rows — their scope
is org-wide. Only a non-org-wide role with zero active grants is broken.

---

## 4. Resetting a password

`POST /api/admin/users/[id]/reset-password`, owner or org admin only.

- `mode: "email"` — sends a reset link. Preferred.
- `mode: "temp"` — mints a temporary password, confirms the email, and forces a change
  at next sign-in. Use when the person cannot receive mail.

Limits: **10 resets per admin per 15 minutes.** A `429` means you have been cycling
accounts — stop and check whether something upstream is retrying.

You cannot reset your own password here (`422`), and only an owner can reset an owner.

---

## 5. Forced password change

A temporary password sets `must_change_password` in both `user_profiles.settings` and
Auth `app_metadata`, with a 72-hour deadline.

While it is set, the person is redirected to `/change-password` from **every** shell
(the check lives in `src/proxy.ts`, ahead of each shell's own role routing) and every
session-derived API call returns **403 `password_change_required`**.

| Symptom | Cause | Fix |
|---|---|---|
| Stuck on `/change-password`, gets `403 temporary_password_expired` | Past the 72-hour deadline | Reset again with `mode: "temp"` |
| `429 rate_limited` on change-password | 5 wrong current-password guesses in 15 min | Wait, or reissue a temporary password |
| Redirected to `/change-password` after changing it | Flag did not clear | Check `settings->>'must_change_password'` and `app_metadata`; both are cleared together by the change-password endpoint |

To clear the obligation by hand (last resort — it also clears the deadline):

```sql
update public.user_profiles
set settings = (settings - 'must_change_password' - 'must_change_password_expires_at')
where id = :user_id;
```

The Auth `app_metadata` mirror must be cleared too, or the proxy keeps redirecting.
Prefer re-running a reset over hand-editing.

---

## 6. What is deliberately not automatic

- **Orphaned Auth users from before this change are not cleaned up.** Rollback only
  removes an Auth user the *failing request itself* created. Anything older is a
  business decision — see the QA note on the 2026-08-19 bulk invite.
- **Revoked grants are reactivated, not duplicated.** Re-adding someone to a facility
  they were removed from restores the original row and refreshes `granted_at`.
- **Temporary passwords are not recoverable.** There is no second look. If it is lost,
  issue a new one.
