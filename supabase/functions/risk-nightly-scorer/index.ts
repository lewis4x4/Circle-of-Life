/**
 * Risk nightly scorer.
 *
 * Computes nightly per-facility risk scores, writes `risk_score_snapshots`,
 * opens or resolves `exec_alerts`, and sends owner SMS alerts when risk
 * breaches the high/critical threshold or materially worsens.
 *
 * POST body:
 * {
 *   "organization_id"?: uuid,
 *   "facility_id"?: uuid,
 *   "dry_run"?: boolean,
 *   "notify"?: boolean
 * }
 *
 * Auth: x-cron-secret must match RISK_NIGHTLY_SCORER_SECRET
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import { withTiming } from "../_shared/structured-log.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE_DEFICIENCY_STATUSES = new Set(["open", "poc_submitted", "poc_accepted", "recited"]);
const INCIDENT_SEVERITY_WEIGHTS: Record<string, number> = {
  level_1: 2,
  level_2: 4,
  level_3: 7,
  level_4: 10,
};

type FacilityRow = {
  id: string;
  organization_id: string;
  entity_id: string | null;
  name: string;
  timezone: string | null;
};

type OrgRow = { id: string };
type TaskRow = { facility_id: string; status: string; due_at: string | null; license_threatening: boolean | null };
type StaffingRow = { facility_id: string; is_compliant: boolean; adequacy_score: number | null; cannot_cover_count: number | null };
type DeficiencyRow = { facility_id: string; status: string; severity: string | null };
type IncidentRow = { facility_id: string; severity: string; ahca_reportable: boolean | null };
type SafetyRow = { facility_id: string; resident_id: string; risk_tier: string; computed_at: string };
type PreviousSnapshotRow = {
  id: string;
  facility_id: string;
  risk_score: number;
  risk_level: string;
  owner_alert_triggered_at: string | null;
  snapshot_date: string;
};
type ExistingAlertRow = { id: string; facility_id: string | null };
type OwnerProfileRow = { id: string; app_role: string; full_name: string | null; phone: string | null };

type ScoreDriver = {
  key: string;
  label: string;
  count: number;
  penalty: number;
  detail: string;
};

type FacilityScoreResult = {
  facilityId: string;
  facilityName: string;
  entityId: string | null;
  riskScore: number;
  riskLevel: "low" | "moderate" | "high" | "critical";
  scoreDelta: number | null;
  thresholdBreached: boolean;
  notifyOwners: boolean;
  summary: Record<string, unknown>;
  componentScores: Record<string, unknown>;
  alertTitle: string;
  alertBody: string;
};

function riskLevel(score: number): "low" | "moderate" | "high" | "critical" {
  if (score >= 85) return "low";
  if (score >= 70) return "moderate";
  if (score >= 50) return "high";
  return "critical";
}

function severityForRisk(level: "low" | "moderate" | "high" | "critical") {
  return level === "critical" ? "critical" : "warning";
}

function scoreOrder(level: string) {
  switch (level) {
    case "critical":
      return 3;
    case "high":
      return 2;
    case "moderate":
      return 1;
    default:
      return 0;
  }
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function currentDateInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  return `${lookup.get("year")}-${lookup.get("month")}-${lookup.get("day")}`;
}

function buildDriver(
  key: string,
  label: string,
  count: number,
  penalty: number,
  detail: string,
): ScoreDriver | null {
  if (count <= 0 || penalty <= 0) return null;
  return { key, label, count, penalty, detail };
}

function buildFacilityRiskScore(args: {
  facility: FacilityRow;
  previous: PreviousSnapshotRow | null;
  tasks: TaskRow[];
  staffing: StaffingRow[];
  deficiencies: DeficiencyRow[];
  incidents: IncidentRow[];
  safetyRows: SafetyRow[];
}): FacilityScoreResult {
  const overdueTasks = args.tasks.filter((task) => task.status === "missed" || (task.due_at && task.due_at < new Date().toISOString()));
  const licenseThreateningTasks = overdueTasks.filter((task) => task.license_threatening);

  const nonCompliantStaffing = args.staffing.filter((snapshot) => !snapshot.is_compliant);
  const cannotCoverMax = nonCompliantStaffing.reduce(
    (max, snapshot) => Math.max(max, snapshot.cannot_cover_count ?? 0),
    0,
  );
  const lowestAdequacyScore = args.staffing.reduce(
    (min, snapshot) => Math.min(min, snapshot.adequacy_score ?? 100),
    100,
  );

  const activeDeficiencies = args.deficiencies.filter((deficiency) => ACTIVE_DEFICIENCY_STATUSES.has(deficiency.status));
  const ahcaIncidents = args.incidents.filter((incident) => incident.ahca_reportable);
  const incidentPenaltyRaw = args.incidents.reduce(
    (sum, incident) => sum + (INCIDENT_SEVERITY_WEIGHTS[incident.severity] ?? 3),
    0,
  );

  const latestSafetyByResident = new Map<string, SafetyRow>();
  for (const row of args.safetyRows) {
    const existing = latestSafetyByResident.get(row.resident_id);
    if (!existing || row.computed_at > existing.computed_at) {
      latestSafetyByResident.set(row.resident_id, row);
    }
  }
  const safetyValues = Array.from(latestSafetyByResident.values());
  const criticalSafetyCount = safetyValues.filter((row) => row.risk_tier === "critical").length;
  const highSafetyCount = safetyValues.filter((row) => row.risk_tier === "high").length;

  const drivers = [
    buildDriver(
      "license_threatening_tasks",
      "License-threatening misses",
      licenseThreateningTasks.length,
      Math.min(40, licenseThreateningTasks.length * 18),
      `${licenseThreateningTasks.length} overdue or missed task(s) are marked license-threatening.`,
    ),
    buildDriver(
      "overdue_operations",
      "Overdue operations",
      overdueTasks.length,
      Math.min(16, overdueTasks.length * 3),
      `${overdueTasks.length} operations task(s) are overdue or missed.`,
    ),
    buildDriver(
      "staffing_noncompliance",
      "Staffing adequacy",
      nonCompliantStaffing.length,
      Math.min(24, nonCompliantStaffing.length * 6 + cannotCoverMax * 2),
      `${nonCompliantStaffing.length} non-compliant adequacy snapshot(s); lowest score ${lowestAdequacyScore}.`,
    ),
    buildDriver(
      "survey_deficiencies",
      "Open survey deficiencies",
      activeDeficiencies.length,
      Math.min(20, activeDeficiencies.length * 6),
      `${activeDeficiencies.length} survey deficiency record(s) remain open or under plan of correction.`,
    ),
    buildDriver(
      "open_incidents",
      "Open incidents",
      args.incidents.length,
      Math.min(22, incidentPenaltyRaw),
      `${args.incidents.length} incident(s) remain open/investigating; ${ahcaIncidents.length} flagged reportable.`,
    ),
    buildDriver(
      "resident_safety",
      "Resident safety pressure",
      criticalSafetyCount + highSafetyCount,
      Math.min(18, criticalSafetyCount * 7 + highSafetyCount * 3),
      `${criticalSafetyCount} critical and ${highSafetyCount} high resident safety score(s) remain active.`,
    ),
  ].filter((driver): driver is ScoreDriver => Boolean(driver));

  const totalPenalty = drivers.reduce((sum, driver) => sum + driver.penalty, 0);
  const riskScore = clampScore(100 - totalPenalty);
  const level = riskLevel(riskScore);
  const previousLevel = args.previous?.risk_level ?? null;
  const scoreDelta = args.previous ? riskScore - args.previous.risk_score : null;
  const thresholdBreached = level === "high" || level === "critical";
  const notifyOwners =
    thresholdBreached &&
    (
      !args.previous ||
      (previousLevel !== "high" && previousLevel !== "critical") ||
      scoreOrder(level) > scoreOrder(previousLevel ?? "low") ||
      (scoreDelta != null && scoreDelta <= -10)
    );

  const topDrivers = drivers
    .slice()
    .sort((left, right) => right.penalty - left.penalty)
    .slice(0, 3);

  return {
    facilityId: args.facility.id,
    facilityName: args.facility.name,
    entityId: args.facility.entity_id,
    riskScore,
    riskLevel: level,
    scoreDelta,
    thresholdBreached,
    notifyOwners,
    componentScores: {
      operations: {
        overdue_tasks: overdueTasks.length,
        license_threatening_tasks: licenseThreateningTasks.length,
        penalty: drivers.find((driver) => driver.key === "license_threatening_tasks")?.penalty ?? 0
          + (drivers.find((driver) => driver.key === "overdue_operations")?.penalty ?? 0),
      },
      staffing: {
        non_compliant_snapshots: nonCompliantStaffing.length,
        cannot_cover_max: cannotCoverMax,
        lowest_adequacy_score: Number.isFinite(lowestAdequacyScore) ? lowestAdequacyScore : null,
        penalty: drivers.find((driver) => driver.key === "staffing_noncompliance")?.penalty ?? 0,
      },
      compliance: {
        open_survey_deficiencies: activeDeficiencies.length,
        penalty: drivers.find((driver) => driver.key === "survey_deficiencies")?.penalty ?? 0,
      },
      incidents: {
        open_incidents: args.incidents.length,
        ahca_reportable_open_incidents: ahcaIncidents.length,
        penalty: drivers.find((driver) => driver.key === "open_incidents")?.penalty ?? 0,
      },
      resident_safety: {
        critical_count: criticalSafetyCount,
        high_count: highSafetyCount,
        penalty: drivers.find((driver) => driver.key === "resident_safety")?.penalty ?? 0,
      },
    },
    summary: {
      top_drivers: topDrivers,
      overdue_task_count: overdueTasks.length,
      license_threatening_count: licenseThreateningTasks.length,
      staffing_non_compliant_count: nonCompliantStaffing.length,
      staffing_cannot_cover_max: cannotCoverMax,
      open_survey_deficiency_count: activeDeficiencies.length,
      open_incident_count: args.incidents.length,
      ahca_reportable_open_incident_count: ahcaIncidents.length,
      resident_safety_critical_count: criticalSafetyCount,
      resident_safety_high_count: highSafetyCount,
      previous_level: previousLevel,
      previous_score: args.previous?.risk_score ?? null,
      notify_owners: notifyOwners,
    },
    alertTitle: `Nightly risk score ${level.toUpperCase()} — ${args.facility.name}`,
    alertBody: topDrivers.length > 0
      ? `Risk score ${riskScore}/100. Top drivers: ${topDrivers.map((driver) => `${driver.label} (${driver.count})`).join("; ")}.`
      : `Risk score ${riskScore}/100 with no active cross-domain risk drivers above the scoring threshold.`,
  };
}

async function deliverSms(args: {
  phone: string | null;
  facilityName: string;
  riskScore: number;
  riskLevel: string;
  body: string;
  dryRun: boolean;
}) {
  if (args.dryRun) {
    return {
      status: "skipped" as const,
      providerMessageId: null,
      providerPayload: { reason: "dry_run" },
      errorMessage: null,
    };
  }

  if (!args.phone) {
    return {
      status: "skipped" as const,
      providerMessageId: null,
      providerPayload: { reason: "missing_phone" },
      errorMessage: "Recipient phone missing",
    };
  }

  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const smsFrom = Deno.env.get("TWILIO_SMS_FROM");
  if (!accountSid || !authToken || !smsFrom) {
    return {
      status: "skipped" as const,
      providerMessageId: null,
      providerPayload: { reason: "missing_twilio_config" },
      errorMessage: "Twilio config missing",
    };
  }

  const auth = "Basic " + btoa(`${accountSid}:${authToken}`);
  const form = new URLSearchParams({
    To: args.phone,
    From: smsFrom,
    Body: `[Haven Risk] ${args.facilityName} is ${args.riskLevel.toUpperCase()} at ${args.riskScore}/100. ${args.body}`,
  });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  return response.ok
    ? {
        status: "sent" as const,
        providerMessageId: payload.sid ?? null,
        providerPayload: payload,
        errorMessage: null,
      }
    : {
        status: "failed" as const,
        providerMessageId: null,
        providerPayload: payload,
        errorMessage: payload.message ?? "Twilio SMS failed",
      };
}

Deno.serve(async (req) => {
  const t = withTiming("risk-nightly-scorer");
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);

  const secret = Deno.env.get("RISK_NIGHTLY_SCORER_SECRET") ?? "";
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: { organization_id?: string; facility_id?: string; dry_run?: boolean; notify?: boolean } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  if (body.organization_id && !UUID_RE.test(body.organization_id)) {
    return jsonResponse({ error: "organization_id must be a UUID" }, 400, origin);
  }
  if (body.facility_id && !UUID_RE.test(body.facility_id)) {
    return jsonResponse({ error: "facility_id must be a UUID" }, 400, origin);
  }

  const dryRun = Boolean(body.dry_run);
  const notify = body.notify !== false;
  const now = new Date();
  const yesterdayIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const organizations: OrgRow[] = [];

  if (body.organization_id) {
    organizations.push({ id: body.organization_id });
  } else if (body.facility_id) {
    const { data: facilityRow, error: facilityError } = await admin
      .from("facilities")
      .select("organization_id")
      .eq("id", body.facility_id)
      .maybeSingle();
    if (facilityError || !facilityRow?.organization_id) {
      return jsonResponse({ error: "facility not found" }, 404, origin);
    }
    organizations.push({ id: facilityRow.organization_id });
  } else {
    const { data: orgData, error: orgError } = await admin
      .from("organizations")
      .select("id")
      .eq("status", "active")
      .is("deleted_at", null);
    if (orgError) {
      t.log({ event: "organizations_load_failed", outcome: "error", error_message: orgError.message });
      return jsonResponse({ error: orgError.message }, 500, origin);
    }
    organizations.push(...((orgData ?? []) as OrgRow[]));
  }

  const results: Array<Record<string, unknown>> = [];
  let totalAlertsOpened = 0;
  let totalAlertsResolved = 0;
  let totalSmsSent = 0;

  for (const org of organizations) {
    let facilityQuery = admin
      .from("facilities")
      .select("id, organization_id, entity_id, name, timezone")
      .eq("organization_id", org.id)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("name");
    if (body.facility_id) facilityQuery = facilityQuery.eq("id", body.facility_id);

    const { data: facilityData, error: facilityError } = await facilityQuery;
    if (facilityError) {
      results.push({ organization_id: org.id, error: facilityError.message });
      continue;
    }

    const facilities = (facilityData ?? []) as FacilityRow[];
    if (facilities.length === 0) continue;
    const facilityIds = facilities.map((facility) => facility.id);

    const [
      taskRes,
      staffingRes,
      deficiencyRes,
      incidentRes,
      safetyRes,
      previousRes,
      alertRes,
      ownerRes,
    ] = await Promise.all([
      admin
        .from("operation_task_instances")
        .select("facility_id, status, due_at, license_threatening")
        .eq("organization_id", org.id)
        .is("deleted_at", null)
        .in("facility_id", facilityIds)
        .in("status", ["pending", "in_progress", "missed"]),
      admin
        .from("staffing_adequacy_snapshots" as never)
        .select("facility_id, is_compliant, adequacy_score, cannot_cover_count")
        .eq("organization_id", org.id)
        .in("facility_id", facilityIds)
        .gte("created_at" as never, yesterdayIso as never),
      admin
        .from("survey_deficiencies")
        .select("facility_id, status, severity")
        .eq("organization_id", org.id)
        .is("deleted_at", null)
        .in("facility_id", facilityIds)
        .in("status", Array.from(ACTIVE_DEFICIENCY_STATUSES)),
      admin
        .from("incidents")
        .select("facility_id, severity, ahca_reportable")
        .eq("organization_id", org.id)
        .is("deleted_at", null)
        .in("facility_id", facilityIds)
        .in("status", ["open", "investigating"]),
      admin
        .from("resident_safety_scores" as never)
        .select("facility_id, resident_id, risk_tier, computed_at")
        .eq("organization_id", org.id)
        .in("facility_id", facilityIds)
        .gte("computed_at" as never, yesterdayIso as never),
      admin
        .from("risk_score_snapshots" as never)
        .select("id, facility_id, risk_score, risk_level, owner_alert_triggered_at, snapshot_date")
        .eq("organization_id", org.id)
        .is("deleted_at", null)
        .in("facility_id", facilityIds)
        .order("snapshot_date" as never, { ascending: false })
        .order("computed_at" as never, { ascending: false }),
      admin
        .from("exec_alerts")
        .select("id, facility_id")
        .eq("organization_id", org.id)
        .eq("category", "risk_command")
        .is("deleted_at", null)
        .is("resolved_at", null)
        .in("facility_id", facilityIds),
      admin
        .from("user_profiles")
        .select("id, app_role, full_name, phone")
        .eq("organization_id", org.id)
        .eq("is_active", true)
        .is("deleted_at", null)
        .in("app_role", ["owner", "org_admin"]),
    ]);

    const tasks = (taskRes.data ?? []) as TaskRow[];
    const staffing = (staffingRes.data ?? []) as StaffingRow[];
    const deficiencies = (deficiencyRes.data ?? []) as DeficiencyRow[];
    const incidents = (incidentRes.data ?? []) as IncidentRow[];
    const safetyRows = (safetyRes.data ?? []) as SafetyRow[];
    const existingAlerts = (alertRes.data ?? []) as ExistingAlertRow[];
    const ownerProfiles = (ownerRes.data ?? []) as OwnerProfileRow[];

    const previousMap = new Map<string, PreviousSnapshotRow>();
    for (const snapshot of (previousRes.data ?? []) as PreviousSnapshotRow[]) {
      if (!previousMap.has(snapshot.facility_id)) {
        previousMap.set(snapshot.facility_id, snapshot);
      }
    }

    const alertMap = new Map<string, ExistingAlertRow>();
    for (const alert of existingAlerts) {
      if (alert.facility_id && !alertMap.has(alert.facility_id)) {
        alertMap.set(alert.facility_id, alert);
      }
    }

    const recipients = ownerProfiles.filter((profile) => profile.app_role === "owner");
    const fallbackRecipients = recipients.length > 0 ? recipients : ownerProfiles.filter((profile) => profile.app_role === "org_admin");

    for (const facility of facilities) {
      const timezone = facility.timezone || "America/New_York";
      const snapshotDate = currentDateInTimezone(timezone);
      const previous = previousMap.get(facility.id) ?? null;
      const score = buildFacilityRiskScore({
        facility,
        previous,
        tasks: tasks.filter((row) => row.facility_id === facility.id),
        staffing: staffing.filter((row) => row.facility_id === facility.id),
        deficiencies: deficiencies.filter((row) => row.facility_id === facility.id),
        incidents: incidents.filter((row) => row.facility_id === facility.id),
        safetyRows: safetyRows.filter((row) => row.facility_id === facility.id),
      });

      let snapshotId: string | null = null;
      let execAlertId: string | null = alertMap.get(facility.id)?.id ?? null;
      let alertsOpened = 0;
      let alertsResolved = 0;
      let smsSent = 0;

      if (!dryRun) {
        const { data: snapshotUpsert, error: snapshotError } = await admin
          .from("risk_score_snapshots" as never)
          .upsert({
            organization_id: org.id,
            facility_id: facility.id,
            entity_id: facility.entity_id,
            snapshot_date: snapshotDate,
            computed_at: now.toISOString(),
            score_version: 1,
            risk_score: score.riskScore,
            risk_level: score.riskLevel,
            score_delta: score.scoreDelta,
            component_scores_json: score.componentScores,
            summary_json: score.summary,
            alert_threshold_breached: score.thresholdBreached,
            owner_alert_triggered_at: score.notifyOwners && notify ? now.toISOString() : null,
          } as never, { onConflict: "facility_id,snapshot_date,score_version" })
          .select("id")
          .maybeSingle();

        if (snapshotError) {
          results.push({ organization_id: org.id, facility_id: facility.id, error: snapshotError.message });
          continue;
        }
        snapshotId = (snapshotUpsert as { id: string } | null)?.id ?? null;
      }

      const existingAlert = alertMap.get(facility.id) ?? null;
      if (score.thresholdBreached) {
        if (!dryRun) {
          if (existingAlert?.id) {
            const { error: updateAlertError } = await admin
              .from("exec_alerts")
              .update({
                severity: severityForRisk(score.riskLevel),
                title: score.alertTitle,
                body: score.alertBody,
                score: 100 - score.riskScore,
                owner_user_id: fallbackRecipients[0]?.id ?? null,
                deep_link_path: "/admin/risk",
                current_value_json: {
                  risk_score: score.riskScore,
                  risk_level: score.riskLevel,
                  summary: score.summary,
                },
                threshold_json: { alert_level: "high", score_lte: 69, critical_score_lte: 49 },
                last_evaluated_at: now.toISOString(),
                updated_at: now.toISOString(),
                status: "open",
              })
              .eq("id", existingAlert.id);
            if (!updateAlertError) {
              execAlertId = existingAlert.id;
            }
          } else {
            const { data: insertAlert, error: insertAlertError } = await admin
              .from("exec_alerts")
              .insert({
                organization_id: org.id,
                facility_id: facility.id,
                entity_id: facility.entity_id,
                source_module: "system",
                severity: severityForRisk(score.riskLevel),
                title: score.alertTitle,
                body: score.alertBody,
                deep_link_path: "/admin/risk",
                score: 100 - score.riskScore,
                category: "risk_command",
                why_it_matters: "Nightly risk scoring combines operations misses, staffing strain, compliance burden, incidents, and resident safety pressure into one owner-visible command signal.",
                owner_user_id: fallbackRecipients[0]?.id ?? null,
                current_value_json: {
                  risk_score: score.riskScore,
                  risk_level: score.riskLevel,
                  summary: score.summary,
                },
                threshold_json: { alert_level: "high", score_lte: 69, critical_score_lte: 49 },
                status: "open",
                last_evaluated_at: now.toISOString(),
                related_link_json: {
                  risk_command: "/admin/risk",
                  operations: "/admin/operations/overdue",
                  incidents: "/admin/incidents",
                  compliance: "/admin/compliance",
                },
              })
              .select("id")
              .maybeSingle();
            if (!insertAlertError) {
              execAlertId = (insertAlert as { id: string } | null)?.id ?? null;
              alertsOpened += 1;
            }
          }
        }

        if (notify && score.notifyOwners && fallbackRecipients.length > 0) {
          for (const recipient of fallbackRecipients) {
            const delivery = await deliverSms({
              phone: recipient.phone,
              facilityName: facility.name,
              riskScore: score.riskScore,
              riskLevel: score.riskLevel,
              body: score.alertBody,
              dryRun,
            });

            if (!dryRun) {
              await admin.from("risk_owner_alert_deliveries" as never).insert({
                organization_id: org.id,
                facility_id: facility.id,
                entity_id: facility.entity_id,
                risk_score_snapshot_id: snapshotId,
                exec_alert_id: execAlertId,
                recipient_user_id: recipient.id,
                recipient_role: recipient.app_role,
                recipient_phone: recipient.phone,
                channel: "sms",
                delivery_status: delivery.status,
                provider_message_id: delivery.providerMessageId,
                provider_payload: delivery.providerPayload,
                error_message: delivery.errorMessage,
                sent_at: now.toISOString(),
              } as never);
            }

            if (delivery.status === "sent") {
              smsSent += 1;
            }
          }
        }
      } else if (existingAlert?.id && !dryRun) {
        const { error: resolveError } = await admin
          .from("exec_alerts")
          .update({
            resolved_at: now.toISOString(),
            updated_at: now.toISOString(),
            status: "resolved",
          })
          .eq("id", existingAlert.id);
        if (!resolveError) {
          alertsResolved += 1;
        }
      }

      totalAlertsOpened += alertsOpened;
      totalAlertsResolved += alertsResolved;
      totalSmsSent += smsSent;

      results.push({
        organization_id: org.id,
        facility_id: facility.id,
        facility_name: facility.name,
        dry_run: dryRun,
        risk_score: score.riskScore,
        risk_level: score.riskLevel,
        score_delta: score.scoreDelta,
        threshold_breached: score.thresholdBreached,
        notify_owners: score.notifyOwners && notify,
        alerts_opened: alertsOpened,
        alerts_resolved: alertsResolved,
        sms_sent: smsSent,
        top_drivers: (score.summary.top_drivers as ScoreDriver[] | undefined) ?? [],
      });
    }
  }

  t.log({
    event: "complete",
    outcome: "success",
    organizations_processed: organizations.length,
    facilities_processed: results.length,
    alerts_opened: totalAlertsOpened,
    alerts_resolved: totalAlertsResolved,
    sms_sent: totalSmsSent,
    dry_run: dryRun,
  });

  return jsonResponse({
    ok: true,
    dry_run: dryRun,
    organizations_processed: organizations.length,
    facilities_processed: results.length,
    alerts_opened: totalAlertsOpened,
    alerts_resolved: totalAlertsResolved,
    sms_sent: totalSmsSent,
    results,
  }, 200, origin);
});
