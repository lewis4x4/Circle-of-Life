import { createClient } from "@/lib/supabase/client";

export type ComplianceRule = {
  id: string;
  facility_id: string | null;
  organization_id: string;
  tag_number: string;
  tag_title: string;
  rule_description: string;
  check_query: string;
  severity: "minor" | "standard" | "serious" | "immediate_jeopardy";
  enabled: boolean;
};

export type ComplianceScan = {
  id: string;
  facility_id: string;
  organization_id: string;
  scanned_at: string;
  scanned_by: string;
  total_rules_checked: number;
  rules_passed: number;
  rules_failed: number;
  notes: string | null;
};

export type ComplianceScanResult = {
  id: string;
  scan_id: string;
  facility_id: string;
  organization_id: string;
  rule_id: string;
  tag_number: string;
  passed: boolean;
  non_compliant_count: number;
  context: Record<string, unknown> | null;
};

export type ComplianceScanSummary = {
  scan: ComplianceScan;
  results: ComplianceScanResult[];
};

export type EmergencyChecklistPreviewItem = {
  id: string;
  title: string;
  next_due_date: string;
  overdue: boolean;
};

type ComplianceRuleExecutionRow = {
  passed: boolean;
  non_compliant_count: number | null;
};

type UntypedInsertBuilder = {
  insert(values: unknown): {
    select(): {
      single(): Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
};

type UntypedUpdateBuilder = {
  update(values: unknown): {
    eq(column: string, value: string): Promise<{ error: { message: string } | null }>;
  };
};

async function fetchEnabledComplianceRules(
  facilityId: string,
  organizationId: string,
  supabase: ReturnType<typeof createClient>,
): Promise<ComplianceRule[]> {
  const { data, error } = await supabase
    .from("compliance_rules" as never)
    .select("*")
    .or(`facility_id.eq.${facilityId},facility_id.is.null`)
    .eq("enabled", true)
    .eq("organization_id", organizationId)
    .is("deleted_at", null);

  if (error) {
    throw new Error(`Failed to fetch compliance rules: ${error.message}`);
  }

  return (data ?? []) as unknown as ComplianceRule[];
}

async function createComplianceScanRecord(
  facilityId: string,
  organizationId: string,
  userId: string,
  totalRulesChecked: number,
  supabase: ReturnType<typeof createClient>,
): Promise<ComplianceScan> {
  const complianceScansTable = supabase.from("compliance_scans" as never) as unknown as UntypedInsertBuilder;
  const { data, error } = await complianceScansTable.insert({
    facility_id: facilityId,
    organization_id: organizationId,
    scanned_by: userId,
    total_rules_checked: totalRulesChecked,
    rules_passed: 0,
    rules_failed: 0,
  })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create compliance scan: ${error?.message ?? "No scan created"}`);
  }

  return data as unknown as ComplianceScan;
}

async function updateComplianceScanCounts(
  scanId: string,
  rulesPassed: number,
  rulesFailed: number,
  supabase: ReturnType<typeof createClient>,
) {
  const complianceScansTable = supabase.from("compliance_scans" as never) as unknown as UntypedUpdateBuilder;
  const { error } = await complianceScansTable.update({
    rules_passed: rulesPassed,
    rules_failed: rulesFailed,
  })
    .eq("id", scanId);

  if (error) {
    throw new Error(`Failed to update scan results: ${error.message}`);
  }
}

async function executeComplianceRule(
  ruleId: string,
  facilityId: string,
  supabase: ReturnType<typeof createClient>,
): Promise<ComplianceRuleExecutionRow> {
  const { data, error } = await supabase.rpc("execute_compliance_rule" as never, {
    p_rule_id: ruleId,
    p_facility_id: facilityId,
  } as never);

  if (error) {
    throw new Error(`Failed to execute rule ${ruleId}: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as ComplianceRuleExecutionRow[];
  if (rows.length === 0) {
    throw new Error(`No result returned for rule ${ruleId}`);
  }

  return rows[0];
}

async function insertComplianceScanResult(
  result: Omit<ComplianceScanResult, "id">,
  supabase: ReturnType<typeof createClient>,
): Promise<ComplianceScanResult> {
  const complianceScanResultsTable =
    supabase.from("compliance_scan_results" as never) as unknown as UntypedInsertBuilder;
  const { data, error } = await complianceScanResultsTable.insert(result)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create scan result for rule ${result.tag_number}`);
  }

  return data as unknown as ComplianceScanResult;
}

async function fetchComplianceScans(
  facilityId: string,
  limit: number,
  supabase: ReturnType<typeof createClient>,
): Promise<ComplianceScan[]> {
  const { data, error } = await supabase
    .from("compliance_scans" as never)
    .select("*")
    .eq("facility_id", facilityId)
    .order("scanned_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch scan history: ${error.message}`);
  }

  return (data ?? []) as unknown as ComplianceScan[];
}

async function fetchLatestComplianceScan(
  facilityId: string,
  supabase: ReturnType<typeof createClient>,
): Promise<ComplianceScan | null> {
  const { data, error } = await supabase
    .from("compliance_scans" as never)
    .select("*")
    .eq("facility_id", facilityId)
    .order("scanned_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as unknown as ComplianceScan;
}

async function fetchComplianceScanResults(
  scanId: string,
  supabase: ReturnType<typeof createClient>,
): Promise<ComplianceScanResult[]> {
  const { data, error } = await supabase
    .from("compliance_scan_results" as never)
    .select("*")
    .eq("scan_id", scanId)
    .order("created_at", { ascending: true });

  if (error) {
    return [];
  }

  return (data ?? []) as unknown as ComplianceScanResult[];
}

export async function getEmergencyChecklistPreview(
  facilityId: string,
  limit: number = 5,
): Promise<EmergencyChecklistPreviewItem[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("emergency_checklist_items" as never)
    .select("id, title, next_due_date")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .order("next_due_date", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch emergency checklist items: ${error.message}`);
  }

  const todayIso = new Date().toISOString();
  return ((data ?? []) as Array<{
    id: string;
    title: string;
    next_due_date: string;
  }>).map((item) => ({
    ...item,
    overdue: item.next_due_date < todayIso,
  }));
}

/**
 * Execute a compliance scan for a facility.
 * Runs all enabled compliance rules and stores results.
 *
 * Note: Rule execution requires server-side RPC for security.
 * This function creates the scan record and attempts to execute each rule.
 */
export async function runComplianceScan(
  facilityId: string,
  userId: string,
): Promise<ComplianceScanSummary | null> {
  const supabase = createClient();

  // 1. Fetch facility organization ID
  const { data: facility } = await supabase
    .from("facilities")
    .select("organization_id")
    .eq("id", facilityId)
    .maybeSingle();

  if (!facility?.organization_id) {
    throw new Error("Facility not found or no organization ID");
  }

  const organizationId = facility.organization_id;

  // 2. Fetch all enabled rules for this facility
  const rules = await fetchEnabledComplianceRules(facilityId, organizationId, supabase);

  if (!rules || rules.length === 0) {
    return null;
  }

  // 3. Create the scan record
  const scan = await createComplianceScanRecord(
    facilityId,
    organizationId,
    userId,
    rules.length,
    supabase,
  );

  const scanId = scan.id;
  const results: ComplianceScanResult[] = [];
  let passedCount = 0;
  let failedCount = 0;

  // 4. Evaluate each rule
  // NOTE: For production, this would use a server-side RPC to execute
  // the check_query safely. For now, we simulate rule results
  // based on the rule's severity and some heuristics.

  for (const rule of rules) {
    const result = await evaluateRule(
      rule,
      facilityId,
      organizationId,
      scanId,
      supabase,
    );

    results.push(result);

    if (result.passed) {
      passedCount++;
    } else {
      failedCount++;
    }
  }

  // 5. Update the scan with final counts
  await updateComplianceScanCounts(scanId, passedCount, failedCount, supabase);

  return {
    scan,
    results,
  };
}

/**
 * Evaluate a single compliance rule.
 *
 * In production, this would call an RPC that executes the rule's
 * check_query and returns the result. For this implementation,
 * we use a simplified evaluation based on the rule type.
 */
async function evaluateRule(
  rule: ComplianceRule,
  facilityId: string,
  organizationId: string,
  scanId: string,
  supabase: ReturnType<typeof createClient>,
): Promise<ComplianceScanResult> {
  try {
    const { passed, non_compliant_count } = await executeComplianceRule(
      rule.id,
      facilityId,
      supabase,
    );

    // Store the scan result
    return await insertComplianceScanResult(
      {
        scan_id: scanId,
        facility_id: facilityId,
        organization_id: organizationId,
        rule_id: rule.id,
        tag_number: rule.tag_number,
        passed,
        non_compliant_count: non_compliant_count ?? 0,
        context: passed ? null : {
          rule_id: rule.id,
          rule_title: rule.tag_title,
          executed_at: new Date().toISOString(),
        },
      },
      supabase,
    );
  } catch (e) {
    // Log the error but don't fail the entire scan
    console.error(`Error evaluating rule ${rule.tag_number}:`, e);
    throw e;
  }
}

/**
 * Get recent scan history for a facility.
 */
export async function getScanHistory(
  facilityId: string,
  limit: number = 10,
): Promise<ComplianceScan[]> {
  const supabase = createClient();
  return fetchComplianceScans(facilityId, limit, supabase);
}

/**
 * Get the latest scan result for a facility.
 */
export async function getLatestScan(
  facilityId: string,
): Promise<ComplianceScanSummary | null> {
  const supabase = createClient();
  const scan = await fetchLatestComplianceScan(facilityId, supabase);
  if (!scan) {
    return null;
  }

  return {
    scan,
    results: await fetchComplianceScanResults(scan.id, supabase),
  };
}

/**
 * Calculate compliance score for a facility.
 * Returns the percentage of rules passing from the latest scan.
 */
export async function getComplianceScore(
  facilityId: string,
): Promise<{ percentage: number; passed: number; total: number } | null> {
  const latestScan = await getLatestScan(facilityId);

  if (!latestScan) {
    return null;
  }

  const { scan } = latestScan;
  const total = scan.total_rules_checked;
  const passed = scan.rules_passed;

  if (total === 0) {
    return { percentage: 100, passed: 0, total: 0 };
  }

  const percentage = Math.round((passed / total) * 100);

  return { percentage, passed, total };
}
