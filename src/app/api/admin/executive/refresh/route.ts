import { NextResponse } from "next/server";

import { canMutateFinance } from "@/lib/finance/load-finance-context";
import { loadFinanceRoleContextServer } from "@/lib/finance/load-finance-context.server";
import { logError } from "@/lib/observability/logger";

// Netlify Pro caps serverless execution at 26s; lower this if the site downgrades tiers.
export const maxDuration = 26;

type EdgeRefreshResult = {
  name: "exec-kpi-snapshot" | "resident-safety-scorer" | "risk-nightly-scorer";
  ok: boolean;
  status: number;
  body?: unknown;
  error?: string;
};

type EdgeRefreshClientResult = Pick<EdgeRefreshResult, "name" | "ok" | "status">;

function normalizeSupabaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function invokeEdgeRefresh({
  name,
  supabaseUrl,
  secret,
  organizationId,
  body,
}: {
  name: EdgeRefreshResult["name"];
  supabaseUrl: string;
  secret: string;
  organizationId: string;
  body?: Record<string, unknown>;
}): Promise<EdgeRefreshResult> {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": secret,
      },
      body: JSON.stringify(body ?? { organization_id: organizationId }),
      cache: "no-store",
      signal: AbortSignal.timeout(22_000),
    });

    const responseBody = await parseResponseBody(response);
    return {
      name,
      ok: response.ok,
      status: response.status,
      body: responseBody,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Failed to invoke edge function.",
    };
  }
}

function toClientResult(result: EdgeRefreshResult): EdgeRefreshClientResult {
  return {
    name: result.name,
    ok: result.ok,
    status: result.status,
  };
}

function logRefreshFailure(result: EdgeRefreshResult): void {
  logError("executive.refresh.edge", "edge invocation failed", {
    name: result.name,
    status: result.status,
    ok: result.ok,
    failureType: result.status === 0 ? "network" : "edge-function",
  });
}

export async function POST() {
  const roleContext = await loadFinanceRoleContextServer();
  if (!roleContext.ok) {
    const status = roleContext.error === "Sign in required." ? 401 : 403;
    return NextResponse.json({ ok: false, error: roleContext.error }, { status });
  }

  if (!canMutateFinance(roleContext.ctx.appRole)) {
    return NextResponse.json(
      { ok: false, error: "Owner or organization administrator access required." },
      { status: 403 },
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const snapshotSecret = process.env.EXEC_KPI_SNAPSHOT_SECRET?.trim();
  const scorerSecret = process.env.RESIDENT_SAFETY_SCORER_SECRET?.trim();
  const riskSecret = process.env.RISK_NIGHTLY_SCORER_SECRET?.trim();
  const missing = [
    !supabaseUrl ? "SUPABASE_URL" : null,
    !snapshotSecret ? "EXEC_KPI_SNAPSHOT_SECRET" : null,
    !scorerSecret ? "RESIDENT_SAFETY_SCORER_SECRET" : null,
    !riskSecret ? "RISK_NIGHTLY_SCORER_SECRET" : null,
  ].filter((value): value is string => Boolean(value));

  if (!supabaseUrl || !snapshotSecret || !scorerSecret || !riskSecret) {
    return NextResponse.json(
      { ok: false, error: "Executive refresh is not configured on this server.", missing },
      { status: 503 },
    );
  }

  const normalizedSupabaseUrl = normalizeSupabaseUrl(supabaseUrl);
  const organizationId = roleContext.ctx.organizationId;

  const [snapshot, scorer, risk] = await Promise.all([
    invokeEdgeRefresh({
      name: "exec-kpi-snapshot",
      supabaseUrl: normalizedSupabaseUrl,
      secret: snapshotSecret,
      organizationId,
    }),
    invokeEdgeRefresh({
      name: "resident-safety-scorer",
      supabaseUrl: normalizedSupabaseUrl,
      secret: scorerSecret,
      organizationId,
    }),
    invokeEdgeRefresh({
      name: "risk-nightly-scorer",
      supabaseUrl: normalizedSupabaseUrl,
      secret: riskSecret,
      organizationId,
      body: { organization_id: organizationId, notify: false },
    }),
  ]);

  const snapshotClient = toClientResult(snapshot);
  const scorerClient = toClientResult(scorer);
  const riskClient = toClientResult(risk);

  if (!snapshot.ok || !scorer.ok || !risk.ok) {
    if (!snapshot.ok) logRefreshFailure(snapshot);
    if (!scorer.ok) logRefreshFailure(scorer);
    if (!risk.ok) logRefreshFailure(risk);

    return NextResponse.json(
      {
        ok: false,
        error: "Executive refresh did not complete successfully.",
        snapshot: snapshotClient,
        scorer: scorerClient,
        risk: riskClient,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, snapshot: snapshotClient, scorer: scorerClient, risk: riskClient });
}
