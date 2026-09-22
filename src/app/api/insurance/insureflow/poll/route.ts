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

type ConnectionRow = {
  id: string;
  organization_id: string;
  provider_instance: string;
  mode: "synthetic" | "live";
  enabled: boolean;
  source_integration_id: string;
};

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

  const admin = createServiceRoleClient();
  // `insureflow_receiver_connections` and `insureflow_receiver_service` arrived in
  // migration 448, after src/types/database.ts was last generated, so they are not
  // in the generated Database type yet. Narrow both to exactly what is used here
  // rather than regenerating the whole file — that would also pull in whatever
  // other branches have in flight against the hosted schema.
  const receiverDb = admin as unknown as {
    from(table: "insureflow_receiver_connections"): {
      select(columns: string): {
        eq(column: string, value: unknown): {
          eq(column: string, value: unknown): {
            order(column: string): { limit(count: number): PromiseLike<{ data: ConnectionRow[] | null; error: { message: string } | null }> };
          };
        };
      };
    };
    rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
  };
  const { data, error } = await receiverDb
    .from("insureflow_receiver_connections")
    .select("id, organization_id, provider_instance, mode, enabled, source_integration_id")
    .eq("mode", "live")
    .eq("enabled", true)
    .order("id")
    .limit(20);

  if (error) {
    return NextResponse.json({ error: "Could not read receiver connections" }, { status: 500 });
  }

  const connections = data ?? [];
  // The store adapter needs one RPC; hand it exactly that, not the whole client.
  const store = createReceiverStore({
    rpc: (name, args) => receiverDb.rpc(name, args as Record<string, unknown>),
  });
  const results: Array<{ connection_id: string; status: string; pages: number }> = [];

  for (const connection of connections) {
    let transport;
    try {
      transport = createLiveFeedTransport({
        mode: "live",
        origin,
        integrationId: connection.source_integration_id,
        token,
      });
    } catch {
      // A misconfigured origin, integration id or credential shape. Say so
      // against the connection rather than failing the whole run.
      results.push({ connection_id: connection.id, status: "invalid_configuration", pages: 0 });
      continue;
    }

    try {
      const outcome = await runSyntheticReceiver({
        mode: "live",
        connectionId: connection.id,
        organizationId: connection.organization_id,
        providerInstance: connection.provider_instance,
        store,
        transport,
        maxPages: 10,
      });
      results.push({ connection_id: connection.id, status: outcome.status, pages: outcome.pagesCommitted });
    } catch {
      // The receiver already preserved its cursor and membership. Record the
      // outcome without a stack trace: these messages can name policies.
      results.push({ connection_id: connection.id, status: "error", pages: 0 });
    }
  }

  return NextResponse.json({ status: "polled", polled: connections.length, results }, { status: 200 });
}
