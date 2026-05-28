#!/usr/bin/env python3
"""
Identify seed/demo users and hard-delete eligible accounts in bulk.

Usage:
  SUPABASE_ACCESS_TOKEN=sbp_... python3 scripts/cleanup-seed-users.py [--dry-run] [--apply] [--yes] [--include email1 email2 ...] [--exclude email1 email2 ...]
"""

import argparse
import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.request

PROJECT_REF = "manfqmasfqppukpobpld"
API_BASE = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
SCRIPT_ACTOR_USER_ID = "062c3cfb-53a5-4482-814a-cbef2b028760"
DEMO_ORGANIZATION_ID = "11111111-1111-1111-1111-111111111112"
USER_AGENT = "cleanup-seed-users/1.0 (+circle-of-life)"
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)

# This list is mirrored from src/app/api/admin/users/[id]/hard-delete/route.ts.
# If you update it here, update it there too (or vice versa).
PROTECTED_TABLES = [
    ("user_management_audit_log", "acting_user_id"),
    ("user_management_audit_log", "target_user_id"),
    ("audit_log", "user_id"),
    ("staff", "id"),
    ("staff", "user_id"),
    ("staff", "created_by"),
    ("staff", "updated_by"),
    ("user_facility_access", "granted_by"),
    ("user_facility_access", "revoked_by"),
    ("family_resident_links", "granted_by"),
    ("family_resident_links", "revoked_by"),
    ("residents", "created_by"),
    ("residents", "updated_by"),
    ("residents", "code_status_verified_by"),
    ("residents", "allergy_list_reviewed_by"),
    ("residents", "primary_diagnosis_reviewed_by"),
    ("care_plans", "reviewed_by"),
    ("care_plans", "approved_by"),
    ("care_plans", "created_by"),
    ("care_plans", "updated_by"),
    ("care_plan_items", "created_by"),
    ("care_plan_items", "updated_by"),
    ("care_plan_tasks", "completed_by"),
    ("care_plan_tasks", "updated_by"),
    ("incidents", "reported_by"),
    ("incidents", "nurse_notified_by"),
    ("incidents", "family_notified_by"),
    ("incidents", "resolved_by"),
    ("incidents", "created_by"),
    ("incidents", "updated_by"),
    ("incident_followups", "assigned_to"),
    ("incident_followups", "completed_by"),
    ("incident_photos", "taken_by"),
    ("assessments", "assessed_by"),
    ("assessments", "created_by"),
    ("assessments", "updated_by"),
    ("resident_photos", "taken_by"),
    ("resident_documents", "uploaded_by"),
    ("daily_logs", "logged_by"),
    ("daily_logs", "created_by"),
    ("daily_logs", "updated_by"),
    ("adl_logs", "logged_by"),
    ("behavioral_logs", "logged_by"),
    ("condition_changes", "reported_by"),
    ("condition_changes", "nurse_notified_by"),
    ("shift_handoffs", "outgoing_staff_id"),
    ("shift_handoffs", "incoming_staff_id"),
    ("activity_attendance", "logged_by"),
    ("resident_medications", "discontinued_by"),
    ("resident_medications", "created_by"),
    ("resident_medications", "updated_by"),
    ("emar_records", "administered_by"),
    ("emar_records", "created_by"),
    ("emar_records", "updated_by"),
    ("verbal_orders", "received_by"),
    ("verbal_orders", "cosigned_by"),
    ("verbal_orders", "implemented_by"),
    ("verbal_orders", "created_by"),
    ("verbal_orders", "updated_by"),
    ("medication_errors", "discovered_by"),
    ("medication_errors", "reviewed_by"),
    ("medication_errors", "created_by"),
    ("medication_errors", "updated_by"),
    ("controlled_substance_counts", "outgoing_staff_id"),
    ("controlled_substance_counts", "incoming_staff_id"),
    ("controlled_substance_counts", "resolved_by"),
    ("med_tech_shifts", "user_id"),
    ("med_tech_shifts", "created_by"),
    ("med_tech_shifts", "updated_by"),
    ("med_passes", "administered_by"),
    ("med_passes", "witnessed_by"),
    ("med_passes", "created_by"),
    ("med_passes", "updated_by"),
    ("witness_signatures", "witness_user_id"),
    ("prn_events", "nurse_notified_user_id"),
    ("prn_events", "created_by"),
    ("prn_events", "updated_by"),
    ("invoices", "voided_by"),
    ("invoices", "created_by"),
    ("invoices", "updated_by"),
    ("payments", "deposited_by"),
    ("payments", "created_by"),
    ("payments", "updated_by"),
    ("collection_activities", "performed_by"),
    ("journal_entries", "posted_by"),
    ("journal_entries", "created_by"),
    ("journal_entries", "updated_by"),
    ("audit_log_export_jobs", "requested_by"),
    ("survey_visit_sessions", "activated_by"),
    ("survey_visit_sessions", "deactivated_by"),
    ("survey_visit_log_entries", "accessed_by"),
    ("facilities", "current_administrator_id"),
    ("facility_audit_log", "changed_by"),
    ("operation_audit_log", "actor_id"),
    ("alert_audit_log", "actor_id"),
    ("exec_nlq_sessions", "user_id"),
    ("exec_nlq_sessions", "created_by"),
    ("exec_nlq_sessions", "updated_by"),
    ("ai_invocations", "created_by"),
    ("exec_alerts", "acknowledged_by"),
    ("exec_alerts", "resolved_by"),
    ("resident_status_history", "created_by"),
    ("resident_status_history", "updated_by"),
    ("facility_medicaid_providers", "created_by"),
    ("facility_medicaid_providers", "updated_by"),
    ("maintenance_tickets", "submitted_by"),
    ("maintenance_tickets", "assigned_to_user_id"),
    ("maintenance_tickets", "created_by"),
    ("maintenance_tickets", "updated_by"),
    ("maintenance_task_completions", "completed_by_user_id"),
    ("maintenance_task_completions", "created_by"),
    ("maintenance_task_completions", "updated_by"),
    ("meal_logs", "recorded_by"),
    ("meal_logs", "updated_by"),
    ("snack_logs", "passed_by_user_id"),
    ("snack_logs", "created_by"),
    ("snack_logs", "updated_by"),
    ("staff_attestations", "signed_by_user_id"),
    ("staff_attestations", "created_by"),
    ("staff_attestations", "updated_by"),
    ("activity_sessions", "confirmed_by_user_id"),
]


def must_token():
    tok = os.environ.get("SUPABASE_ACCESS_TOKEN")
    if not tok:
        sys.stderr.write("ERROR: SUPABASE_ACCESS_TOKEN env var is required\n")
        sys.exit(2)
    return tok


def run_sql(token, sql):
    body = json.dumps({"query": sql}).encode("utf-8")
    req = urllib.request.Request(
        API_BASE,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {err}") from e
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return {"raw": payload}


def sql_quote(value):
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def jsonb_quote(value):
    return sql_quote(json.dumps(value, separators=(",", ":"))) + "::jsonb"


def normalize_email(value):
    return (value or "").strip().lower()


def values_table(emails):
    normalized = sorted(set(normalize_email(email) for email in emails if normalize_email(email)))
    if not normalized:
        return "SELECT NULL::text AS email WHERE false"
    return "VALUES " + ", ".join(f"({sql_quote(email)})" for email in normalized)


def fetch_actor(token):
    rows = run_sql(
        token,
        "SELECT id, email, organization_id FROM user_profiles "
        f"WHERE id = {sql_quote(SCRIPT_ACTOR_USER_ID)} LIMIT 1",
    )
    if isinstance(rows, list) and rows:
        return rows[0]
    raise RuntimeError(f"Script actor user not found: {SCRIPT_ACTOR_USER_ID}")


def fetch_candidates(token, include, exclude):
    excluded = sorted(set(normalize_email(email) for email in exclude if normalize_email(email)))
    exclude_clause = ""
    if excluded:
        exclude_clause = "AND lower(up.email) NOT IN (" + ", ".join(sql_quote(email) for email in excluded) + ")"

    sql = f"""
WITH explicit_emails(email) AS (
  {values_table(include)}
)
SELECT
  up.id,
  up.email,
  up.full_name,
  up.app_role,
  up.organization_id,
  COALESCE(o.name, up.organization_id::text) AS organization_name,
  up.created_at,
  up.deleted_at
FROM user_profiles up
LEFT JOIN organizations o ON o.id = up.organization_id
WHERE up.email IS NOT NULL
  {exclude_clause}
  AND (
    lower(up.email) ~ '(@example\\.com|@example\\.org|@test\\.com|@haven-demo\\.com|@demo\\.havenalf\\.com|@circleoflife-demo\\.com)$'
    OR lower(up.email) LIKE '%+seed%'
    OR lower(up.email) LIKE '%+test%'
    OR lower(up.email) LIKE '%+demo%'
    OR up.full_name ILIKE 'Demo %'
    OR up.full_name ILIKE 'Test %'
    OR up.full_name ILIKE 'Seed %'
    OR up.organization_id = {sql_quote(DEMO_ORGANIZATION_ID)}
    OR lower(up.email) IN (SELECT email FROM explicit_emails)
  )
ORDER BY up.created_at, lower(up.email)
"""
    rows = run_sql(token, sql)
    if not isinstance(rows, list):
        raise RuntimeError(f"Unexpected candidate query response: {rows}")
    return rows


def protected_references(token, candidate):
    refs = []
    user_id = candidate["id"]
    organization_id = candidate["organization_id"]
    for table, column in PROTECTED_TABLES:
        sql = (
            f"SELECT 1 FROM {table} "
            f"WHERE {column} = {sql_quote(user_id)} "
            f"AND organization_id = {sql_quote(organization_id)} "
            "LIMIT 1"
        )
        rows = run_sql(token, sql)
        if isinstance(rows, list) and rows:
            refs.append((table, column))
        elif not isinstance(rows, list):
            raise RuntimeError(f"Unexpected history check response for {table}.{column}: {rows}")
    return refs


def classify_candidates(token, candidates, actor):
    eligible = []
    skipped = []
    actor_email = normalize_email(actor.get("email"))

    for candidate in candidates:
        email = normalize_email(candidate.get("email"))
        if candidate.get("id") == SCRIPT_ACTOR_USER_ID or (actor_email and email == actor_email):
            skipped.append({"candidate": candidate, "reason": "self_delete_not_allowed"})
            print(f"ERROR: refusing to delete script actor: {candidate.get('email')}")
            continue
        if candidate.get("app_role") in ("owner", "org_admin"):
            skipped.append({"candidate": candidate, "reason": "target_role_protected"})
            print(f"ERROR: refusing protected-role candidate: {candidate.get('email')} ({candidate.get('app_role')})")
            continue
        if not candidate.get("organization_id"):
            skipped.append({"candidate": candidate, "reason": "missing_organization_id"})
            print(f"ERROR: refusing candidate without organization_id: {candidate.get('email')}")
            continue
        try:
            refs = protected_references(token, candidate)
        except RuntimeError as e:
            skipped.append({"candidate": candidate, "reason": f"history_check_failed: {e}"})
            continue
        if refs:
            skipped.append({"candidate": candidate, "reason": "has protected history", "references": refs})
        else:
            eligible.append(candidate)

    return eligible, skipped


def display_date(value):
    text = str(value or "")
    if len(text) >= 10:
        return text[:10]
    return text


def print_report(candidates, eligible, skipped):
    print(f"Candidates found: {len(candidates)}")
    print(f"  - {len(eligible)} eligible for hard-delete (no protected history)")
    print(f"  - {len(skipped)} skipped (have protected history or guardrail):")
    for item in skipped:
        candidate = item["candidate"]
        refs = item.get("references") or []
        if refs:
            ref_text = ", ".join(f"{table}.{column}" for table, column in refs)
            print(f"    - {candidate.get('email')} — {ref_text} ({item['reason']})")
        else:
            print(f"    - {candidate.get('email')} — {item['reason']}")

    print(f"\nEligible for deletion ({len(eligible)}):")
    if not eligible:
        print("  - none")
    for candidate in eligible:
        print(
            "  - "
            + f"{candidate.get('email')}  "
            + f"({candidate.get('app_role')}, {candidate.get('organization_name')}, created {display_date(candidate.get('created_at'))})"
        )


def confirm_apply(eligible, yes):
    if not eligible:
        return False
    if yes:
        return True
    if not sys.stdin.isatty():
        print("\nERROR: --apply in a non-interactive session requires --yes")
        return False
    print("\nEligible users to delete:")
    for candidate in eligible:
        print(f"  - {candidate.get('email')}")
    print("\nType DELETE to hard-delete the eligible users listed above.")
    return input("Confirm: ").strip() == "DELETE"


def batch_id():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def write_audit(token, candidate, run_batch_id):
    changes = {
        "before": {
            "id": candidate.get("id"),
            "email": candidate.get("email"),
            "full_name": candidate.get("full_name"),
            "app_role": candidate.get("app_role"),
            "deleted_at": candidate.get("deleted_at"),
        },
        "after": {"hard_delete_requested": True},
        "meta": {
            "reason": "seed_cleanup",
            "target_email": candidate.get("email"),
            "batch_id": run_batch_id,
        },
    }
    sql = (
        "INSERT INTO user_management_audit_log "
        "(organization_id, acting_user_id, target_user_id, action, resource_type, changes, reason, user_agent) "
        "VALUES ("
        f"{sql_quote(candidate['organization_id'])}, "
        f"{sql_quote(SCRIPT_ACTOR_USER_ID)}, "
        "NULL, "
        "'hard_delete', "
        "'user', "
        f"{jsonb_quote(changes)}, "
        "'seed_cleanup', "
        f"{sql_quote(USER_AGENT)}"
        ")"
    )
    run_sql(token, sql)


def delete_user(token, candidate):
    run_sql(token, f"DELETE FROM auth.users WHERE id = {sql_quote(candidate['id'])}")


def verify_deleted(token, candidate):
    rows = run_sql(token, f"SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = {sql_quote(candidate['id'])}) AS exists")
    if not isinstance(rows, list) or not rows:
        raise RuntimeError(f"Unexpected verification response: {rows}")
    if rows[0].get("exists"):
        raise RuntimeError("auth.users row still exists after delete")


def apply_deletions(token, eligible):
    successes = []
    failures = []
    run_batch_id = batch_id()

    for candidate in eligible:
        print(f"\n[delete] {candidate.get('email')}")
        try:
            write_audit(token, candidate, run_batch_id)
            print("  [ok] audit row written")
            delete_user(token, candidate)
            print("  [ok] auth user deleted")
            verify_deleted(token, candidate)
            print("  [ok] verified gone")
            successes.append(candidate)
        except RuntimeError as e:
            print(f"  [FAIL] {candidate.get('email')}: {e}")
            failures.append({"candidate": candidate, "error": str(e)})

    return successes, failures


def parse_args():
    parser = argparse.ArgumentParser(description="Identify and hard-delete seed/demo users after protected-history checks.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Report candidates only; this is the default.")
    mode.add_argument("--apply", action="store_true", help="Delete eligible users after confirmation.")
    parser.add_argument("--yes", action="store_true", help="Skip interactive DELETE confirmation when used with --apply.")
    parser.add_argument("--include", nargs="*", default=[], help="Explicit seed emails to include.")
    parser.add_argument("--exclude", nargs="*", default=[], help="Emails to exclude from candidate selection.")
    return parser.parse_args()


def validate_candidates(candidates):
    for candidate in candidates:
        user_id = candidate.get("id") or ""
        if not UUID_RE.match(user_id):
            raise RuntimeError(f"Invalid candidate user id for {candidate.get('email')}: {user_id}")


def main():
    args = parse_args()
    token = must_token()
    dry_run = not args.apply

    print(f"[info] target project: {PROJECT_REF}")
    if dry_run:
        print("[info] DRY RUN — no users will be deleted")

    actor = fetch_actor(token)
    print(f"[info] script actor: {actor.get('email')} ({SCRIPT_ACTOR_USER_ID})")

    candidates = fetch_candidates(token, args.include, args.exclude)
    validate_candidates(candidates)
    eligible, skipped = classify_candidates(token, candidates, actor)
    print_report(candidates, eligible, skipped)

    if dry_run:
        print("\n[done] dry-run complete; rerun with --apply to delete eligible users")
        return 0

    if not confirm_apply(eligible, args.yes):
        print("\n[abort] confirmation not received; no users deleted")
        return 1

    successes, failures = apply_deletions(token, eligible)
    print("\nSummary:")
    print(f"  successes: {len(successes)}")
    print(f"  skipped:   {len(skipped)}")
    print(f"  failures:  {len(failures)}")
    for failure in failures:
        print(f"    - {failure['candidate'].get('email')}: {failure['error']}")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
