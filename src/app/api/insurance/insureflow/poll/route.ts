import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createReceiverStore, runSyntheticReceiver } from "@/lib/insurance/insureflow/server";
import { createLiveFeedTransport, liveTransportEnabled } from "@/lib/insurance/insureflow/transport";

/**
 * The scheduled poll for the InsureFlow agency summary feed (COL-546 decision 5).
 *
 * Nothing about this endpoint decides anything. It reads the enabled live
 * connections, asks each one's provider for the next page, and hands the result
 * to the reviewed receiver. Authority, freshness, membership and quarantine are
 * all still the receiver's and the database's to enforce.
 *
 * Deliberately narrow:
 *   - cron secret only, compared in constant time; there is no user path in
 *   - refuses outright unless INSUREFLOW_LIVE_TRANSPORT_ENABLED is on
 *   - one credential per connection, read from the server environment, never
 *     from the request and never stored in the projection
 *   - never reports a per-connection failure as a 5xx, because a transport
 *     failure is a normal outcome the receiver already handles by preserving its
 *     cursor. A 500 here would make a scheduler retry something that must not be
 *     retried blindly.
 */

export const runtime = "nodejs";

/**
 * Which connections to poll is configuration, not a query.
 *
 * The receiver's projection is deliberately unreadable through the API — 448
 * revokes `service_role` from `insureflow_receiver_connections`, and the service
 * function exposes only claim/commit/fail/create/configure, with no list. That is
 * not an oversight to route around: `claim` has always taken an explicit
 * connection and organisation, because a worker is meant to be told what to poll
 * rather than discover it. Widening the grant to enumerate would undo a control
 * the independent review relied on.
 *
 * INSUREFLOW_CONNECTIONS is a JSON array of:
 *   { connection_id, organization_id, provider_instance, integration_id }
 */
type PollTarget = {
  connection_id: string;
  organization_id: string;
  provider_instance: string;
  integration_id: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseTargets(raw: string | undefined): PollTarget[] | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const targets: PollTarget[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") return null;
    const t = entry as Record<string, unknown>;
    if (
      typeof t.connection_id !== "string" || !UUID.test(t.connection_id) ||
      typeof t.organization_id !== "string" || !UUID.test(t.organization_id) ||
      typeof t.integration_id !== "string" || !UUID.test(t.integration_id) ||
      typeof t.provider_instance !== "string" || !/^live:[a-z0-9][a-z0-9_-]{0,63}$/.test(t.provider_instance)
    ) {
      return null;
    }
    targets.push({
      connection_id: t.connection_id,
      organization_id: t.organization_id,
      provider_instance: t.provider_instance,
      integration_id: t.integration_id,
    });
  }
  return targets;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const expected = process.env.INSUREFLOW_POLL_SECRET;
  const supplied = request.headers.get("x-cron-secret") ?? "";
  if (
    !expected ||
    Buffer.byteLength(expected) !== Buffer.byteLength(supplied) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
  ) {
    return unauthorized();
  }

  if (!liveTransportEnabled()) {
    // Not an error. The switch being off is a valid, reportable state.
    return NextResponse.json({ status: "disabled", polled: 0, results: [] }, { status: 200 });
  }

  const origin = process.env.INSUREFLOW_FEED_ORIGIN;
  const token = process.env.INSUREFLOW_FEED_TOKEN;
  if (!origin || !token) {
    return NextResponse.json({ error: "Feed origin or credential is not configured" }, { status: 503 });
  }

  const targets = parseTargets(process.env.INSUREFLOW_CONNECTIONS);
  if (!targets) {
    return NextResponse.json({ error: "INSUREFLOW_CONNECTIONS is missing or malformed" }, { status: 503 });
  }

  const admin = createServiceRoleClient();
  // `insureflow_receiver_service` postdates the generated Database type, so narrow
  // the client to the single RPC this route is allowed to call.
  const receiverDb = admin as unknown as {
    rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
  };
  const store = createReceiverStore({
    rpc: (name, args) => receiverDb.rpc(name, args as Record<string, unknown>),
  });
  const results: Array<{ connection_id: string; status: string; pages: number }> = [];

  for (const target of targets) {
    let transport;
    try {
      transport = createLiveFeedTransport({
        mode: "live",
        origin,
        integrationId: target.integration_id,
        token,
      });
    } catch {
      results.push({ connection_id: target.connection_id, status: "invalid_configuration", pages: 0 });
      continue;
    }

    try {
      const outcome = await runSyntheticReceiver({
        mode: "live",
        connectionId: target.connection_id,
        organizationId: target.organization_id,
        providerInstance: target.provider_instance,
        store,
        transport,
        maxPages: 10,
      });
      results.push({ connection_id: target.connection_id, status: outcome.status, pages: outcome.pagesCommitted });
    } catch {
      // The receiver already preserved its cursor and membership. No stack trace:
      // these messages can name policies.
      results.push({ connection_id: target.connection_id, status: "error", pages: 0 });
    }
  }

  return NextResponse.json({ status: "polled", polled: targets.length, results }, { status: 200 });
}
