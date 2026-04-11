import { createClient } from "@/lib/supabase/client";

export type ComplianceReminder = {
  id: string;
  facility_id: string;
  organization_id: string;
  reminder_type: "weekly_digest" | "poc_due" | "assessment_overdue" | "care_plan_review_due" | "policy_acknowledgment_overdue";
  title: string;
  description: string | null;
  action_url: string | null;
  next_send_at: string;
  last_sent_at: string | null;
  frequency: "once" | "daily" | "weekly" | null;
  context: Record<string, unknown> | null;
  status: "pending" | "sent" | "dismissed";
  dismissed_by: string | null;
  dismissed_at: string | null;
  created_at: string;
  created_by: string | null;
};

export type ReminderCounts = {
  weekly_digest: number;
  poc_due: number;
  assessment_overdue: number;
  care_plan_review_due: number;
  policy_acknowledgment_overdue: number;
  total: number;
};

/**
 * Get pending reminders for a facility.
 */
export async function getPendingReminders(
  facilityId: string,
): Promise<ComplianceReminder[]> {
  const supabase = createClient();

  const { data, error } = await (supabase as any)
    .from("compliance_reminders")
    .select("*")
    .eq("facility_id", facilityId)
    .eq("status", "pending")
    .is("deleted_at", null)
    .order("next_send_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch reminders: ${error.message}`);
  }

  return (data as ComplianceReminder[]) ?? [];
}

/**
 * Get reminder counts grouped by type.
 */
export async function getReminderCounts(
  facilityId: string,
): Promise<ReminderCounts> {
  const supabase = createClient();

  const { data, error } = await (supabase as any)
    .from("compliance_reminders")
    .select("reminder_type")
    .eq("facility_id", facilityId)
    .eq("status", "pending")
    .is("deleted_at", null);

  if (error) {
    throw new Error(`Failed to fetch reminder counts: ${error.message}`);
  }

  const counts: ReminderCounts = {
    weekly_digest: 0,
    poc_due: 0,
    assessment_overdue: 0,
    care_plan_review_due: 0,
    policy_acknowledgment_overdue: 0,
    total: 0,
  };

  for (const reminder of data ?? []) {
    const type = reminder.reminder_type as keyof ReminderCounts;
    counts[type] = (counts[type] || 0) + 1;
    counts.total++;
  }

  return counts;
}

/**
 * Generate a weekly digest reminder for a facility.
 */
export async function generateWeeklyDigest(
  facilityId: string,
  organizationId: string,
  createdById: string,
): Promise<ComplianceReminder | null> {
  const supabase = createClient();

  // Get compliance dashboard snapshot to identify issues
  const { data: facilities } = await supabase
    .from("facilities")
    .select("id, name, organization_id")
    .eq("id", facilityId)
    .maybeSingle();

  if (!facilities) {
    return null;
  }

  // Check for various compliance issues
  const [
    { data: deficiencies },
    { data: pocs },
    { data: overdueAssessments },
    { data: overdueCarePlans },
    { data: overduePolicies },
  ] = await Promise.all([
    supabase
      .from("survey_deficiencies")
      .select("id, tag_number, severity")
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .not("status", "in", ["verified", "corrected"])
      .limit(10),
    supabase
      .from("plans_of_correction")
      .select("id, submission_due_date")
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .in("status", ["draft", "submitted"])
      .lt("submission_due_date", new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()),
    (supabase as any)
      .from("assessments")
      .select("id")
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .eq("status", "scheduled")
      .lt("assessment_date", new Date().toISOString()),
    supabase
      .from("care_plans")
      .select("id")
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .eq("status", "active")
      .lt("review_due_date", new Date().toISOString()),
    supabase
      .from("policy_documents")
      .select("id, title")
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .eq("status", "published")
      .gt("published_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
  ]);

  const totalIssues =
    (deficiencies?.length ?? 0) +
    (pocs?.length ?? 0) +
    (overdueAssessments?.length ?? 0) +
    (overdueCarePlans?.length ?? 0) +
    (overduePolicies?.length ?? 0);

  if (totalIssues === 0) {
    // No issues - create a positive weekly summary
    const { data: result } = await (supabase as any)
      .from("compliance_reminders")
      .insert({
        facility_id: facilityId,
        organization_id: organizationId,
        reminder_type: "weekly_digest",
        title: "Weekly Compliance Summary",
        description: "All systems nominal - no compliance issues detected this week.",
        action_url: "/admin/compliance",
        next_send_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        frequency: "weekly",
        context: { issues_count: 0 },
        status: "pending",
        created_by: createdById,
      })
      .select()
      .single();

    return result as ComplianceReminder | null;
  }

  // Create weekly digest with issues summary
  const description = [
    deficiencies?.length && `${deficiencies.length} open deficiencies`,
    pocs?.length && `${pocs.length} POC due soon`,
    overdueAssessments?.length && `${overdueAssessments.length} overdue assessments`,
    overdueCarePlans?.length && `${overdueCarePlans.length} overdue care plan reviews`,
    overduePolicies?.length && `${overduePolicies.length} new policies to acknowledge`,
  ]
    .filter(Boolean)
    .join(", ");

  const { data: result } = await (supabase as any)
    .from("compliance_reminders")
    .insert({
      facility_id: facilityId,
      organization_id: organizationId,
      reminder_type: "weekly_digest",
      title: `Weekly Compliance Digest - ${totalIssues} Issues`,
      description: description,
      action_url: "/admin/compliance",
      next_send_at: new Date().toISOString(),
      frequency: "weekly",
      context: {
        issues_count: totalIssues,
        deficiencies_count: deficiencies?.length ?? 0,
        pocs_due: pocs?.length ?? 0,
        assessments_overdue: overdueAssessments?.length ?? 0,
        care_plans_overdue: overdueCarePlans?.length ?? 0,
        policies_pending: overduePolicies?.length ?? 0,
      },
      status: "pending",
      created_by: createdById,
    })
    .select()
    .single();

  return result as ComplianceReminder | null;
}

/**
 * Create a specific overdue reminder.
 */
export async function createOverdueReminder(
  facilityId: string,
  organizationId: string,
  reminderType: ComplianceReminder["reminder_type"],
  title: string,
  description: string,
  actionUrl: string,
  context?: Record<string, unknown>,
): Promise<ComplianceReminder | null> {
  const supabase = createClient();

  const { data, error } = await (supabase as any)
    .from("compliance_reminders")
    .insert({
      facility_id: facilityId,
      organization_id: organizationId,
      reminder_type: reminderType,
      title,
      description,
      action_url: actionUrl,
      next_send_at: new Date().toISOString(),
      frequency: "once",
      context: context || null,
      status: "pending",
    })
    .select()
    .single();

  if (error || !data) {
    console.error(`Failed to create reminder: ${error?.message}`);
    return null;
  }

  return data as ComplianceReminder;
}

/**
 * Check and create overdue reminders for a facility.
 */
export async function checkAndCreateOverdueReminders(
  facilityId: string,
  organizationId: string,
  createdById: string,
): Promise<void> {
  const supabase = createClient();

  // Check if POC due reminders already exist
  const { count: existingPocReminders } = await (supabase as any)
    .from("compliance_reminders")
    .select("*", { count: "exact", head: true })
    .eq("facility_id", facilityId)
    .eq("reminder_type", "poc_due")
    .eq("status", "pending")
    .is("deleted_at", null);

  if (existingPocReminders === 0) {
    // Check for POCs due soon
    const { data: pocs } = await supabase
      .from("plans_of_correction")
      .select("id, submission_due_date")
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .in("status", ["draft", "submitted"])
      .gte("submission_due_date", new Date().toISOString())
      .lte("submission_due_date", new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());

    if (pocs && pocs.length > 0) {
      await createOverdueReminder(
        facilityId,
        organizationId,
        "poc_due",
        `Plan of Correction Due - ${pocs.length} Pending`,
        `${pocs.length} plan(s) of correction ${pocs.length === 1 ? "is" : "are"} due within 7 days.`,
        "/admin/compliance",
      );
    }
  }

  // Check for overdue assessments
  const { count: existingAssessmentReminders } = await (supabase as any)
    .from("compliance_reminders")
    .select("*", { count: "exact", head: true })
    .eq("facility_id", facilityId)
    .eq("reminder_type", "assessment_overdue")
    .eq("status", "pending")
    .is("deleted_at", null);

  if (existingAssessmentReminders === 0) {
    const { data: assessments } = await (supabase as any)
      .from("assessments")
      .select("id")
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .eq("status", "scheduled")
      .lt("assessment_date", new Date().toISOString());

    if (assessments && assessments.length > 0) {
      await createOverdueReminder(
        facilityId,
        organizationId,
        "assessment_overdue",
        `Overdue Assessments - ${assessments.length}`,
        `${assessments.length} scheduled assessment(s) ${assessments.length === 1 ? "is" : "are"} overdue.`,
        "/admin/assessments",
      );
    }
  }

  // Check for overdue care plan reviews
  const { count: existingCarePlanReminders } = await (supabase as any)
    .from("compliance_reminders")
    .select("*", { count: "exact", head: true })
    .eq("facility_id", facilityId)
    .eq("reminder_type", "care_plan_review_due")
    .eq("status", "pending")
    .is("deleted_at", null);

  if (existingCarePlanReminders === 0) {
    const { data: carePlans } = await supabase
      .from("care_plans")
      .select("id")
      .eq("facility_id", facilityId)
      .is("deleted_at", null)
      .eq("status", "active")
      .lt("review_due_date", new Date().toISOString());

    if (carePlans && carePlans.length > 0) {
      await createOverdueReminder(
        facilityId,
        organizationId,
        "care_plan_review_due",
        `Care Plan Reviews Due - ${carePlans.length}`,
        `${carePlans.length} care plan review(s) ${carePlans.length === 1 ? "is" : "are"} overdue.`,
        "/admin/care-plans/reviews-due",
      );
    }
  }

  // Check for overdue policy acknowledgments
  const { count: existingPolicyReminders } = await (supabase as any)
    .from("compliance_reminders")
    .select("*", { count: "exact", head: true })
    .eq("facility_id", facilityId)
    .eq("reminder_type", "policy_acknowledgment_overdue")
    .eq("status", "pending")
    .is("deleted_at", null);

  if (existingPolicyReminders === 0) {
    const { data: facilities } = await supabase
      .from("facilities")
      .select("id, organization_id")
      .eq("id", facilityId)
      .maybeSingle();

    if (facilities) {
      // Check for policies published but not acknowledged
      const { data: policies } = await supabase
        .from("policy_documents")
        .select(`
          id,
          title,
          acknowledgment_due_days,
          published_at
        `)
        .eq("facility_id", facilityId)
        .is("deleted_at", null)
        .eq("status", "published");

      if (policies && policies.length > 0) {
        let overdueCount = 0;

        for (const policy of policies) {
          const dueDate = new Date(policy.published_at!);
          dueDate.setDate(dueDate.getDate() + (policy.acknowledgment_due_days || 10));

          if (dueDate < new Date()) {
            overdueCount++;
          }
        }

        if (overdueCount > 0) {
          await createOverdueReminder(
            facilityId,
            facilities.organization_id,
            "policy_acknowledgment_overdue",
            `Policy Acknowledgments Overdue - ${overdueCount}`,
            `${overdueCount} policy ${overdueCount === 1 ? "acknowledgment" : "acknowledgments"} ${overdueCount === 1 ? "is" : "are"} overdue.`,
            "/admin/compliance/policies",
          );
        }
      }
    }
  }
}

/**
 * Dismiss a reminder.
 */
export async function dismissReminder(
  reminderId: string,
  userId: string,
): Promise<boolean> {
  const supabase = createClient();

  const { error } = await (supabase as any)
    .from("compliance_reminders")
    .update({
      status: "dismissed",
      dismissed_by: userId,
      dismissed_at: new Date().toISOString(),
    })
    .eq("id", reminderId)
    .eq("status", "pending");

  if (error) {
    console.error(`Failed to dismiss reminder: ${error.message}`);
    return false;
  }

  return true;
}

/**
 * Update reminder status to sent.
 */
export async function markReminderSent(
  reminderId: string,
): Promise<boolean> {
  const supabase = createClient();

  const { error } = await (supabase as any)
    .from("compliance_reminders")
    .update({
      status: "sent",
      last_sent_at: new Date().toISOString(),
    })
    .eq("id", reminderId)
    .eq("status", "pending");

  if (error) {
    console.error(`Failed to mark reminder sent: ${error.message}`);
    return false;
  }

  return true;
}
