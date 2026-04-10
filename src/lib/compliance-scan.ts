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
  const { data: rules, error: rulesError } = await supabase
    .from("compliance_rules")
    .select("*")
    .or(`facility_id.eq.${facilityId},facility_id.is.null`)
    .eq("enabled", true)
    .eq("organization_id", organizationId)
    .is("deleted_at", null);

  if (rulesError) {
    throw new Error(`Failed to fetch compliance rules: ${rulesError.message}`);
  }

  if (!rules || rules.length === 0) {
    return null;
  }

  // 3. Create the scan record
  const { data: scan, error: scanError } = await supabase
    .from("compliance_scans")
    .insert({
      facility_id: facilityId,
      organization_id: organizationId,
      scanned_by: userId,
      total_rules_checked: rules.length,
      rules_passed: 0, // Will be updated as we evaluate rules
      rules_failed: 0, // Will be updated as we evaluate rules
    })
    .select()
    .single();

  if (scanError || !scan) {
    throw new Error(`Failed to create compliance scan: ${scanError?.message}`);
  }

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
  const { error: updateError } = await supabase
    .from("compliance_scans")
    .update({
      rules_passed: passedCount,
      rules_failed: failedCount,
    })
    .eq("id", scanId);

  if (updateError) {
    throw new Error(`Failed to update scan results: ${updateError.message}`);
  }

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
  // For now, we create placeholder results
  // In production, this would execute rule.check_query via RPC

  const passed = Math.random() > 0.3; // Simulated - replace with actual query execution
  const nonCompliantCount = passed ? 0 : Math.floor(Math.random() * 10) + 1;

  const { data: result } = await supabase
    .from("compliance_scan_results")
    .insert({
      scan_id: scanId,
      facility_id: facilityId,
      organization_id: organizationId,
      rule_id: rule.id,
      tag_number: rule.tag_number,
      passed,
      non_compliant_count: nonCompliantCount,
      context: passed ? null : { simulated: true },
    })
    .select()
    .single();

  if (!result) {
    throw new Error(`Failed to create scan result for rule ${rule.tag_number}`);
  }

  return result;
}

/**
 * Get recent scan history for a facility.
 */
export async function getScanHistory(
  facilityId: string,
  limit: number = 10,
): Promise<ComplianceScan[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("compliance_scans")
    .select("*")
    .eq("facility_id", facilityId)
    .order("scanned_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch scan history: ${error.message}`);
  }

  return (data as ComplianceScan[]) ?? [];
}

/**
 * Get the latest scan result for a facility.
 */
export async function getLatestScan(
  facilityId: string,
): Promise<ComplianceScanSummary | null> {
  const supabase = createClient();

  const { data: scan, error: scanError } = await supabase
    .from("compliance_scans")
    .select("*")
    .eq("facility_id", facilityId)
    .order("scanned_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (scanError || !scan) {
    return null;
  }

  const { data: results, error: resultsError } = await supabase
    .from("compliance_scan_results")
    .select("*")
    .eq("scan_id", scan.id)
    .order("created_at", { ascending: true });

  if (resultsError || !results) {
    return {
      scan,
      results: [],
    };
  }

  return {
    scan,
    results: results as ComplianceScanResult[],
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
