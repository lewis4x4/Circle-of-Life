import { NextResponse } from "next/server";

import { requireAdminApiActor, requireFacilityAccess } from "@/lib/admin/api-auth";
import { logError } from "@/lib/observability/logger";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { computeTimesheet, facilityDayStart, payPeriodContaining, unresolvedExceptionCount } from "@/lib/timeclock/compute";
import { buildTimecardCsv, buildTimecardRows, exportGate, timecardFilename } from "@/lib/timeclock/export";
import { loadEmployeeNumbers, loadOrganizationPayPeriod, loadTimeclockPeriod } from "@/lib/timeclock/load";

const MANAGER_ROLES = ["owner", "org_admin", "facility_admin"] as const;

/**
 * GET /api/admin/timeclock/export?facility_id=&period_start= — payroll
 * timecard CSV (spec 37 §8). 409 while the pay period is unset or any
 * exception in the period lacks an acknowledgment. Reads run as the signed in
 * actor under RLS; employee numbers come from the definer function.
 */
export async function GET(request: Request) {
  const auth = await requireAdminApiActor({ allowedRoles: MANAGER_ROLES });
  if ("response" in auth) return auth.response;
  const { actor } = auth;
  const url = new URL(request.url);
  const facilityId = url.searchParams.get("facility_id") ?? "";
  const periodStart = url.searchParams.get("period_start") ?? "";
  if (!UUID_STRING_RE.test(facilityId) || !/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) {
    return NextResponse.json({ error: "facility_id and period_start (yyyy-mm-dd) are required" }, { status: 400 });
  }
  const access = await requireFacilityAccess(actor, facilityId);
  if ("response" in access) return access.response;

  try {
    const settings = await loadOrganizationPayPeriod(actor.client, actor.organization_id);
    const period = payPeriodContaining(facilityDayStart(periodStart), settings);
    if (period.startIso !== periodStart) {
      return NextResponse.json({ error: "period_start is not the start of a pay period" }, { status: 400 });
    }
    const now = new Date();
    const data = await loadTimeclockPeriod(actor.client, { facilityId, periodStart: period.start, periodEnd: period.end });
    const numbers = await loadEmployeeNumbers(actor.client, data.staff.map((s) => s.id));
    const staff = data.staff
      .map((s) => ({
        staffId: s.id,
        name: s.name,
        employeeNumber: numbers.get(s.id) ?? null,
        sheet: computeTimesheet({ staffId: s.id, punches: data.punches, corrections: data.corrections, rejections: data.rejections, periodStart: period.start, periodEnd: period.end, now }),
      }))
      .filter((s) => s.sheet.effective.length > 0 || s.sheet.exceptions.length > 0);

    const gate = exportGate({ payPeriodSet: period.source === "pay_period", unresolvedExceptions: unresolvedExceptionCount(staff.map((s) => s.sheet)) });
    if (gate.blocked) {
      return NextResponse.json({ error: gate.code, message: gate.reason }, { status: 409 });
    }

    const facilityName = await facilityNameFor(actor, facilityId);
    const csv = buildTimecardCsv(buildTimecardRows({ periodStartIso: period.startIso, periodEndIso: period.endIso, staff }));
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${timecardFilename(facilityName, period.startIso)}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logError("timeclock.export", error, { action: "export" });
    return NextResponse.json({ error: "Could not build the export" }, { status: 500 });
  }
}

async function facilityNameFor(actor: Extract<Awaited<ReturnType<typeof requireAdminApiActor>>, { actor: unknown }>["actor"], facilityId: string): Promise<string> {
  const { data } = await actor.client.from("facilities").select("name").eq("id", facilityId).maybeSingle();
  return data?.name ?? "facility";
}
