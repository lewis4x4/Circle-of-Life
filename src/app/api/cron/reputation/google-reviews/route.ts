import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import type { GoogleReviewSyncDetail } from "@/lib/reputation/run-google-review-sync";
import { runGoogleReviewSync } from "@/lib/reputation/run-google-review-sync";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

type OrgResult = {
  organizationId: string;
  skipped?: string;
  imported?: number;
  accountsProcessed?: number;
  details?: GoogleReviewSyncDetail[];
  error?: string;
};

function cronSecretOk(headerSecret: string | null, expected: string | undefined): boolean {
  if (!expected || !headerSecret) return false;
  const a = Buffer.from(headerSecret, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Scheduled Google review import for all orgs with stored OAuth (or one org if body.organization_id set).
 * Auth: `x-cron-secret` must equal `REPUTATION_GOOGLE_CRON_SECRET`.
 * `created_by` on new rows = `connected_by` from credentials; orgs without `connected_by` are skipped.
 */
export async function POST(request: Request) {
  const expected = process.env.REPUTATION_GOOGLE_CRON_SECRET?.trim();
  const headerSecret = request.headers.get("x-cron-secret");
  if (!cronSecretOk(headerSecret, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { organization_id?: string } = {};
  try {
    if (request.headers.get("content-length") !== "0") {
      body = (await request.json()) as typeof body;
    }
  } catch {
    body = {};
  }

  const singleOrg = typeof body.organization_id === "string" ? body.organization_id.trim() : "";

  let admin;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ error: "Server configuration error" }, { status: 503 });
  }

  let credRows: { organization_id: string; connected_by: string | null }[];
  if (singleOrg) {
    const { data, error } = await admin
      .from("reputation_google_oauth_credentials")
      .select("organization_id, connected_by")
      .eq("organization_id", singleOrg)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    credRows = data ? [data] : [];
  } else {
    const { data, error } = await admin.from("reputation_google_oauth_credentials").select("organization_id, connected_by");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    credRows = data ?? [];
  }

  const organizations: OrgResult[] = [];

  for (const row of credRows) {
    if (!row.connected_by) {
      organizations.push({
        organizationId: row.organization_id,
        skipped: "connected_by is null — reconnect Google as owner to set audit user for imports.",
      });
      continue;
    }

    const result = await runGoogleReviewSync({
      organizationId: row.organization_id,
      actorUserId: row.connected_by,
      supabase: admin,
      admin,
    });

    if (result.status === "no_credentials") {
      organizations.push({ organizationId: row.organization_id, error: "no_credentials" });
      continue;
    }
    if (result.status === "token_refresh") {
      organizations.push({ organizationId: row.organization_id, error: result.message });
      continue;
    }
    if (result.status === "account_load") {
      organizations.push({ organizationId: row.organization_id, error: result.message });
      continue;
    }

    organizations.push({
      organizationId: row.organization_id,
      imported: result.imported,
      accountsProcessed: result.accountsProcessed,
      details: result.details,
    });
  }

  const totalImported = organizations.reduce((s, o) => s + (o.imported ?? 0), 0);

  return NextResponse.json({
    ok: true,
    totalImported,
    organizations,
  });
}
