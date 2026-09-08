# Employee lifecycle deployment rollback

Migration 335 must precede the new frontend. Its pending-only attendance INSERT compatibility policy supports the previous production staffing console during rollout and rollback. The old console supplies both `created_by` and `updated_by`; both must identify the caller. The policy permits historical attendance for nondeleted staff, including staff whose employment has ended.

If frontend validation fails, restore the recorded previous Netlify deployment. Leave migration 335, its new tables, private buckets, immutable-history triggers, restrictive access policies, and pending-only attendance INSERT bridge in place. Confirm the previous staffing console can still record a pending callout as an authorized manager.

Do not drop tables, buckets, columns, objects, or employee records. Do not restore the old attendance or discipline FOR ALL policies. Do not restore direct UPDATE or DELETE grants. Frontend rollback does not undo employee signatures, training evidence, medical-access decisions, or reviewed attendance.

If the new command surface itself must be suspended, an authorized database operator may additionally execute the following permission-only rollback after restoring the frontend:

```sql
BEGIN;
REVOKE EXECUTE ON FUNCTION public.haven_employee_file_command(uuid,text,jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.haven_employee_requirement_command(uuid,text,jsonb) FROM authenticated;
COMMIT;
```

This stops new employee-file commands without deleting data or interrupting the previous console's constrained direct attendance INSERT. It does not disable authorized reads or Storage uploads; use an incident-specific containment plan if those surfaces are implicated. Existing signed download URLs can remain valid until their 60-second expiration.

After correcting and verifying the release, restore only these command grants:

```sql
BEGIN;
GRANT EXECUTE ON FUNCTION public.haven_employee_file_command(uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.haven_employee_requirement_command(uuid,text,jsonb) TO authenticated;
COMMIT;
```

Before declaring recovery, verify caller authentication, cross-facility denial, confidential medical denial without a grant, real Storage upload/attach/download, and legacy pending attendance INSERT. Record the deployed commit and Netlify deployment identifier; retain production data throughout.
