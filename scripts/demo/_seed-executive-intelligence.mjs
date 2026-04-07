import { assertNoError, DEMO_IDS } from "./_config.mjs";

export async function seedExecutiveIntelligence(supabase, actorUserId) {
  // 1. Seed the metric definitions
  await assertNoError(
    "exec metric definitions",
    supabase.from("exec_metric_definitions").upsert([
      {
        id: DEMO_IDS.executive.metrics.occ_pt,
        code: "occ_pt",
        name: "Occupancy %",
        category: "growth",
        description: "Percentage of operational beds currently occupied.",
        formula_type: "beds_occupied / beds_licensed",
        display_format: "percentage",
        threshold_config_json: { target: 0.95, warning: 0.90, critical: 0.85, logic: "higher_is_better" },
      },
      {
        id: DEMO_IDS.executive.metrics.move_ins,
        code: "move_ins",
        name: "Move-ins",
        category: "growth",
        description: "Number of residents admitted.",
        formula_type: "sum(admissions)",
        display_format: "number",
        threshold_config_json: { logic: "higher_is_better" },
      },
      {
        id: DEMO_IDS.executive.metrics.rev_mtd,
        code: "rev_mtd",
        name: "Billed Revenue",
        category: "finance",
        description: "Total invoice amounts posted.",
        formula_type: "sum(invoices.total_amount_cents)",
        display_format: "currency",
        threshold_config_json: { logic: "higher_is_better" },
      },
      {
        id: DEMO_IDS.executive.metrics.labor_pct,
        code: "labor_pct",
        name: "Labor Cost %",
        category: "finance",
        description: "Labor expenses against revenue.",
        formula_type: "sum(payroll_gross) / sum(invoice_total)",
        display_format: "percentage",
        threshold_config_json: { target: 0.50, warning: 0.55, critical: 0.60, logic: "lower_is_better" },
      },
      {
        id: DEMO_IDS.executive.metrics.inc_rate,
        code: "inc_rate",
        name: "Incident Rate",
        category: "clinical",
        description: "Incidents per 1,000 resident days.",
        formula_type: "(sum(incidents) / resident_days) * 1000",
        display_format: "number",
        threshold_config_json: { target: 2.0, warning: 4.0, critical: 6.0, logic: "lower_is_better" },
      },
      {
        id: DEMO_IDS.executive.metrics.staff_fill,
        code: "staff_fill",
        name: "Staffing Fill Rate",
        category: "operations",
        description: "Percentage of scheduled shifts filled.",
        formula_type: "filled_shifts / scheduled_shifts",
        display_format: "percentage",
        threshold_config_json: { target: 0.98, warning: 0.95, critical: 0.90, logic: "higher_is_better" },
      },
      {
        id: DEMO_IDS.executive.metrics.col_mtd,
        code: "col_mtd",
        name: "Cash Collected",
        category: "finance",
        description: "Total payments received.",
        formula_type: "sum(payments.amount_cents)",
        display_format: "currency",
        threshold_config_json: { logic: "higher_is_better" },
      },
      {
        id: DEMO_IDS.executive.metrics.survey_rd,
        code: "survey_rd",
        name: "Survey Readiness",
        category: "compliance",
        description: "Composite readiness score.",
        formula_type: "weighted_average(compliance_domains)",
        display_format: "percentage",
        threshold_config_json: { target: 0.95, warning: 0.90, critical: 0.85, logic: "higher_is_better" },
      },
    ], { onConflict: "code" })
  );

  // 2. Generate 12 months of synthetic trailing data for Oakridge
  const snapshots = [];
  const startYear = 2025;
  
  // Baseline curves (Oakridge starts highly stressed, then improves slightly)
  let occPt = 0.83; // starts deeply below 90%
  let laborPct = 0.64; // extremely high labor out the gate
  let incRate = 5.2; // high incident rate

  for (let month = 1; month <= 12; month++) {
    const periodStr = `${startYear}-${month.toString().padStart(2, "0")}-01`;
    
    // Simulate some realistic volatility
    const improvementFactor = month > 6 ? 0.02 : 0;
    occPt = Math.min(0.98, occPt + improvementFactor + (Math.random() * 0.01));
    laborPct = Math.max(0.48, laborPct - improvementFactor - (Math.random() * 0.015));
    incRate = Math.max(1.1, incRate - (improvementFactor * 50) - (Math.random() * 0.3));

    // Common snapshot props
    const baseSnapshot = {
      organization_id: DEMO_IDS.orgId,
      facility_id: DEMO_IDS.facilityId,
      entity_id: DEMO_IDS.entityId,
      snapshot_date: periodStr,
      period_type: "monthly",
    };

    snapshots.push({ ...baseSnapshot, metric_code: "occ_pt", metric_value_numeric: occPt });
    snapshots.push({ ...baseSnapshot, metric_code: "labor_pct", metric_value_numeric: laborPct });
    snapshots.push({ ...baseSnapshot, metric_code: "inc_rate", metric_value_numeric: incRate });
    snapshots.push({ ...baseSnapshot, metric_code: "move_ins", metric_value_numeric: 2 + Math.floor(Math.random() * 4) });
    snapshots.push({ ...baseSnapshot, metric_code: "rev_mtd", metric_value_numeric: 84500000 + Math.floor(Math.random() * 5000000) });
    snapshots.push({ ...baseSnapshot, metric_code: "col_mtd", metric_value_numeric: 82000000 + Math.floor(Math.random() * 4000000) });
    snapshots.push({ ...baseSnapshot, metric_code: "survey_rd", metric_value_numeric: 0.88 + (Math.random() * 0.1) });
    snapshots.push({ ...baseSnapshot, metric_code: "staff_fill", metric_value_numeric: 0.93 + (Math.random() * 0.05) });
  }

  // Insert the snapshots
  await assertNoError(
    "exec metric snapshots synthetic history",
    supabase.from("exec_metric_snapshots").insert(snapshots)
  );

  // 3. Generate initial Open Alerts in the exception engine
  if (!actorUserId) return;

  await assertNoError(
    "exec alerts",
    supabase.from("exec_alerts").upsert([
      {
        id: DEMO_IDS.executive.alerts.occ_alert,
        organization_id: DEMO_IDS.orgId,
        facility_id: DEMO_IDS.facilityId,
        entity_id: DEMO_IDS.entityId,
        source_module: "finance",
        severity: "critical",
        title: "Occupancy fell below Critical Threshold (85%)",
        body: "Oakridge has dropped from 86.2% to 84.1% occupancy over the last 14 days following 3 discharges.",
        why_it_matters: "Cash flow break-even relies on >88%. Continuing at this rate will bleed cash reserves by $45,000 this month.",
        category: "growth",
        status: "open",
        source_metric_code: "occ_pt",
        current_value_json: { value: 0.841, date: "2025-12-01" },
        prior_value_json: { value: 0.862, date: "2025-11-15" },
        threshold_json: { target: 0.95, critical: 0.85 },
        owner_user_id: actorUserId,
      }
    ])
  );
}
